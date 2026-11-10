//! The reader thread's text decoding, and input to a session that's gone.

use super::*;
use crate::commands::testing::{s, Scratch};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

const SIZE: PtySize = PtySize {
    rows: 24,
    cols: 80,
    pixel_width: 0,
    pixel_height: 0,
};
const TIMEOUT: Duration = Duration::from_secs(10);

/// All output of `sh -c script` in a pty, until the reader ends.
fn output_of(script: &str) -> String {
    let sessions = Sessions::default();
    let (data_tx, data_rx) = mpsc::channel();
    let mut cmd = CommandBuilder::new("sh");
    cmd.args(["-c", script]);
    spawn_session(&sessions, "pty-out".into(), cmd, SIZE, move |d| data_tx.send(d).unwrap(), |_| {})
        .unwrap();
    let mut out = String::new();
    loop {
        match data_rx.recv_timeout(TIMEOUT) {
            Ok(chunk) => out.push_str(&chunk),
            Err(RecvTimeoutError::Disconnected) => return out,
            Err(RecvTimeoutError::Timeout) => panic!("reader never finished; got {} bytes", out.len()),
        }
    }
}

#[test]
fn multibyte_text_split_across_reads_arrives_intact() {
    // The reader takes 4096 bytes at a time. 4095 ASCII bytes put the first
    // 2-byte character across that boundary, and 45 KB of 2-, 3- and 4-byte
    // characters after it leave many more reads ending mid-character.
    let d = Scratch::new("pty-utf8");
    let unit = "é€😀";
    let body = format!("{}{}", "a".repeat(4095), unit.repeat(5000));
    let file = d.join("text");
    std::fs::write(&file, &body).unwrap();

    let out = output_of(&format!("cat '{}'", s(&file)));
    assert!(!out.contains('\u{FFFD}'), "replacement characters in the output");
    assert_eq!(out.matches(unit).count(), 5000);
    assert!(out.starts_with(&"a".repeat(4095)));
}

#[test]
fn invalid_bytes_still_come_through_as_replacements() {
    let out = output_of(r"printf 'ok\377ok'");
    // Under load the pty sometimes adds a trailing CRLF; only the bytes matter.
    assert_eq!(out.trim_end_matches(['\r', '\n']), "ok\u{FFFD}ok");
}

#[test]
fn input_for_an_unknown_session_is_an_error() {
    let sessions = Sessions::default();
    let err = queue_input(&sessions, "pty-404", "ls\n".into()).unwrap_err();
    assert_eq!(err, "no pty session: pty-404");
}
