import { describe, expect, it } from "vitest";
import { enterActivatesFocused } from "./dialogs/DialogHost";
import { paneContextKind } from "./components";
import { pinnedFiles } from "./Sidebar";
import type { FileEntry } from "./api";

// Small focus-and-targets rules that live inside components.

/** A stand-in element: its tag, and the elements it contains. */
function el(tagName: string, kids: object[] = []): Element {
  const node = { tagName, contains: (o: unknown) => o === node || kids.includes(o as object) };
  return node as unknown as Element;
}

describe("DialogHost Enter", () => {
  const cancel = el("BUTTON");
  const input = el("INPUT");
  const panel = el("DIV", [cancel, input]);
  const outside = el("BUTTON");

  it("activates a focused button in the dialog (Tab to cancel, Enter cancels)", () => {
    expect(enterActivatesFocused(cancel, panel)).toBe(true);
  });

  it("is the primary action from a field, nothing focused, or a button behind the dialog", () => {
    expect(enterActivatesFocused(input, panel)).toBe(false);
    expect(enterActivatesFocused(null, panel)).toBe(false);
    expect(enterActivatesFocused(outside, panel)).toBe(false);
    expect(enterActivatesFocused(cancel, null)).toBe(false);
  });
});

describe("paneContextKind", () => {
  const hit = (onRow: boolean) => ({ closest: (sel: string) => (onRow && sel === "[data-orig]" ? {} : null) }) as unknown as Element;

  it("shows the file menu only for a right-click on a row", () => {
    expect(paneContextKind(hit(true))).toBe("file");
  });

  it("shows the empty-space menu elsewhere, even with a selection", () => {
    expect(paneContextKind(hit(false))).toBe("empty");
    expect(paneContextKind(null)).toBe("empty");
  });
});

describe("pinnedFiles", () => {
  const entry = (path: string, kind: string): FileEntry => ({
    name: path.split("/").pop()!, path, kind, size: 0, modified_ms: 0,
    hidden: false, ext: "", is_symlink: false, lossy: false, git: null,
  });
  const fs: Record<string, FileEntry[]> = {
    "/home/me": [entry("/home/me/notes.md", "text"), entry("/home/me/src", "folder")],
    "/home/me/src": [entry("/home/me/src/main.rs", "code")],
  };

  it("finds the pins that are files, listing each parent once", async () => {
    const listed: string[] = [];
    const list = async (dir: string) => { listed.push(dir); return fs[dir] ?? []; };
    const files = await pinnedFiles(["/home/me/notes.md", "/home/me/src", "/home/me/src/main.rs"], list);
    expect([...files].sort()).toEqual(["/home/me/notes.md", "/home/me/src/main.rs"]);
    expect(listed.sort()).toEqual(["/home/me", "/home/me/src"]);
  });

  it("treats a pin it can't find or list as a folder", async () => {
    const list = async (dir: string) => {
      if (dir === "/gone") throw new Error("unreadable");
      return fs[dir] ?? [];
    };
    expect([...await pinnedFiles(["/gone/x.txt", "/home/me/missing.txt", "/"], list)]).toEqual([]);
  });
});
