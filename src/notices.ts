// Third-party notices: the license texts that ship with the app (Help →
// Third-party Notices). The texts themselves are in noticesData.ts, a
// separate chunk; this module is the pure part the view and tests share.

export interface Notice {
  /** Path under src/assets/fonts with "/" separators, e.g. "nerd-fonts/LICENSE.md". */
  path: string;
  text: string;
}

/** The index of the bundled fonts and their licenses, shown first. */
export const NOTICES_INDEX = "LICENSES.md";

const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** Display order: the index first, then by folder (top level first) and name. */
export function compareNotices(a: Notice, b: Notice): number {
  if ((a.path === NOTICES_INDEX) !== (b.path === NOTICES_INDEX)) {
    return a.path === NOTICES_INDEX ? -1 : 1;
  }
  return folderOf(a.path).localeCompare(folderOf(b.path)) || a.path.localeCompare(b.path);
}

/** Consecutive notices grouped by folder ("" for the top level), in order. */
export function groupByFolder(notices: readonly Notice[]): Array<{ folder: string; items: Notice[] }> {
  const groups: Array<{ folder: string; items: Notice[] }> = [];
  for (const n of notices) {
    const folder = folderOf(n.path);
    const last = groups[groups.length - 1];
    if (last && last.folder === folder) last.items.push(n);
    else groups.push({ folder, items: [n] });
  }
  return groups;
}

/** The notice a relative Markdown link in `from` points at, or null for
 *  anything else: web links, anchors, absolute paths, files not bundled. */
export function resolveNoticeLink(from: string, href: string, known: ReadonlySet<string>): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return null;
  const parts = folderOf(from).split("/").filter(Boolean);
  for (const seg of href.split("#")[0].split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const path = parts.join("/");
  return known.has(path) ? path : null;
}

export interface Segment {
  text: string;
  /** Set when `text` is a Markdown link to another notice. */
  target?: string;
}

const LINK = /\[[^\]\n]*\]\(([^)\s]+)\)/g;

/** `text` split around the Markdown links in it that point at another
 *  notice, so the view can make them clickable. Other text is left as is. */
export function linkSegments(from: string, text: string, known: ReadonlySet<string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const target = resolveNoticeLink(from, m[1], known);
    if (!target) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[0], target });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
