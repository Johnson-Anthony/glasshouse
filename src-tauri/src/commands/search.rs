use serde::Serialize;
use tauri::{AppHandle, State};

use crate::ops::{Op, OpRegistry};

// ---------- find in files (ripgrep-style content search) ----------

#[derive(Debug, Serialize, Clone)]
pub struct FindMatch {
    pub path: String,
    pub line_no: u32,
    pub line: String,
}

const FIND_MAX_FILE_BYTES: u64 = 1 << 20; // 1 MiB per task spec
const FIND_HARD_CAP: u32 = 10_000;

/// Search the files under `root` for `query`. With `op_id` it reports files
/// searched and can be cancelled (see ops.rs); a cancelled search returns
/// "cancelled", not the matches found so far.
#[tauri::command(async)]
pub fn find_in_files(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    root: String,
    query: String,
    case_insensitive: bool,
    max_results: u32,
    op_id: Option<String>,
) -> Result<Vec<FindMatch>, String> {
    search_contents(&root, &query, case_insensitive, max_results, &ops.start(op_id, &app))
}

fn search_contents(
    root: &str,
    query: &str,
    case_insensitive: bool,
    max_results: u32,
    op: &Op,
) -> Result<Vec<FindMatch>, String> {
    use grep_regex::RegexMatcherBuilder;
    use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
    use ignore::WalkBuilder;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    if query.is_empty() {
        return Ok(Vec::new());
    }
    let cap = if max_results == 0 {
        500
    } else {
        max_results.min(FIND_HARD_CAP)
    } as usize;

    let pattern = regex::escape(query);
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive)
        .build(&pattern)
        .map_err(|e| format!("regex build: {}", e))?;

    let results: Arc<Mutex<Vec<FindMatch>>> = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(AtomicBool::new(false));

    let walker = WalkBuilder::new(root).standard_filters(true).build_parallel();

    walker.run(|| {
        let results = Arc::clone(&results);
        let done = Arc::clone(&done);
        let matcher = matcher.clone();
        Box::new(move |entry| {
            use ignore::WalkState;
            if done.load(Ordering::Relaxed) || op.cancelled() {
                return WalkState::Quit;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };
            // Only search regular files.
            let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
            if !is_file {
                return WalkState::Continue;
            }
            // Skip files > 1 MiB.
            if let Ok(meta) = entry.metadata() {
                if meta.len() > FIND_MAX_FILE_BYTES {
                    return WalkState::Continue;
                }
            }
            let path = entry.path().to_path_buf();

            struct CollectSink<'a> {
                path: String,
                out: &'a Arc<Mutex<Vec<FindMatch>>>,
                cap: usize,
                done: &'a Arc<AtomicBool>,
            }
            impl<'a> Sink for CollectSink<'a> {
                type Error = std::io::Error;
                fn matched(
                    &mut self,
                    _searcher: &Searcher,
                    mat: &SinkMatch<'_>,
                ) -> Result<bool, Self::Error> {
                    let line_no = mat.line_number().unwrap_or(0) as u32;
                    let bytes = mat.bytes();
                    let line = String::from_utf8_lossy(bytes)
                        .trim_end_matches(['\n', '\r'])
                        .to_string();
                    let mut guard = match self.out.lock() {
                        Ok(g) => g,
                        Err(p) => p.into_inner(),
                    };
                    if guard.len() >= self.cap {
                        self.done.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    guard.push(FindMatch {
                        path: self.path.clone(),
                        line_no,
                        line,
                    });
                    if guard.len() >= self.cap {
                        self.done.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    Ok(true)
                }
            }

            let mut searcher = SearcherBuilder::new()
                .binary_detection(BinaryDetection::quit(b'\x00'))
                .line_number(true)
                .build();
            let sink = CollectSink {
                path: path.to_string_lossy().to_string(),
                out: &results,
                cap,
                done: &done,
            };
            let _ = searcher.search_path(&matcher, &path, sink);
            op.advance(1);

            if done.load(Ordering::Relaxed) {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    let mut out = match Arc::try_unwrap(results) {
        Ok(m) => m.into_inner().unwrap_or_default(),
        Err(arc) => {
            let guard = arc.lock().map_err(|e| e.to_string())?;
            guard.clone()
        }
    };
    if out.len() > cap {
        out.truncate(cap);
    }
    op.check()?;
    Ok(out)
}

// ---------- find file by name ----------

/// Walk `root` recursively via ignore::WalkBuilder honoring .gitignore/hidden,
/// and return up to `max_results` paths whose filename contains `pattern`
/// (case-insensitive substring match). Empty pattern → empty result.
/// With `op_id` it reports entries looked at and can be cancelled.
#[tauri::command(async)]
pub fn find_file_by_name(
    app: AppHandle,
    ops: State<'_, OpRegistry>,
    root: String,
    pattern: String,
    max_results: u32,
    op_id: Option<String>,
) -> Result<Vec<String>, String> {
    search_names(&root, &pattern, max_results, &ops.start(op_id, &app))
}

fn search_names(root: &str, pattern: &str, max_results: u32, op: &Op) -> Result<Vec<String>, String> {
    use ignore::WalkBuilder;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    if pattern.is_empty() {
        return Ok(Vec::new());
    }
    let cap = if max_results == 0 { 500 } else { max_results.min(10_000) } as usize;
    let needle = pattern.to_ascii_lowercase();

    let results: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(AtomicBool::new(false));

    let walker = WalkBuilder::new(root).standard_filters(true).build_parallel();
    walker.run(|| {
        let results = Arc::clone(&results);
        let done = Arc::clone(&done);
        let needle = needle.clone();
        Box::new(move |entry| {
            use ignore::WalkState;
            if done.load(Ordering::Relaxed) || op.cancelled() {
                return WalkState::Quit;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };
            op.advance(1);
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if !name.contains(&needle) {
                return WalkState::Continue;
            }
            let path_str = entry.path().to_string_lossy().to_string();
            let mut guard = match results.lock() {
                Ok(g) => g,
                Err(_) => return WalkState::Continue,
            };
            if guard.len() >= cap {
                done.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }
            guard.push(path_str);
            if guard.len() >= cap {
                done.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }
            WalkState::Continue
        })
    });

    let out = Arc::try_unwrap(results)
        .map(|m| m.into_inner().unwrap_or_default())
        .unwrap_or_else(|arc| arc.lock().map(|g| g.clone()).unwrap_or_default());
    op.check()?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testing::{put, s, Scratch};
    use crate::ops::testing::{events, recorded};
    use crate::ops::{OpRegistry, CANCELLED};
    use std::time::Duration;

    fn three_files(name: &str) -> Scratch {
        let d = Scratch::new(name);
        put(&d.join("a.txt"), "needle here");
        put(&d.join("b.txt"), "nothing");
        put(&d.join("sub/c.txt"), "a needle too");
        d
    }

    #[test]
    fn searches_report_what_they_looked_at() {
        let d = three_files("find-progress");
        let (_reg, op, seen) = recorded("f1");
        let found = search_contents(&s(d.path()), "needle", false, 0, &op).unwrap();
        assert_eq!(found.len(), 2);
        // One event per file searched; no total for a search.
        let seen = events(&seen);
        assert_eq!(seen.iter().map(|p| p.done).max(), Some(3));
        assert!(seen.iter().all(|p| p.total.is_none()));

        let (_reg, op, seen) = recorded("f2");
        assert_eq!(search_names(&s(d.path()), "C.TXT", 0, &op).unwrap().len(), 1);
        // The root, a.txt, b.txt, sub and sub/c.txt.
        assert_eq!(events(&seen).iter().map(|p| p.done).max(), Some(5));
    }

    #[test]
    fn a_cancelled_search_returns_cancelled_not_partial_results() {
        let d = three_files("find-cancel");
        let reg = OpRegistry::default();
        reg.cancel("f3");
        let op = reg.start_with(Some("f3".into()), Duration::ZERO, |_| {});
        let err = search_contents(&s(d.path()), "needle", false, 0, &op).unwrap_err();
        assert_eq!(err, CANCELLED);
        reg.cancel("f4");
        let op = reg.start_with(Some("f4".into()), Duration::ZERO, |_| {});
        assert_eq!(search_names(&s(d.path()), "txt", 0, &op), Err(CANCELLED.to_string()));
    }
}
