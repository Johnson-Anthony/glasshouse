// Third-party notices: the license texts that ship with the app (Help →
// Third-party Notices). The texts themselves are in noticesData.ts, a
// separate chunk; this module is the pure part the view and tests share.

export interface Notice {
  /** Unique id. For a bundled file, its path under src/assets/fonts with "/"
   *  separators ("nerd-fonts/LICENSE.md"); for a dependency,
   *  "npm:<name>@<version>" or "rust:<name>@<version>". */
  path: string;
  /** The heading it's listed under, e.g. "fonts/nerd-fonts/" or "Rust crates/". */
  group: string;
  /** Its name in the list. */
  label: string;
  text: string;
  /** Relative Markdown links in the text point at other bundled files. */
  links?: boolean;
}

/** The index of the bundled fonts and their licenses, shown first. */
export const NOTICES_INDEX = "LICENSES.md";

const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** The notice for a text file under src/assets/fonts. */
export function fileNotice(path: string, text: string): Notice {
  const folder = folderOf(path);
  return { path, group: `fonts/${folder}`, label: path.slice(folder.length), text, links: true };
}

/** Order of the font files: the index first, then by folder (top level
 *  first) and name. */
export function compareNotices(a: Notice, b: Notice): number {
  if ((a.path === NOTICES_INDEX) !== (b.path === NOTICES_INDEX)) {
    return a.path === NOTICES_INDEX ? -1 : 1;
  }
  return folderOf(a.path).localeCompare(folderOf(b.path)) || a.path.localeCompare(b.path);
}

/** Consecutive notices grouped by `group`, in order. */
export function groupNotices(notices: readonly Notice[]): Array<{ group: string; items: Notice[] }> {
  const groups: Array<{ group: string; items: Notice[] }> = [];
  for (const n of notices) {
    const last = groups[groups.length - 1];
    if (last && last.group === n.group) last.items.push(n);
    else groups.push({ group: n.group, items: [n] });
  }
  return groups;
}

/** One npm package or Rust crate in src/assets/third-party.json. */
export interface Dependency {
  name: string;
  version: string;
  /** What the package declares, usually an SPDX expression. */
  license: string;
  /** The texts that apply: an SPDX id (or a file name, for npm) and an
   *  index into `texts`. */
  licenses: Array<{ id: string; text: number }>;
}

/** src/assets/third-party.json, written by scripts/gen-notices.mjs. */
export interface ThirdPartyData {
  npm: Dependency[];
  rust: Array<Dependency & { platforms: string[] }>;
  texts: string[];
}

/** Notices for the bundled npm packages and the Rust crates that ship on
 *  `platform` ("linux" or "windows"), in the generator's order. */
export function dependencyNotices(data: ThirdPartyData, platform: string): Notice[] {
  const toNotice = (kind: string, group: string) => (d: Dependency): Notice => ({
    path: `${kind}:${d.name}@${d.version}`,
    group,
    label: `${d.name} ${d.version}`,
    text: [
      `${d.name} ${d.version}`,
      `license: ${d.license}`,
      ...d.licenses.map((l) => `\n── ${l.id} ──\n\n${data.texts[l.text]}`),
    ].join("\n"),
  });
  return [
    ...data.npm.map(toNotice("npm", "npm packages/")),
    ...data.rust.filter((c) => c.platforms.includes(platform)).map(toNotice("rust", "Rust crates/")),
  ];
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
