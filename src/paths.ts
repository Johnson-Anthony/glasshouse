// Canonical path-string helpers. Paths flow through the app as plain strings
// (Windows `C:\…` / `\\server\share\…` and POSIX `/…` shapes). The platform
// decides the rules, not the string: `\` is a separator on Windows but an
// ordinary filename character on Linux, and only Windows compares paths
// case-insensitively.
import { IS_WINDOWS } from "./platform";

export interface Crumb {
  label: string;
  path: string;
}

export interface PathOps {
  /** Comparison key: trailing-separator-insensitive everywhere; on Windows
   *  also case-insensitive with `/` folded to `\`. */
  normalizePath(p: string): string;
  /** Parent directory of `p`. At a root it can't climb out of (POSIX `/`,
   *  `C:\`, `\\server\share\`) it returns that root, so callers can detect
   *  "already at top" with `parent === p`. */
  parentPath(p: string): string;
  /** Final path component, ignoring trailing separators. "" for POSIX `/`. */
  basename(p: string): string;
  /** Join a directory and a child name. On Windows the separator follows the
   *  directory's flavor (any `/` present wins) and bare drives (`C:`) get `\`. */
  joinPath(dir: string, name: string): string;
  /** Non-empty components of `p`, split on the platform's separators. */
  pathSegments(p: string): string[];
  /** Clickable breadcrumb for `p`. On Windows the drive or UNC share is the
   *  first crumb (`C:` → `C:\`, `\\server\share` → `\\server\share\`). */
  splitBreadcrumb(p: string): Crumb[];
}

/** Path helpers for one platform. The app uses the `IS_WINDOWS` set exported
 *  below; tests build both flavors directly. */
export function pathOps(win: boolean): PathOps {
  const trimEnd = (p: string) => p.replace(win ? /[\\/]+$/ : /\/+$/, "");
  const lastSep = (p: string) =>
    win ? Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")) : p.lastIndexOf("/");
  const pathSegments = (p: string) => p.split(win ? /[\\/]+/ : /\/+/).filter(Boolean);

  // Length of `p`'s root prefix including its trailing separators; 0 for a
  // relative path. Windows roots: `C:`, `C:\`, `\\server\share\`, `\`.
  const rootLen = (p: string): number =>
    (win ? /^(?:[A-Za-z]:|[\\/]{2}[^\\/]+(?:[\\/]+[^\\/]+)?)?[\\/]*/ : /^\/*/).exec(p)![0].length;

  // Canonical spelling of a root prefix: always ends in a separator.
  const rootForm = (root: string): string => {
    if (!root) return "";
    if (!win) return "/";
    const core = trimEnd(root);
    if (!core) return root[0];
    return core + (root.length > core.length ? root[core.length] : "\\");
  };

  return {
    normalizePath(p) {
      const t = trimEnd(p);
      return win ? t.replace(/\//g, "\\").toLowerCase() : t;
    },

    parentPath(p) {
      if (!p) return p;
      const rl = rootLen(p);
      const root = rootForm(p.slice(0, rl));
      const rest = trimEnd(p.slice(rl));
      if (!rest) return root;
      const idx = lastSep(rest);
      if (idx < 0) return root || rest;
      return root + trimEnd(rest.slice(0, idx));
    },

    basename(p) {
      const t = trimEnd(p);
      return t.slice(lastSep(t) + 1);
    },

    joinPath(dir, name) {
      if (!dir) return name;
      if (!win) return trimEnd(dir) + "/" + name;
      // Root-ish dirs already end in a separator — just append.
      if (dir.endsWith("\\") || dir.endsWith("/")) return dir + name;
      // Bare drive like "C:" — attach the Windows separator.
      if (/^[A-Za-z]:$/.test(dir)) return dir + "\\" + name;
      const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
      return dir + sep + name;
    },

    pathSegments,

    splitBreadcrumb(p) {
      if (!p) return [];
      const out: Crumb[] = [];
      if (!win) {
        let acc = "";
        for (const seg of pathSegments(p)) {
          acc += "/" + seg;
          out.push({ label: seg, path: acc });
        }
        return out;
      }
      const norm = p.replace(/\//g, "\\");
      const rl = rootLen(norm);
      const root = trimEnd(norm.slice(0, rl));
      let acc = rl > 0 ? root + "\\" : "";
      if (root) out.push({ label: root, path: acc });
      for (const seg of pathSegments(norm.slice(rl))) {
        acc = acc && !acc.endsWith("\\") ? acc + "\\" + seg : acc + seg;
        out.push({ label: seg, path: acc });
      }
      return out;
    },
  };
}

export const {
  normalizePath,
  parentPath,
  basename,
  joinPath,
  pathSegments,
  splitBreadcrumb,
} = pathOps(IS_WINDOWS);
