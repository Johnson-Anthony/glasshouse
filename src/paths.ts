// Canonical path-string helpers. Paths flow through the app as plain strings
// (both Windows `C:\…` and POSIX `/…` shapes), and these were previously
// copy-pasted per module with drifted heuristics — this is the one true set.

/** Case-insensitive, trailing-separator-insensitive comparison key. */
export function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, "").toLowerCase();
}

/** Parent directory of `p`. Returns `p` unchanged at a root it can't climb
 *  out of (POSIX `/`, bare drive) so callers can detect "already at top". */
export function parentPath(p: string): string {
  if (!p) return p;
  const hasBack = p.includes("\\");
  const sep = hasBack ? "\\" : "/";
  const trimmed = p.replace(/[\\/]+$/, "");
  // p was nothing but separators (posix root "/") — already at the top.
  if (trimmed === "") return "/";
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (idx <= 0) {
    if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + sep;
    if (trimmed.startsWith("/")) return "/";
    return trimmed;
  }
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, 2)) && idx === 2) {
    return trimmed.slice(0, 3);
  }
  return trimmed.slice(0, idx) || sep;
}

/** Final path component, ignoring trailing separators. */
export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Join a directory and a child name with the directory's own separator
 *  flavor. Handles drive roots (`C:\`), bare drives (`C:`), POSIX root and
 *  mixed-separator dirs (any `/` present wins). */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  // Root-ish dirs already end in a separator — just append.
  if (dir.endsWith("\\") || dir.endsWith("/")) return dir + name;
  // Bare drive like "C:" — attach the Windows separator.
  if (/^[A-Za-z]:$/.test(dir)) return dir + "\\" + name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}
