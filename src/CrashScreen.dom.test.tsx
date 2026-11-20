// @vitest-environment happy-dom
// A render error shows the crash screen, not a blank window; and an error
// alert folds the raw error away under "Show details".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./CrashScreen";
import { DialogHost } from "./dialogs/DialogHost";
import { showError } from "./errorDialog";
import { BackendError } from "./errors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // React reports the caught error on the console too.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error("rows is undefined");
}

describe("the crash screen", () => {
  it("takes the place of a window that failed to render", async () => {
    const onCrash = vi.fn();
    await act(async () => { root.render(<ErrorBoundary onCrash={onCrash}><Boom /></ErrorBoundary>); });
    const screen = host.querySelector(".crash-screen");
    expect(screen?.getAttribute("role")).toBe("alert");
    expect(screen?.querySelector("h1")?.textContent).toBe("glasshouse ran into a problem");
    const buttons = [...host.querySelectorAll("button")].map(b => b.textContent);
    expect(buttons).toEqual(["reload", "open log folder", "report bug…"]);
    expect(host.querySelector(".error-details summary")?.textContent).toBe("Show details");
    expect(host.querySelector(".error-details pre")?.textContent).toContain("rows is undefined");
    expect(onCrash).toHaveBeenCalledOnce();
  });

  it("offers cancel to a caller waiting for an answer (the file chooser)", async () => {
    const onCancel = vi.fn();
    await act(async () => { root.render(<ErrorBoundary onCancel={onCancel}><Boom /></ErrorBoundary>); });
    const cancel = [...host.querySelectorAll("button")].find(b => b.textContent === "cancel");
    await act(async () => { cancel?.click(); });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("says so when there's no backend to ask for the bug report's facts", async () => {
    await act(async () => { root.render(<ErrorBoundary><Boom /></ErrorBoundary>); });
    const report = [...host.querySelectorAll("button")].find(b => b.textContent === "report bug…");
    await act(async () => { report?.click(); });
    expect(host.querySelector(".crash-problem")?.textContent).toBe("The system details aren't available here.");
  });

  it("renders its children while they work", async () => {
    await act(async () => { root.render(<ErrorBoundary><p>fine</p></ErrorBoundary>); });
    expect(host.textContent).toBe("fine");
    expect(host.querySelector(".crash-screen")).toBeNull();
  });
});

describe("an error alert", () => {
  it("shows the sentence, with the raw error under Show details", async () => {
    await act(async () => { root.render(<DialogHost />); });
    const err = new BackendError({
      kind: "permission",
      path: "/srv/shared/a.txt",
      message: "Couldn't rename “a.txt” because you don't have permission.",
      detail: "/srv/shared/a.txt: Permission denied (os error 13)",
    });
    await act(async () => { void showError({ title: "rename failed", err }); });
    const dialog = host.querySelector("[role=alertdialog], [role=dialog]") ?? host;
    expect(dialog.textContent).toContain("rename failed");
    expect(dialog.textContent).toContain("Couldn't rename “a.txt” because you don't have permission.");
    const details = host.querySelector<HTMLDetailsElement>(".error-details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("pre")?.textContent).toBe("/srv/shared/a.txt: Permission denied (os error 13)");
  });

  it("has no Show details for an error with nothing more to say", async () => {
    await act(async () => { root.render(<DialogHost />); });
    await act(async () => { void showError({ title: "diff failed", err: "the files are too big to compare" }); });
    expect(host.textContent).toContain("the files are too big to compare");
    expect(host.querySelector(".error-details")).toBeNull();
  });
});
