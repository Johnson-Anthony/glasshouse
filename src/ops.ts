// Long operations with progress and a Cancel: the opStore wired to the
// backend. See src-tauri/src/ops.rs and docs/decisions/*-op-progress-*.md.
import { listen } from "@tauri-apps/api/event";
import { cancelOp, TAURI_AVAILABLE } from "./api";
import { OpStore, type OpProgress, type OpUnit } from "./opStore";

export { isCancelled, newOpId } from "./opStore";

export const opStore = new OpStore(id => { void cancelOp(id); });

let listening = false;
function listenOnce(): void {
  if (listening || !TAURI_AVAILABLE) return;
  listening = true;
  void listen<OpProgress>("op-progress", e => opStore.progress(e.payload));
}

/** Run `work` as one op in the tray, labelled `label`. Each `track()` gives
 *  a backend op id to pass to a hash, copy or find call; Cancel cancels them
 *  all, and the calls then reject with "cancelled" (`isCancelled`). `unit`
 *  is what the calls count: bytes (hash, copy) or items (find). */
export async function runOp<T>(
  label: string,
  work: (track: () => string) => Promise<T>,
  unit: OpUnit = "bytes",
): Promise<T> {
  listenOnce();
  const key = opStore.begin(label, unit);
  try {
    return await work(() => opStore.track(key));
  } finally {
    opStore.end(key);
  }
}
