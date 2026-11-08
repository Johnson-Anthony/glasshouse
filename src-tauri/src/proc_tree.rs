//! Spawn a process so its whole tree can be killed later. On Unix the child
//! leads a new process group; on Windows it goes into a job object.
//! `Child::kill` only reaches the direct child, so a timed-out script's own
//! children (a background `sleep`, a server it started) kept running.
//!
//! Only std plus libc / windows, so the Windows half can be type-checked on
//! its own. See docs/decisions/2026-11-08-script-kill-tree.md.

use std::io;
use std::process::{Child, Command};

/// A spawned child plus whatever reaches its descendants.
pub struct TreeChild {
    pub child: Child,
    /// None if the child couldn't be put in a job; then only it is killed.
    #[cfg(windows)]
    job: Option<windows::Win32::Foundation::HANDLE>,
}

/// Spawn `cmd` as the root of a tree `TreeChild::kill_tree` can kill.
pub fn spawn(cmd: &mut Command) -> io::Result<TreeChild> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // A new group whose id is the child's pid. A non-interactive shell
        // has no job control, so its background jobs stay in this group.
        cmd.process_group(0);
        Ok(TreeChild { child: cmd.spawn()? })
    }
    #[cfg(windows)]
    {
        let child = cmd.spawn()?;
        // Processes the child starts from here on join the job too. Anything
        // it started before this line (microseconds after CreateProcess)
        // wouldn't, but powershell and cmd.exe need far longer than that
        // before they run a script's first command.
        let job = assign_job(&child);
        Ok(TreeChild { child, job })
    }
}

impl TreeChild {
    /// Kill the child and everything still in its group or job, then reap
    /// the child. Processes that left the group (`setsid`) or broke away
    /// from the job aren't reached.
    pub fn kill_tree(&mut self) {
        #[cfg(unix)]
        {
            // The child isn't reaped until below, so its pid (the group id)
            // can't have been reused by now.
            let pgid = self.child.id() as libc::pid_t;
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            if let Some(job) = self.job {
                unsafe {
                    let _ = windows::Win32::System::JobObjects::TerminateJobObject(job, 1);
                }
            }
        }
        // Covers a child that never made it into a job.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(windows)]
impl Drop for TreeChild {
    fn drop(&mut self) {
        if let Some(job) = self.job.take() {
            // The job has no KILL_ON_JOB_CLOSE limit, so closing it kills
            // nothing: after a normal exit, processes the child left running
            // keep running, as on Unix.
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(job);
            }
        }
    }
}

#[cfg(windows)]
fn assign_job(child: &Child) -> Option<windows::Win32::Foundation::HANDLE> {
    use std::os::windows::io::AsRawHandle;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW};
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
        if AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())).is_err() {
            let _ = CloseHandle(job);
            return None;
        }
        Some(job)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    /// Spawn `cmd` with stdout piped and return the tree, the first line it
    /// prints (the background child's pid, in these tests), and the pipe.
    /// Callers keep the pipe open so no process dies writing to a closed one.
    fn spawn_and_read_pid(cmd: &mut Command) -> (TreeChild, u32, impl Sized) {
        let mut tree = spawn(cmd.stdin(Stdio::null()).stdout(Stdio::piped())).unwrap();
        let mut out = std::io::BufReader::new(tree.child.stdout.take().unwrap());
        let mut line = String::new();
        out.read_line(&mut line).unwrap();
        let pid = line.trim().parse().unwrap_or_else(|_| panic!("no pid in {:?}", line));
        (tree, pid, out)
    }

    /// Poll `alive(pid)` until it's false, for up to 5 s.
    fn gone_within(pid: u32, alive: impl Fn(u32) -> bool) -> bool {
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until {
            if !alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// Alive = in /proc and not a zombie. A killed orphan can sit as a
    /// zombie under whichever ancestor reaps orphans, which may not reap.
    #[cfg(target_os = "linux")]
    fn alive(pid: u32) -> bool {
        match std::fs::read_to_string(format!("/proc/{}/stat", pid)) {
            Ok(stat) => stat.rsplit(')').next().and_then(|s| s.trim().chars().next()) != Some('Z'),
            Err(_) => false,
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn kill_tree_kills_a_background_child() {
        let (mut tree, bg, _out) =
            spawn_and_read_pid(Command::new("sh").args(["-c", "sleep 30 & echo $!; wait"]));
        assert!(alive(bg));
        tree.kill_tree();
        assert!(gone_within(bg, alive), "background child {} survived kill_tree", bg);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_normal_exit_leaves_background_children_alone() {
        // Only a timeout kills the tree; a script may start something on
        // purpose that should outlive it.
        let (mut tree, bg, _out) =
            spawn_and_read_pid(Command::new("sh").args(["-c", "sleep 30 & echo $!"]));
        tree.child.wait().unwrap();
        drop(tree);
        assert!(alive(bg));
        unsafe {
            libc::kill(bg as libc::pid_t, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    fn alive(pid: u32) -> bool {
        let out = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH", "/FO", "CSV"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).contains(&format!("\"{}\"", pid))
    }

    #[cfg(windows)]
    #[test]
    fn kill_tree_kills_a_background_child() {
        // The background child is a second PowerShell that just sleeps (it
        // writes nothing, so it can't die on a full or closed pipe).
        let script = "$p = Start-Process -FilePath powershell.exe -NoNewWindow -PassThru \
                      -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60'; \
                      Write-Output $p.Id; Start-Sleep -Seconds 60";
        let (mut tree, bg, _out) = spawn_and_read_pid(Command::new("powershell.exe").args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ]));
        assert!(tree.job.is_some(), "the child wasn't put in a job");
        assert!(alive(bg));
        tree.kill_tree();
        assert!(gone_within(bg, alive), "background child {} survived kill_tree", bg);
    }
}
