//! Progress and cancellation for long operations: hashing, copying, finding.
//!
//! The frontend picks an op id and passes it along with the command. The
//! command does its work through an [`Op`], which sends `op-progress` events
//! and notices a `cancel_op` for that id. Without an id the op is untracked:
//! no events, and nothing can cancel it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// The error a cancelled op fails with; `isCancelled` in the frontend's
/// ops.ts matches it.
pub const CANCELLED: &str = "cancelled";

/// Payload of the `op-progress` event.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpProgress {
    pub op_id: String,
    pub done: u64,
    /// `None` when the size of the job isn't known up front (a search).
    pub total: Option<u64>,
}

/// At most this many events a second per op, plenty for a progress bar.
const EMIT_EVERY: Duration = Duration::from_millis(100);
/// How long a cancel that arrives before its op starts is kept for it.
const EARLY_CANCEL_TTL: Duration = Duration::from_secs(10);
const NO_TOTAL: u64 = u64::MAX;

struct Entry {
    cancel: Arc<AtomicBool>,
    /// When a cancel created this entry with no op running under the id.
    /// `None` once an op has claimed it.
    unclaimed_since: Option<Instant>,
}

type Entries = Arc<Mutex<HashMap<String, Entry>>>;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The ops currently running, by id; managed state.
#[derive(Default)]
pub struct OpRegistry {
    entries: Entries,
}

impl OpRegistry {
    /// Track the op `id`, sending its progress to the frontend. `None` gives
    /// an untracked op.
    pub fn start(&self, id: Option<String>, app: &AppHandle) -> Op {
        let app = app.clone();
        self.start_with(id, EMIT_EVERY, move |p| {
            let _ = app.emit("op-progress", p);
        })
    }

    /// `start` with the event sink and rate limit given, for tests.
    pub(crate) fn start_with(
        &self,
        id: Option<String>,
        every: Duration,
        emit: impl Fn(OpProgress) + Send + Sync + 'static,
    ) -> Op {
        let Some(id) = id else {
            return Op::untracked();
        };
        let mut entries = lock(&self.entries);
        // Cancels for ops that never started (or had already finished).
        entries.retain(|_, e| e.unclaimed_since.is_none_or(|t| t.elapsed() < EARLY_CANCEL_TTL));
        let entry = entries.entry(id.clone()).or_insert_with(|| Entry {
            cancel: Arc::default(),
            unclaimed_since: None,
        });
        entry.unclaimed_since = None;
        let cancel = Arc::clone(&entry.cancel);
        drop(entries);
        Op {
            id: Some(id),
            cancel,
            emit: Some(Box::new(emit)),
            every,
            done: AtomicU64::new(0),
            total: AtomicU64::new(NO_TOTAL),
            last_emit: Mutex::new(None),
            entries: Some(Arc::clone(&self.entries)),
        }
    }

    /// Cancel the op `id`. One that hasn't started yet is cancelled as soon
    /// as it does (the frontend can't know when the command begins).
    pub fn cancel(&self, id: &str) {
        let mut entries = lock(&self.entries);
        let entry = entries.entry(id.to_string()).or_insert_with(|| Entry {
            cancel: Arc::default(),
            unclaimed_since: Some(Instant::now()),
        });
        entry.cancel.store(true, Ordering::SeqCst);
    }
}

/// Stop the op `op_id` at its next check; it then fails with "cancelled".
#[tauri::command]
pub fn cancel_op(ops: State<'_, OpRegistry>, op_id: String) {
    ops.cancel(&op_id);
}

/// A running op: its cancel flag and progress. Shared by reference across
/// threads (the parallel search walkers), so everything here is atomic.
pub struct Op {
    id: Option<String>,
    cancel: Arc<AtomicBool>,
    emit: Option<Box<dyn Fn(OpProgress) + Send + Sync>>,
    every: Duration,
    done: AtomicU64,
    total: AtomicU64,
    last_emit: Mutex<Option<Instant>>,
    entries: Option<Entries>,
}

impl Op {
    /// For a caller that passed no id, or an internal use (a cross-volume
    /// move's copy): never cancelled, sends nothing.
    pub fn untracked() -> Op {
        Op {
            id: None,
            cancel: Arc::default(),
            emit: None,
            every: EMIT_EVERY,
            done: AtomicU64::new(0),
            total: AtomicU64::new(NO_TOTAL),
            last_emit: Mutex::new(None),
            entries: None,
        }
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// `Err("cancelled")` once the op is cancelled.
    pub fn check(&self) -> Result<(), String> {
        if self.cancelled() {
            Err(CANCELLED.to_string())
        } else {
            Ok(())
        }
    }

    /// `check` for io code. Not `ErrorKind::Interrupted`: std's io loops
    /// retry that.
    pub fn check_io(&self) -> std::io::Result<()> {
        if self.cancelled() {
            Err(std::io::Error::other(CANCELLED))
        } else {
            Ok(())
        }
    }

    pub fn set_total(&self, total: u64) {
        self.total.store(total, Ordering::SeqCst);
        self.report();
    }

    /// Count `n` more units done (bytes, or files searched).
    pub fn advance(&self, n: u64) {
        self.done.fetch_add(n, Ordering::SeqCst);
        self.report();
    }

    fn report(&self) {
        let (Some(id), Some(emit)) = (&self.id, &self.emit) else {
            return;
        };
        {
            let mut last = lock(&self.last_emit);
            if last.is_some_and(|t| t.elapsed() < self.every) {
                return;
            }
            *last = Some(Instant::now());
        }
        let total = self.total.load(Ordering::SeqCst);
        emit(OpProgress {
            op_id: id.clone(),
            done: self.done.load(Ordering::SeqCst),
            total: (total != NO_TOTAL).then_some(total),
        });
    }
}

impl Drop for Op {
    fn drop(&mut self) {
        if let (Some(entries), Some(id)) = (&self.entries, &self.id) {
            lock(entries).remove(id);
        }
    }
}

/// Test helpers: an event sink that records, and one that cancels.
#[cfg(test)]
pub(crate) mod testing {
    use super::*;

