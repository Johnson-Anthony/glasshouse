// A setting every window shares through localStorage: the window that
// changes it writes it, and the others take it from the `storage` event
// (which fires in every other window of the same origin) without writing it
// back. Every glasshouse window is one process and one origin
// (src-tauri/src/app_windows.rs), so Preferences apply to all of them.

import { useEffect, useRef } from "react";

/** Keeps `value` saved under `key`, and takes another window's change to
 *  it through `set`. `read` turns the saved text back into a value (and
 *  may throw on a bad one, which is then ignored); it and `set` must not
 *  change from one render to the next. */
export function useSharedSetting<T>(key: string, value: T, set: (v: T) => void, read: (raw: string) => T): void {
  const written = useRef<string | null>(null);
  useEffect(() => {
    const json = JSON.stringify(value);
    if (json !== written.current) {
      try { localStorage.setItem(key, json); } catch { /* quota, or storage turned off */ }
    }
    written.current = json;
  }, [key, value]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null || e.newValue === written.current) return;
      let next: T;
      try { next = read(e.newValue); } catch { return; }
      written.current = JSON.stringify(next);
      set(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
