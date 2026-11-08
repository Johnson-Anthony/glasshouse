// Runs before any app module: the app decides at import time whether it's
// inside Tauri (src/api.ts) and whether it's on Windows (src/platform.ts).
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createBackend } from "./backend";

export const THEMES = [
  "tokyo-night", "catppuccin-mocha", "gruvbox-dark", "rose-pine",
  "everforest", "solarized-dark", "green-crt", "synthwave",
] as const;

const params = new URLSearchParams(location.search);
export const initialTheme = THEMES.find(t => t === params.get("theme")) ?? "tokyo-night";

// Always the Linux flavor, whatever the visitor runs (see the site plan).
for (const [key, value] of [["userAgent", "Mozilla/5.0 (X11; Linux x86_64) glasshouse-demo"], ["platform", "Linux x86_64"]]) {
  try { Object.defineProperty(navigator, key, { get: () => value, configurable: true }); } catch { /* keep the real one */ }
}

// The demo keeps its settings in memory: every visit starts from the same
// state, and nothing lands in the site's real localStorage.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
const storage = new MemoryStorage();
storage.setItem("glasshouse.tweaks", JSON.stringify({ theme: initialTheme }));
Object.defineProperty(window, "localStorage", { value: storage, configurable: true });

async function fetchDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Event listeners, kept here rather than by mockIPC's shouldMockEvents, whose
// unlisten never removes anything (stale handlers then warn on every emit).
const listeners = new Map<string, Set<number>>();
type Internals = { runCallback(id: number, data: unknown): void; callbacks: Map<number, unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;

function emit(event: string, payload: unknown): void {
  // Async, like events from the real backend.
  setTimeout(() => {
    for (const id of listeners.get(event) ?? []) {
      if (internals().callbacks.has(id)) internals().runCallback(id, { event, id, payload });
      else listeners.get(event)!.delete(id);
    }
  }, 0);
}

export const backend = createBackend({
  emit,
  notice: message => {
    void import("../../../src/components").then(({ dialogs }) =>
      dialogs.showToast({ message, variant: "info" }));
  },
  fetchDataUrl,
  openExternal: url => {
    if (/^https:\/\//.test(url)) window.open(url, "_blank", "noopener");
  },
});

mockWindows("main");
mockIPC((cmd, args) => {
  const a = (args ?? {}) as Record<string, unknown>;
  if (cmd === "plugin:event|listen") {
    const id = a.handler as number;
    const set = listeners.get(a.event as string) ?? new Set<number>();
    listeners.set(a.event as string, set.add(id));
    return id;
  }
  if (cmd === "plugin:event|unlisten") {
    listeners.get(a.event as string)?.delete(a.eventId as number);
    return null;
  }
  if (cmd === "plugin:event|emit") {
    emit(a.event as string, a.payload);
    return null;
  }
  return backend.invoke(cmd, a);
});
