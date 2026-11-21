import { beforeEach, describe, expect, it, vi } from "vitest";

const listen = vi.hoisted(() => vi.fn(() => Promise.resolve(() => {})));
const label = vi.hoisted(() => ({ value: "main-2" as string | null }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (label.value === null) throw new Error("no Tauri");
    return { label: label.value };
  },
}));

import { listenHere, windowLabel } from "./events";

beforeEach(() => {
  listen.mockClear();
  label.value = "main-2";
});

describe("listenHere", () => {
  it("listens for the events sent to this window only", async () => {
    const handler = () => {};
    await listenHere("fs-changed", handler);
    // A plain listen's target is any window: it would hear every window's.
    expect(listen).toHaveBeenCalledWith("fs-changed", handler, { target: { kind: "WebviewWindow", label: "main-2" } });
  });

  it("is the first window's without Tauri", async () => {
    label.value = null;
    expect(windowLabel()).toBe("main");
    await listenHere("op-progress", () => {});
    expect(listen).toHaveBeenCalledWith("op-progress", expect.any(Function), { target: { kind: "WebviewWindow", label: "main" } });
  });
});
