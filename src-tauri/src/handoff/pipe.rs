//! The handoff on Windows: a named pipe per user and logon session.
//!
//! `\\.\pipe\io.github.johnson-anthony.glasshouse.App-<user SID>-<session>`
//! (`AppDebug` in a debug build). The running app makes the first instance
//! with `FILE_FLAG_FIRST_PIPE_INSTANCE`, so it can't be squatted on
//! unnoticed, and local clients only. Each client connection gets the next
//! instance made before it's read, so a launch never finds none.
//!
//! A launch opens it with `SECURITY_IDENTIFICATION` (the app can't act as
//! it), checks the app runs as the same user, lets it take the foreground
//! (`AllowSetForegroundWindow`; Windows gives the foreground only to a
//! process the foreground one allows), and writes one line of JSON
//! (`handoff::encode`). The app checks the client is the same user too,
//! and answers one byte: `1` taken, `0` not.
//!
//! Only std and the windows crate: this is type-checked on Linux through a
//! scratch crate, and first built by the windows-latest CI job.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::sync::mpsc;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, LocalFree, ERROR_ACCESS_DENIED, ERROR_PIPE_CONNECTED, HANDLE, HLOCAL};
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{EqualSid, GetTokenInformation, TokenSessionId, TokenUser, PSID, TOKEN_QUERY, TOKEN_USER};
use windows::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId, GetNamedPipeServerProcessId,
    WaitNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

use super::{decode, encode, Inbox, Outcome, Request, Server, Started, ANSWER_WITHIN, MAX_MESSAGE};

#[cfg(not(debug_assertions))]
const STEM: &str = "io.github.johnson-anthony.glasshouse.App";
#[cfg(debug_assertions)]
const STEM: &str = "io.github.johnson-anthony.glasshouse.AppDebug";

/// `SECURITY_IDENTIFICATION` for `CreateFile`'s QoS flags: the server may
/// learn who the client is, not act as it. std adds `SECURITY_SQOS_PRESENT`.
const SECURITY_IDENTIFICATION: u32 = 0x0001_0000;
/// `ERROR_PIPE_BUSY`: every instance is taken; wait for one.
const PIPE_BUSY: i32 = 231;
/// How long a launch waits for a free instance.
const BUSY_WAIT_MS: u32 = 500;

pub fn start(request: &Request) -> Started {
    let name = match pipe_name() {
        Ok(n) => n,
        Err(e) => return Started::alone(format!("the handoff pipe's name: {e}; this window runs on its own")),
    };
    let wide = wide(&name);
    // Once more if the app ended between the two steps.
    for _ in 0..2 {
        match create(&wide, true) {
            Ok(first) => {
                let inbox = Inbox::default();
                let theirs = inbox.clone();
                let spawned = std::thread::Builder::new()
                    .name("handoff-pipe".into())
                    .spawn(move || serve(wide, first, theirs));
                return match spawned {
                    Ok(_) => Started { outcome: Outcome::Serving(Server { inbox }), notes: Vec::new() },
                    Err(e) => Started::alone(format!("serving the handoff pipe: {e}; this window runs on its own")),
                };
            }
            // Another process made it: the running app, or a squatter the
            // user check below turns away.
            Err(e) if e.code() == ERROR_ACCESS_DENIED.to_hresult() => {}
            Err(e) => return Started::alone(format!("making the handoff pipe: {e}; this window runs on its own")),
        }
        match send(&name, request) {
            Ok(()) => return Started { outcome: Outcome::HandedOff, notes: Vec::new() },
            Err(Failure::Gone) => continue,
            Err(Failure::Refused(why)) => {
                return Started::alone(format!("the running glasshouse didn't take the window ({why}); this one runs on its own"))
            }
        }
    }
    Started::alone("the handoff pipe kept changing hands; this window runs on its own".into())
}

enum Failure {
    /// No app at the pipe any more.
    Gone,
    Refused(String),
}

