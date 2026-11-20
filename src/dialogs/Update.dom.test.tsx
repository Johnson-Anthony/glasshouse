// @vitest-environment happy-dom
// The update dialog in a DOM: it checks once when opened, shows what's new,
// installs only on the button, links to the package for a copy that can't
// update itself, and reports a failed check or install.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateAvailable, UpdateInfo, UpdateProgress } from "../api";

const api = vi.hoisted(() => ({
  updateCheck: vi.fn(),
  updateInfo: vi.fn(),
  updateInstall: vi.fn(),
  updateCancel: vi.fn(),
  onUpdateProgress: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("../api", () => api);

import { UpdateDialog } from "./Update";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NSIS: UpdateInfo = {
  version: "0.2.0", install: "nsis", canInstall: true, appImage: null,
  endpoint: "https://github.com/Johnson-Anthony/glasshouse/releases/latest/download/latest.json", lastCheck: null,
};
const DEB: UpdateInfo = { ...NSIS, install: "deb", canInstall: false };
const AVAILABLE: UpdateAvailable = {
  status: "available", version: "0.3.0", current: "0.2.0", date: "2026-12-01T10:00:00Z",
  notes: "### New\n\n- **Updates** you can turn on", download: null, canInstall: true,
};
const DEB_UPDATE: UpdateAvailable = {
  ...AVAILABLE, canInstall: false,
  download: "https://github.com/Johnson-Anthony/glasshouse/releases/download/v0.3.0/glasshouse_0.3.0_amd64.deb",
};

let host: HTMLDivElement;
let root: Root;
let progress: ((p: UpdateProgress) => void) | null;
const onClose = vi.fn();

const byText = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);
async function click(el: Element | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
async function mount(props: { found?: UpdateAvailable | null } = {}) {
  await act(async () => { root.render(<UpdateDialog open onClose={onClose} {...props} />); });
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.updateInfo.mockResolvedValue(NSIS);
  api.updateCancel.mockResolvedValue(undefined);
  api.onUpdateProgress.mockImplementation((cb: (p: UpdateProgress) => void) => { progress = cb; return () => { progress = null; }; });
  onClose.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("UpdateDialog", () => {
  it("checks once when opened, and says when this is the newest version", async () => {
    api.updateCheck.mockResolvedValue({ status: "current", version: "0.2.0" });
    await mount();
    expect(api.updateCheck).toHaveBeenCalledTimes(1);
    expect(api.updateCheck).toHaveBeenCalledWith(false);
    expect(host.textContent).toContain("glasshouse 0.2.0 is the newest version.");
    expect(api.updateInstall).not.toHaveBeenCalled();
  });

  it("shows what's new and installs only on the button", async () => {
    api.updateCheck.mockResolvedValue(AVAILABLE);
    api.updateInstall.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(host.textContent).toContain("glasshouse 0.3.0 is out");
    expect(host.textContent).toContain("released 2026-12-01");
    expect(host.querySelector(".upd-notes h4")?.textContent).toBe("New");
    expect(host.querySelector(".upd-notes .upd-item")?.textContent).toBe("Updates you can turn on");
    expect(api.updateInstall).not.toHaveBeenCalled();
    await click(byText("install and restart"));
    expect(api.updateInstall).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Downloading…");
    await act(async () => { progress?.({ got: 40_000_000, total: 80_000_000, installing: false }); });
    expect(host.textContent).toContain("40.0 MB of 80.0 MB");
    expect(host.querySelector("[role=progressbar] > div")?.getAttribute("style")).toContain("50%");
    // No closing while it downloads.
    expect(byText("later")).toBeUndefined();
    await act(async () => { progress?.({ got: 80_000_000, total: 80_000_000, installing: true }); });
    expect(host.textContent).toContain("Installing");
    expect(byText("cancel")).toBeUndefined();
  });

  it("cancels a download and goes back to the offer", async () => {
    let fail: (e: unknown) => void = () => {};
    api.updateCheck.mockResolvedValue(AVAILABLE);
    api.updateInstall.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    await mount();
    await click(byText("install and restart"));
    await click(byText("cancel"));
    expect(api.updateCancel).toHaveBeenCalledTimes(1);
    await act(async () => { fail("Cancelled."); });
    expect(byText("install and restart")).toBeTruthy();
  });

  it("reports a failed install with the reason", async () => {
    api.updateCheck.mockResolvedValue(AVAILABLE);
    api.updateInstall.mockRejectedValue("The download's signature doesn't match glasshouse's key, so it wasn't installed.");
    await mount();
    await click(byText("install and restart"));
    expect(host.textContent).toContain("glasshouse 0.3.0 wasn't installed.");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("signature doesn't match");
    expect(byText("release page")).toBeTruthy();
  });

  it("links a .deb install to the new .deb instead of installing", async () => {
    api.updateInfo.mockResolvedValue(DEB);
    api.updateCheck.mockResolvedValue(DEB_UPDATE);
    await mount();
    expect(byText("install and restart")).toBeUndefined();
    expect(host.textContent).toContain("package manager");
    expect(host.textContent).toContain("sudo apt install ./glasshouse_0.3.0_amd64.deb");
    await click(byText("download"));
    expect(api.openUrl).toHaveBeenCalledWith(DEB_UPDATE.download);
    await click(byText("release page"));
    expect(api.openUrl).toHaveBeenLastCalledWith("https://github.com/Johnson-Anthony/glasshouse/releases/tag/v0.3.0");
  });

  it("shows what the automatic check found without checking again", async () => {
    await mount({ found: AVAILABLE });
    expect(api.updateCheck).not.toHaveBeenCalled();
    expect(host.textContent).toContain("glasshouse 0.3.0 is out");
  });

  it("says why a check failed, and can try again", async () => {
    api.updateCheck.mockRejectedValueOnce("Couldn't reach the update server. Check the internet connection and try again.");
    await mount();
    expect(host.textContent).toContain("The check didn't work.");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Couldn't reach the update server");
    api.updateCheck.mockResolvedValueOnce({ status: "current", version: "0.2.0" });
    await click(byText("try again"));
    expect(api.updateCheck).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("is the newest version");
  });

  it("closes on later and Escape", async () => {
    api.updateCheck.mockResolvedValue(AVAILABLE);
    await mount();
    await click(byText("later"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
