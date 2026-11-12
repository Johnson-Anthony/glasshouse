import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilePane, noMatchesText } from "./components";
import type { FileRow } from "./data";

function row(name: string, ext: string): FileRow & { entry: { path: string } } {
  return {
    name, ext, kind: "text", size: "", date: "", tag: null, git: null, hidden: false, link: false,
    entry: { path: `/w/${name}.${ext}` },
  };
}
const files = [row("notes", "md"), row("app", "ts"), row("lib", "ts")];

// Server rendering runs no effects, so this shows what the first render of
// a filtered pane draws.
function render(searchQuery: string, tagFilter: string | null = null): string {
  const noop = () => {};
  return renderToStaticMarkup(
    <FilePane files={files} selected={[]} setSelected={noop} focusIndex={0} setFocusIndex={noop}
      anchorIndex={0} setAnchorIndex={noop} paneFocused={false} setPaneFocused={noop}
      sortKey="name" sortDir="asc" onSortChange={noop} onContext={noop}
      searchQuery={searchQuery} tagFilter={tagFilter} tagStore={{ "/w/app.ts": ["work"] }} />,
  );
}
const origs = (html: string) => [...html.matchAll(/data-orig="(\d+)"/g)].map(m => Number(m[1]));

describe("FilePane filter", () => {
  it("draws only the rows the filter matches, in display order", () => {
    expect(origs(render(""))).toEqual([1, 2, 0]);
    expect(origs(render(".ts"))).toEqual([1, 2]);
  });

  it("says why the pane is empty when the filter hides every row", () => {
    const html = render("zzz");
    expect(origs(html)).toEqual([]);
    expect(html).toContain("no matches for &quot;zzz&quot;");
    expect(html).not.toContain("empty folder");
    expect(render("lib", "work")).toContain("no matches for &quot;lib&quot; tagged &quot;work&quot;");
  });

  it("words the notice for the filters in use", () => {
    expect(noMatchesText(" zzz ", null)).toBe('no matches for "zzz"');
    expect(noMatchesText("", "work")).toBe('nothing tagged "work"');
    expect(noMatchesText("a", "work")).toBe('no matches for "a" tagged "work"');
  });
});
