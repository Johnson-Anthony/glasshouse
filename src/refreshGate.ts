// When a tab lists its folder (state.ts `fetchAll`). While a big paste lands,
// the watcher reports the folder about every 75 ms, and each report used to
// start a listing and a git status, even with one still running. The gate
// lets one listing run at a time, and starts a quiet one (a watcher report,
// the poll, a refresh) no sooner than REFRESH_GAP_MS after the last ended.
// Reports in between become one trailing listing, so the last change is
// always shown.

/** The least time between the end of one listing and the start of a quiet one. */
export const REFRESH_GAP_MS = 500;

export class RefreshGate<A> {
  private running = 0;
  private endedAt = -Infinity;
  private queued: { args: A } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly run: (args: A) => Promise<void>,
    private readonly gapMs = REFRESH_GAP_MS,
  ) {}

  /** A navigation: list at once, even beside a listing still running (its
   *  result is dropped), and forget any queued refresh. */
  start(args: A): void {
    this.cancel();
    this.launch(args);
  }

  /** A quiet refresh: list at once if nothing is running and the last
   *  listing ended at least the gap ago, else once later, with the latest
   *  arguments. */
  refresh(args: A): void {
    if (this.running === 0 && this.timer === null && Date.now() - this.endedAt >= this.gapMs) {
      this.launch(args);
      return;
    }
    this.queued = { args };
    if (this.running === 0) this.schedule();
  }

  /** Forget the queued refresh, if any (leaving a folder, unmounting). */
  cancel(): void {
    this.queued = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private launch(args: A): void {
    this.running++;
    void this.run(args).catch(() => { /* run reports its own errors */ }).finally(() => {
      this.running--;
      this.endedAt = Date.now();
      if (this.running === 0 && this.queued) this.schedule();
    });
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const next = this.queued;
      this.queued = null;
      if (next) this.launch(next.args);
    }, Math.max(0, this.endedAt + this.gapMs - Date.now()));
  }
}