    pub(crate) type Events = Arc<Mutex<Vec<OpProgress>>>;

    /// A registry, plus an op `id` on it whose every event is recorded.
    pub(crate) fn recorded(id: &str) -> (Arc<OpRegistry>, Op, Events) {
        let reg = Arc::new(OpRegistry::default());
        let events = Events::default();
        let sink = Arc::clone(&events);
        let op = reg.start_with(Some(id.into()), Duration::ZERO, move |p| lock(&sink).push(p));
        (reg, op, events)
    }

    /// An op `id` that cancels itself at its first progress event, i.e. once
    /// some of the work is done. Returns the events it saw.
    pub(crate) fn cancels_at_first_event(id: &str) -> (Arc<OpRegistry>, Op, Events) {
        let reg = Arc::new(OpRegistry::default());
        let events = Events::default();
        let (sink, canceller, cid) = (Arc::clone(&events), Arc::clone(&reg), id.to_string());
        let op = reg.start_with(Some(id.into()), Duration::ZERO, move |p| {
            lock(&sink).push(p);
            canceller.cancel(&cid);
        });
        (reg, op, events)
    }

    pub(crate) fn events(e: &Events) -> Vec<OpProgress> {
        lock(e).clone()
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    #[test]
    fn progress_is_sent_at_most_once_per_interval() {
        let reg = OpRegistry::default();
        let sent = Events::default();
        let sink = Arc::clone(&sent);
        let op = reg.start_with(Some("slow".into()), Duration::from_secs(3600), move |p| {
            lock(&sink).push(p)
        });
        op.set_total(10);
        op.advance(1);
        op.advance(1);
        // Only the first report goes out within the hour.
        assert_eq!(
            events(&sent),
            vec![OpProgress { op_id: "slow".into(), done: 0, total: Some(10) }]
        );

        let (_reg, op, sent) = recorded("fast");
        op.advance(3);
        op.advance(4);
        let got: Vec<_> = events(&sent).iter().map(|p| (p.done, p.total)).collect();
        assert_eq!(got, vec![(3, None), (7, None)]);
    }

    #[test]
    fn cancel_reaches_a_running_op_and_drop_unregisters() {
        let (reg, op, _) = recorded("run");
        assert_eq!(op.check(), Ok(()));
        reg.cancel("run");
        assert!(op.cancelled());
        assert_eq!(op.check(), Err(CANCELLED.to_string()));
        assert_eq!(op.check_io().unwrap_err().to_string(), CANCELLED);
        drop(op);
        assert!(lock(&reg.entries).is_empty());
    }

    #[test]
    fn a_cancel_that_comes_first_stops_the_op_when_it_starts() {
        let reg = OpRegistry::default();
        reg.cancel("early");
        let op = reg.start_with(Some("early".into()), Duration::ZERO, |_| {});
        assert!(op.cancelled());
        // Other ids are unaffected.
        assert!(!reg.start_with(Some("other".into()), Duration::ZERO, |_| {}).cancelled());
    }

    #[test]
    fn an_unclaimed_cancel_expires() {
        let reg = OpRegistry::default();
        reg.cancel("gone");
        lock(&reg.entries).get_mut("gone").unwrap().unclaimed_since =
            Instant::now().checked_sub(EARLY_CANCEL_TTL + Duration::from_secs(1));
        // Any start sweeps it, so a later op reusing the id isn't cancelled.
        drop(reg.start_with(Some("next".into()), Duration::ZERO, |_| {}));
        assert!(lock(&reg.entries).is_empty());
        assert!(!reg.start_with(Some("gone".into()), Duration::ZERO, |_| {}).cancelled());
    }

    #[test]
    fn an_untracked_op_is_never_cancelled_and_sends_nothing() {
        let reg = OpRegistry::default();
        let op = reg.start_with(None, Duration::ZERO, |_| panic!("untracked ops send nothing"));
        op.set_total(5);
        op.advance(5);
        reg.cancel("anything");
        assert!(!op.cancelled());
        assert_eq!(op.check(), Ok(()));
    }
}