fn send(name: &str, request: &Request) -> Result<(), Failure> {
    let file = open(name)?;
    let handle = HANDLE(file.as_raw_handle());
    let mut pid = 0u32;
    // SAFETY: `handle` is the open pipe `file` owns.
    unsafe { GetNamedPipeServerProcessId(handle, &mut pid) }.map_err(|e| Failure::Refused(e.to_string()))?;
    if !same_user(pid) {
        return Err(Failure::Refused("the pipe is served by another user's program".into()));
    }
    // SAFETY: no pointers; a pid that's gone just fails.
    let _ = unsafe { AllowSetForegroundWindow(pid) };
    let line = encode(request);
    let (tx, rx) = mpsc::channel();
    // On a thread, so a hung app holds this launch up for ANSWER_WITHIN at
    // most; the thread ends with the process.
    std::thread::spawn(move || {
        let mut file = file;
        let answer = (|| {
            file.write_all(line.as_bytes())?;
            let mut b = [0u8; 1];
            file.read_exact(&mut b)?;
            Ok::<u8, std::io::Error>(b[0])
        })();
        let _ = tx.send(answer);
    });
    match rx.recv_timeout(ANSWER_WITHIN) {
        Ok(Ok(b'1')) => Ok(()),
        Ok(Ok(_)) => Err(Failure::Refused("it said no".into())),
        Ok(Err(e)) => Err(Failure::Refused(e.to_string())),
        Err(_) => Err(Failure::Refused(format!("no answer in {} ms", ANSWER_WITHIN.as_millis()))),
    }
}

/// The pipe, opened as a client: Gone when there's none, one wait when
/// every instance is busy.
fn open(name: &str) -> Result<File, Failure> {
    let wide = wide(name);
    for attempt in 0..2 {
        let opened = OpenOptions::new().read(true).write(true).security_qos_flags(SECURITY_IDENTIFICATION).open(name);
        match opened {
            Ok(f) => return Ok(f),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(Failure::Gone),
            Err(e) if e.raw_os_error() == Some(PIPE_BUSY) && attempt == 0 => {
                // SAFETY: `wide` is NUL-terminated and outlives the call.
                let _ = unsafe { WaitNamedPipeW(PCWSTR(wide.as_ptr()), BUSY_WAIT_MS) };
            }
            Err(e) => return Err(Failure::Refused(e.to_string())),
        }
    }
    Err(Failure::Refused("the pipe stayed busy".into()))
}

/// An instance of the pipe; the first one fails with ERROR_ACCESS_DENIED
/// when another process made it already.
fn create(wide: &[u16], first: bool) -> windows::core::Result<File> {
    let mut open_mode = PIPE_ACCESS_DUPLEX;
    if first {
        open_mode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
    }
    // SAFETY: `wide` is NUL-terminated; no security attributes (the default
    // DACL lets only this user, SYSTEM and administrators write).
    let h = unsafe {
        CreateNamedPipeW(
            PCWSTR(wide.as_ptr()),
            open_mode,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            512,
            64 * 1024,
            0,
            None,
        )
    };
    if h.is_invalid() {
        return Err(windows::core::Error::from_win32());
    }
    // SAFETY: a valid handle nothing else owns.
    Ok(unsafe { File::from_raw_handle(h.0) })
}

/// Waits for launches, one connection at a time, each answered on a thread
/// of its own, until the next instance can't be made.
fn serve(wide: Vec<u16>, mut pipe: File, inbox: Inbox) {
    loop {
        let handle = HANDLE(pipe.as_raw_handle());
        // SAFETY: `handle` is the pipe instance `pipe` owns.
        let connected = match unsafe { ConnectNamedPipe(handle, None) } {
            Ok(()) => true,
            // The client came between CreateNamedPipe and ConnectNamedPipe.
            Err(e) if e.code() == ERROR_PIPE_CONNECTED.to_hresult() => true,
            Err(e) => {
                log::warn!("handoff pipe: {e}");
                false
            }
        };
        // The next instance before this one is answered, so there's no gap.
        let next = create(&wide, false);
        if connected {
            let inbox = inbox.clone();
            std::thread::spawn(move || answer(pipe, &inbox));
        }
        match next {
            Ok(n) => pipe = n,
            Err(e) => {
                log::warn!("handoff pipe: {e}; later launches open a process of their own");
                return;
            }
        }
    }
}

