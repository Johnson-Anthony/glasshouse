// @vitest-environment happy-dom
// The tag picker works on the tag store (tags.ts), not on its own read of
// the file, and saves only the path it was opened for.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { getTags, loadTags, resetTagStoreForTests, setTags } from "../tags";
import { TagPickerDialog } from "./TagPicker";

vi.mock("../api");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onSaved = vi.fn();

const box = (label: string) =>
  [...host.querySelectorAll("label")].find(l => l.textContent === label)!.querySelector("input")!;
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;

async function open(path: string) {
  await act(async () => {
    root.render(<TagPickerDialog path={path} onClose={() => {}} onSaved={onSaved} />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.writeTags).mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("TagPickerDialog", () => {
  it("shows the store's tags for its path without reading the file", async () => {
    resetTagStoreForTests({ "/w/a": ["review"], "/w/b": ["mine"] });
    await open("/w/a");
    expect(api.readTags).not.toHaveBeenCalled();
    expect(box("review").checked).toBe(true);
    // A label only another path carries is offered too.
    expect(box("mine").checked).toBe(false);
  });

  it("saves only its own path, so a change made meanwhile stands", async () => {
    resetTagStoreForTests({ "/w/a": ["review"], "/w/b": ["mine"] });
    await open("/w/a");
    await act(async () => { box("mine").click(); });
    // While the dialog is open, the app renames /w/b.
    await act(async () => { setTags(prev => ({ "/w/a": prev["/w/a"], "/w/c": prev["/w/b"] })); });
    await act(async () => { button("save").click(); });
    expect(getTags()).toEqual({ "/w/a": ["review", "mine"], "/w/c": ["mine"] });
    expect(onSaved).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(api.writeTags).toHaveBeenLastCalledWith(getTags()));
  });

  it("unticking every tag removes the path's entry", async () => {
    resetTagStoreForTests({ "/w/a": ["review"] });
    await open("/w/a");
    await act(async () => { box("review").click(); });
    await act(async () => { button("save").click(); });
    expect(getTags()).toEqual({});
  });

  it("waits for the store to load before it can save", async () => {
    resetTagStoreForTests(null);
    let resolve!: (m: Record<string, string[]>) => void;
    vi.mocked(api.readTags).mockReturnValue(new Promise(r => { resolve = r; }));
    await open("/w/a");
    expect(button("save").disabled).toBe(true);
    await act(async () => {
      const loaded = loadTags();
      resolve({ "/w/a": ["review"] });
      await loaded;
    });
    expect(button("save").disabled).toBe(false);
    expect(box("review").checked).toBe(true);
  });
});
