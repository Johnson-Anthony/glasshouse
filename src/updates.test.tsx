// @vitest-environment happy-dom
// The update words and release-note parsing (updates.ts), and the automatic
// check's schedule: only the session's window, only while on.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  updateCheck: vi.fn(),
  sessionOwner: vi.fn(),
}));
vi.mock("./api", () => api);

import {
  CHECK_TICK_MS, FIRST_CHECK_MS, agoText, dayText, fileOf, installText, manualSteps, noteBlocks, plainInline,
  progressText, releasePage, useAutoUpdateCheck,
} from "./updates";
import type { UpdateAvailable } from "./api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("release notes", () => {
  it("become headings, bullets with their depth, and paragraphs", () => {
    const md = [
      "### New",
      "",
      "- **Updates:** Help → Check for Updates asks",
      "  [the release](https://example.test/x) once.",
      "  - a `sub` point",
      "",
      "A paragraph",
      "that wraps.",
      "## Fixed",
      "* one",
    ].join("\n");
    expect(noteBlocks(md)).toEqual([
      { kind: "heading", text: "New" },
      { kind: "item", text: "Updates: Help → Check for Updates asks the release once.", depth: 0 },
      { kind: "item", text: "a sub point", depth: 1 },
      { kind: "para", text: "A paragraph that wraps." },
      { kind: "heading", text: "Fixed" },
      { kind: "item", text: "one", depth: 0 },
    ]);
  });

  it("keep no markup, and no HTML is made from them", () => {
    expect(plainInline("see [docs](https://x.test) and ![pic](a.png), _really_ `code` **bold**"))
      .toBe("see docs and pic, really code bold");
    // Snake_case names keep their underscores.
    expect(plainInline("the file_name_here stays")).toBe("the file_name_here stays");
    expect(noteBlocks("<script>alert(1)</script>")).toEqual([{ kind: "para", text: "<script>alert(1)</script>" }]);
    expect(noteBlocks("")).toEqual([]);
    expect(noteBlocks("\r\n- a\r\n")).toEqual([{ kind: "item", text: "a", depth: 0 }]);
  });
});

describe("update words", () => {
  it("say how each kind of install updates", () => {
    expect(installText({ install: "nsis", canInstall: true, appImage: null })).toContain("for you alone");
    expect(installText({ install: "msi", canInstall: true, appImage: null })).toContain("administrator");
    expect(installText({ install: "appimage", canInstall: true, appImage: "/home/u/Apps/glasshouse.AppImage" }))
      .toContain("replaces /home/u/Apps/glasshouse.AppImage");
    expect(installText({ install: "appimage", canInstall: false, appImage: "/opt/glasshouse.AppImage" }))
      .toContain("can't write to the folder");
    expect(installText({ install: "deb", canInstall: false, appImage: null })).toContain("package manager");
    expect(installText({ install: "source", canInstall: false, appImage: null })).toContain("Built from source");
  });

  it("give the steps for an update the user installs", () => {
    expect(manualSteps("deb", "https://github.com/o/r/releases/download/v0.3.0/glasshouse_0.3.0_amd64.deb"))
      .toBe("Download the new .deb, then install it as you did this one: sudo apt install ./glasshouse_0.3.0_amd64.deb");
    expect(manualSteps("deb", null)).toContain("glasshouse_<version>_<arch>.deb");
    expect(manualSteps("appimage", null)).toContain("chmod +x");
    expect(manualSteps("nsis", null)).toBeNull();
  });

  it("format times, dates, sizes and links", () => {
    const now = Date.UTC(2026, 10, 20, 12);
    expect(agoText(null, now)).toBe("never");
    expect(agoText(now - 10_000, now)).toBe("just now");
    expect(agoText(now - 60_000, now)).toBe("1 minute ago");
    expect(agoText(now - 3 * 3600_000, now)).toBe("3 hours ago");
    expect(agoText(now - 2 * 86400_000, now)).toBe("2 days ago");
    expect(dayText("2026-12-01T10:00:00Z")).toBe("2026-12-01");
    expect(dayText("nonsense")).toBe("");
    expect(dayText(null)).toBe("");
    expect(progressText(12_300_000, 80_100_000)).toBe("12.3 MB of 80.1 MB");
    expect(progressText(500_000, null)).toBe("0.5 MB");
    expect(fileOf("https://x.test/a/glasshouse_0.3.0_amd64.deb")).toBe("glasshouse_0.3.0_amd64.deb");
    expect(fileOf("not a url")).toBe("");
    expect(releasePage("0.3.0")).toBe("https://github.com/Johnson-Anthony/glasshouse/releases/tag/v0.3.0");
  });
});

describe("useAutoUpdateCheck", () => {
  const found: UpdateAvailable = {
    status: "available", version: "0.3.0", current: "0.2.0", date: null, notes: "", download: null, canInstall: true,
  };
  let host: HTMLDivElement;
  let root: Root;
  const onFound = vi.fn();

  function Probe({ on }: { on: boolean }) {
    useAutoUpdateCheck(on, onFound);
    return null;
  }
  async function render(on: boolean) {
    await act(async () => { root.render(<Probe on={on} />); });
  }
  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    api.updateCheck.mockReset().mockResolvedValue(found);
    api.sessionOwner.mockReset().mockResolvedValue(true);
    onFound.mockReset();
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("does nothing while off", async () => {
    await render(false);
    await advance(CHECK_TICK_MS * 3);
    expect(api.sessionOwner).not.toHaveBeenCalled();
    expect(api.updateCheck).not.toHaveBeenCalled();
  });

  it("asks after start and then every tick, as the automatic check", async () => {
    await render(true);
    await advance(FIRST_CHECK_MS - 1);
    expect(api.updateCheck).not.toHaveBeenCalled();
    await advance(1);
    expect(api.updateCheck).toHaveBeenCalledWith(true);
    expect(onFound).toHaveBeenCalledWith(found);
    api.updateCheck.mockResolvedValue({ status: "quiet" });
    await advance(CHECK_TICK_MS);
    expect(api.updateCheck).toHaveBeenCalledTimes(2);
    expect(onFound).toHaveBeenCalledTimes(1);
  });

  it("keeps ticking after a failed check", async () => {
    api.updateCheck.mockRejectedValue("offline");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(true);
    await advance(FIRST_CHECK_MS + CHECK_TICK_MS);
    expect(api.updateCheck).toHaveBeenCalledTimes(2);
    expect(onFound).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves it to the window that owns the session", async () => {
    api.sessionOwner.mockResolvedValue(false);
    await render(true);
    await advance(FIRST_CHECK_MS + CHECK_TICK_MS);
    expect(api.updateCheck).not.toHaveBeenCalled();
  });

  it("stops when turned off", async () => {
    await render(true);
    await render(false);
    await advance(FIRST_CHECK_MS + CHECK_TICK_MS);
    expect(api.updateCheck).not.toHaveBeenCalled();
  });
});