fn answer(pipe: File, inbox: &Inbox) {
    let handle = HANDLE(pipe.as_raw_handle());
    let mut pid = 0u32;
    // SAFETY: `handle` is the connected pipe `pipe` owns.
    let ours = unsafe { GetNamedPipeClientProcessId(handle, &mut pid) }.is_ok() && same_user(pid);
    let reply = if !ours {
        log::warn!("handoff pipe: a client that isn't this user's (pid {pid}) was turned away");
        b'0'
    } else {
        let mut line = Vec::new();
        let read = BufReader::new((&pipe).take(MAX_MESSAGE as u64)).read_until(b'\n', &mut line);
        let request = read
            .map_err(|e| e.to_string())
            .and_then(|_| String::from_utf8(line).map_err(|e| e.to_string()))
            .and_then(|text| decode(&text));
        match request.and_then(|r| inbox.take(r)) {
            Ok(()) => b'1',
            Err(why) => {
                log::warn!("handoff pipe: a request from pid {pid} wasn't taken: {why}");
                b'0'
            }
        }
    };
    let mut pipe = pipe;
    let _ = pipe.write_all(&[reply]);
    // FlushFileBuffers: waits until the client has read the answer.
    let _ = pipe.sync_all();
    // SAFETY: as above; the handle is closed when `pipe` drops.
    let _ = unsafe { DisconnectNamedPipe(handle) };
}

fn pipe_name() -> Result<String, String> {
    // SAFETY: the pseudo-handle needs no closing.
    let token = Token::of(unsafe { GetCurrentProcess() }).map_err(|e| e.to_string())?;
    let user = token.user().map_err(|e| e.to_string())?;
    let session = token.session().map_err(|e| e.to_string())?;
    let sid = sid_string(sid_of(&user))?;
    Ok(format!(r"\\.\pipe\{STEM}-{sid}-{session}"))
}

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Whether process `pid` runs as the same user as this one.
fn same_user(pid: u32) -> bool {
    let theirs = (|| {
        // SAFETY: no pointers; the handle is closed below.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)? };
        let token = Token::of(process);
        // SAFETY: the handle OpenProcess returned.
        let _ = unsafe { CloseHandle(process) };
        token?.user()
    })();
    // SAFETY: the pseudo-handle needs no closing.
    let mine = Token::of(unsafe { GetCurrentProcess() }).and_then(|t| t.user());
    match (mine, theirs) {
        // SAFETY: both buffers hold a TOKEN_USER that GetTokenInformation wrote.
        (Ok(a), Ok(b)) => unsafe { EqualSid(sid_of(&a), sid_of(&b)) }.is_ok(),
        _ => false,
    }
}

/// A process's access token, closed on drop.
struct Token(HANDLE);

impl Drop for Token {
    fn drop(&mut self) {
        // SAFETY: the handle OpenProcessToken returned, closed once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

impl Token {
    fn of(process: HANDLE) -> windows::core::Result<Token> {
        let mut h = HANDLE::default();
        // SAFETY: `h` is written on success only.
        unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut h)? };
        Ok(Token(h))
    }

    /// The token's TOKEN_USER and the SID after it, in a buffer aligned for it.
    fn user(&self) -> windows::core::Result<Vec<u64>> {
        let mut len = 0u32;
        // SAFETY: a size query; it fails with the size it needs.
        let _ = unsafe { GetTokenInformation(self.0, TokenUser, None, 0, &mut len) };
        let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
        let size = (buf.len() * 8) as u32;
        // SAFETY: `buf` has `size` writable bytes, aligned for TOKEN_USER.
        unsafe { GetTokenInformation(self.0, TokenUser, Some(buf.as_mut_ptr().cast()), size, &mut len)? };
        Ok(buf)
    }

    fn session(&self) -> windows::core::Result<u32> {
        let mut id = 0u32;
        let mut len = 0u32;
        // SAFETY: TokenSessionId writes one DWORD.
        unsafe { GetTokenInformation(self.0, TokenSessionId, Some((&mut id as *mut u32).cast()), 4, &mut len)? };
        Ok(id)
    }
}

fn sid_of(user: &[u64]) -> PSID {
    // SAFETY: `user` holds a TOKEN_USER (`Token::user`), whose SID points
    // into the same buffer.
    unsafe { (*(user.as_ptr() as *const TOKEN_USER)).User.Sid }
}

fn sid_string(sid: PSID) -> Result<String, String> {
    let mut s = PWSTR::null();
    // SAFETY: `sid` is valid (sid_of); the string is freed with LocalFree.
    unsafe {
        ConvertSidToStringSidW(sid, &mut s).map_err(|e| e.to_string())?;
        let out = s.to_string().map_err(|e| e.to_string());
        let _ = LocalFree(HLOCAL(s.0 as _));
        out
    }
}
