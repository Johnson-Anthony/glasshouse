import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector, PermissionsGrid, ReadOnlyLine, type InspectableFile } from "./Inspector";

const noop = () => {};

function grid(mode: number | null | undefined): string {
  return renderToStaticMarkup(<PermissionsGrid path="/home/me/.ssh/id_ed25519" name="id_ed25519" mode={mode} onChanged={noop} />);
}

describe("PermissionsGrid", () => {
  it("shows the file's real mode", () => {
    const html = grid(0o600);
    expect(html).toContain("rw-------");
    expect(html).toContain("0600");
    expect(html).toContain(">edit<");
    // Only the owner's read and write cells are on.
    expect(html.match(/class="perm-cell"/g)).toHaveLength(2);
  });

  it("shows special bits", () => {
    expect(grid(0o2775)).toContain("rwxrwsr-x");
  });

  it("offers nothing to edit before the mode is known, or when it can't be read", () => {
    for (const [mode, text] of [[undefined, "…"], [null, "—"]] as const) {
      const html = grid(mode);
      expect(html).toContain(text);
      expect(html).not.toContain("perm-grid");
      expect(html).not.toContain(">edit<");
    }
  });
});

describe("ReadOnlyLine", () => {
  it("offers the opposite of the current state", () => {
    const line = (readonly: boolean | null | undefined) =>
      renderToStaticMarkup(<ReadOnlyLine path="C:\\a.txt" name="a.txt" readonly={readonly} onChanged={noop} />);
    expect(line(true)).toContain("make writable");
    expect(line(false)).toContain("make read-only");
    expect(line(undefined)).not.toContain("make ");
  });
});

describe("Inspector", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("never shows a made-up mode before the real one is read", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: noop, removeItem: noop });
    const file = {
      name: "id_ed25519", ext: "", kind: "file", size: "411 B", date: "today", tag: null, git: null,
      entry: { name: "id_ed25519", path: "/home/me/.ssh/id_ed25519", kind: "file", size: 411, modified_ms: 0, hidden: false, ext: "", is_symlink: false, lossy: false, git: null },
    } as unknown as InspectableFile;
    // A server render runs no effects, so the stat never arrives.
    const html = renderToStaticMarkup(<Inspector file={file} />);
    expect(html).toContain("PERMISSIONS");
    expect(html).not.toContain("0740");
    expect(html).not.toContain("rwxr-----");
  });
});
