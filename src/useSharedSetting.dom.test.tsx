// @vitest-environment happy-dom
// A setting shared by every window: saved when it changes here, taken from
// another window's `storage` event without being written back.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSharedSetting } from "./useSharedSetting";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "test.shared";
type Value = { theme: string; zoom: number };
/** Fills in what a saved value leaves out, as App's readTweaks does. */
const read = (raw: string): Value => ({ theme: "system", zoom: 1, ...JSON.parse(raw) });

let host: HTMLDivElement;
let root: Root;
let value: Value;
let set: (v: Value) => void;
let renders = 0;

function Harness() {
  const [v, setV] = useState<Value>({ theme: "system", zoom: 1 });
  value = v;
  set = setV;
  renders++;
  useSharedSetting(KEY, v, setV, read);
  return null;
}

/** What another window's write looks like here. */
const fromOtherWindow = (newValue: string | null, key = KEY) =>
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key, newValue })); });

beforeEach(() => {
  localStorage.clear();
  renders = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("useSharedSetting", () => {
  it("saves the value when it changes here", () => {
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ theme: "system", zoom: 1 });
    act(() => set({ theme: "nord", zoom: 1.1 }));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ theme: "nord", zoom: 1.1 });
  });

  it("takes another window's change, read as this window reads its own, and doesn't write it back", () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    fromOtherWindow(JSON.stringify({ theme: "gruvbox-dark" }));
    expect(value).toEqual({ theme: "gruvbox-dark", zoom: 1 });
    expect(write).not.toHaveBeenCalled();
  });

  it("ignores other keys, a removed value, a value it can't read and its own write coming back", () => {
    const before = renders;
    fromOtherWindow(JSON.stringify({ theme: "x" }), "other.key");
    fromOtherWindow(null);
    fromOtherWindow("{not json");
    fromOtherWindow(JSON.stringify({ theme: "system", zoom: 1 }));
    expect(value).toEqual({ theme: "system", zoom: 1 });
    expect(renders).toBe(before);
  });
});
