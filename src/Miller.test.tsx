import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MillerView } from "./Miller";
import type { FileEntry } from "./api";

function entry(name: string, ext: string, kind: string, is_symlink = false): FileEntry {
  return {
    name, path: "/home/me/proj/" + name, kind, size: 10, modified_ms: 0,
    hidden: false, ext, is_symlink, lossy: false, git: null,
  };
}

// Server rendering runs no effects, so the parent and child columns stay
// empty and only the middle column and the preview show names.
function render(entries: FileEntry[], focusIndex: number): string {
  const noop = () => {};
  return renderToStaticMarkup(
    <MillerView cwd="/home/me/proj" entries={entries} showHidden={false}
      focusIndex={focusIndex} setFocusIndex={noop} setSelected={noop}
      onNavigate={noop} onOpenFile={noop} />,
  );
}

const count = (html: string, s: string) => html.split(s).length - 1;

describe("MillerView names", () => {
  const entries = [
    entry("README.md", "md", "text"),
    entry("src", "", "folder"),
    entry("link.txt", "txt", "text", true),
  ];

  it("shows each name once, without appending the extension again", () => {
    const html = render(entries, 0);
    expect(html).not.toContain("README.md.md");
    expect(html).not.toContain("link.txt.txt");
    // The middle-column row and the preview title.
    expect(count(html, ">README.md<")).toBe(2);
    expect(count(html, ">src<")).toBe(1);
    expect(count(html, ">link.txt<")).toBe(1);
  });

  it("marks only the symlink row", () => {
    expect(count(render(entries, 0), "↪")).toBe(1);
  });
});
