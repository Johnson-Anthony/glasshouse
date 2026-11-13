// @vitest-environment happy-dom
// revealPath: after the tab selects the file, the keyboard goes to the file
// pane (which scrolls to the focused row only while it has focus).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RevealResult, UseTabResult } from "../state";

vi.mock("../api");
const dialogs = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../dialogs/DialogHost", () => ({ dialogs }));

import { revealPath } from "./helpers";

function handle(result: RevealResult, showHidden = false): UseTabResult {
  return { state: { showHidden }, actions: { reveal: vi.fn(async () => result) } } as unknown as UseTabResult;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("revealPath", () => {
  it("focuses the file pane once the file is selected", async () => {
    document.body.innerHTML = `<section class="pane" tabindex="0"></section><input id="elsewhere">`;
    document.querySelector<HTMLInputElement>("#elsewhere")!.focus();
    const h = handle("selected");
    await revealPath(h, "/w/a.txt");
    expect(h.actions.reveal).toHaveBeenCalledWith("/w/a.txt");
    expect(document.activeElement).toBe(document.querySelector("section.pane"));
    expect(dialogs.showToast).not.toHaveBeenCalled();
  });

  it("leaves the focus alone when another navigation came first", async () => {
    document.body.innerHTML = `<section class="pane" tabindex="0"></section><input id="elsewhere">`;
    document.querySelector<HTMLInputElement>("#elsewhere")!.focus();
    await revealPath(handle("dropped"), "/w/a.txt");
    expect(document.activeElement?.id).toBe("elsewhere");
    expect(dialogs.showToast).not.toHaveBeenCalled();
  });

  it("says why the file isn't there", async () => {
    await revealPath(handle("not-listed"), "/w/.env");
    expect(dialogs.showToast).toHaveBeenLastCalledWith(expect.objectContaining({ message: ".env isn't listed: hidden files are off (Ctrl+H)" }));
    await revealPath(handle("not-listed", true), "/w/gone.txt");
    expect(dialogs.showToast).toHaveBeenLastCalledWith(expect.objectContaining({ message: "gone.txt is no longer in this folder" }));
  });
});
