// Copy/move planning shared by Paste, Paste Special, Duplicate, Move to… and
// drag-and-drop. The backend copies and renames over whatever is at the
// destination, so every caller plans its targets here first: a free
// "name (copy).ext" when the item would land on itself or on a name this batch
// already used, a one-time question when a different item has the name, and
// a skip for folders pasted into themselves.
// Policy notes: docs/decisions/2026-11-08-paste-conflicts-policy.md
import { pathOps } from "./paths";
import { isCancelled } from "./opStore";
import { errText } from "./errors";

// Path rules follow the `windows` flag each entry point is given (the app
// passes IS_WINDOWS), so both flavors can be tested on any host.

export type TransferOp = "copy" | "move";
export type ConflictPolicy = "keep-both" | "replace" | "skip";

export interface TransferItem {
  path: string;
  /** Folders never split off an extension. Unknown → the kind of the
   *  same-named entry at the destination, else treated as a file. */
  isDir?: boolean;
}

/** Minimal shape of a destination listing entry (FileEntry fits). */
export interface ExistingEntry {
  name: string;
  kind: string;
}

export type SkipReason = "same-place" | "into-itself" | "conflict";

export type TransferStep =
  | {
      action: "transfer";
      src: string;
      dst: string;
      /** Existing entry to move to the trash before transferring. */
      replace?: string;
    }
  | { action: "skip"; src: string; reason: SkipReason };

// ---------- names ----------

const COPY_SUFFIX = / \(copy(?: (\d+))?\)$/;

/** Split a name into stem and extension. Folders and dotfiles have no
 *  extension, and `.tar.*` stays together ("a.tar.gz" → "a" + ".tar.gz"). */
export function splitExt(name: string, isDir: boolean): [string, string] {
  if (isDir) return [name, ""];
  const tar = name.match(/\.tar\.[A-Za-z0-9]{1,4}$/i);
  if (tar && tar.index! > 0) return [name.slice(0, tar.index), name.slice(tar.index)];
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

/** "name (copy).ext" for n ≤ 1, else "name (copy n).ext". */
export function copyName(name: string, isDir: boolean, n: number): string {
  const [stem, ext] = splitExt(name, isDir);
  return `${stem} (${n <= 1 ? "copy" : `copy ${n}`})${ext}`;
}

/** `name` if it's free, else the first free copy name. A name that already
 *  carries a copy suffix keeps counting: "a (copy).txt" → "a (copy 2).txt". */
export function pickFreeName(
  name: string,
  isDir: boolean,
  isTaken: (name: string) => boolean,
): string {
  if (!isTaken(name)) return name;
  const [rawStem, ext] = splitExt(name, isDir);
  let stem = rawStem;
  let n = 1;
  const m = rawStem.match(COPY_SUFFIX);
  if (m) {
    stem = rawStem.slice(0, m.index);
    n = (m[1] ? Number(m[1]) : 1) + 1;
  }
  for (;; n++) {
    const candidate = `${stem} (${n === 1 ? "copy" : `copy ${n}`})${ext}`;
    if (!isTaken(candidate)) return candidate;
  }
}

// ---------- paths ----------

/** True if `child` is `parent` or somewhere below it. */
export function isInside(child: string, parent: string, windows: boolean): boolean {
  const { normalizePath } = pathOps(windows);
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c === p || c.startsWith(p + (windows ? "\\" : "/"));
}

// ---------- planning ----------

interface Classified {
  kind: "into-itself" | "same-place" | "free" | "conflict";
  name: string;
}

function classify(
  item: TransferItem,
  dstDir: string,
  onDisk: Map<string, ExistingEntry>,
  key: (n: string) => string,
  windows: boolean,
): Classified {
  const { basename, normalizePath, parentPath } = pathOps(windows);
  const name = basename(item.path);
  if (isInside(dstDir, item.path, windows)) return { kind: "into-itself", name };
  if (normalizePath(parentPath(item.path)) === normalizePath(dstDir)) {
    return { kind: "same-place", name };
  }
  return { kind: onDisk.has(key(name)) ? "conflict" : "free", name };
}

function indexListing(existing: readonly ExistingEntry[], key: (n: string) => string) {
  const onDisk = new Map<string, ExistingEntry>();
  for (const e of existing) onDisk.set(key(e.name), e);
  return onDisk;
}

/** Incoming names that collide with a different item already in `dstDir`
 *  and so need a policy. Empty → `planSteps` needs no question asked. */
export function findConflicts(
  items: readonly TransferItem[],
  dstDir: string,
  existing: readonly ExistingEntry[],
  windows: boolean,
): string[] {
  const key = (n: string) => (windows ? n.toLowerCase() : n);
  const onDisk = indexListing(existing, key);
  const names = new Set<string>();
  for (const it of items) {
    const c = classify(it, dstDir, onDisk, key, windows);
    if (c.kind === "conflict") names.add(c.name);
  }
  return [...names];
}

/** One step per item, in order. `existing` is the destination listing taken
 *  before anything runs; `policy` applies to every conflict. */
export function planSteps(
  items: readonly TransferItem[],
  dstDir: string,
  existing: readonly ExistingEntry[],
  op: TransferOp,
  policy: ConflictPolicy,
  windows: boolean,
): TransferStep[] {
  const { joinPath } = pathOps(windows);
  const key = (n: string) => (windows ? n.toLowerCase() : n);
  const onDisk = indexListing(existing, key);
  // Names this batch has already sent something to.
  const claimed = new Set<string>();
  const isTaken = (n: string) => onDisk.has(key(n)) || claimed.has(key(n));
  const steps: TransferStep[] = [];
  for (const it of items) {
    const c = classify(it, dstDir, onDisk, key, windows);
    const src = it.path;
    if (c.kind === "into-itself" || (c.kind === "same-place" && op === "move")) {
      steps.push({ action: "skip", src, reason: c.kind });
      continue;
    }
    const k = key(c.name);
    const isDir = it.isDir ?? onDisk.get(k)?.kind === "folder";
    let target = c.name;
    let replace: string | undefined;
    if (c.kind === "same-place" || claimed.has(k)) {
      target = pickFreeName(c.name, isDir, isTaken);
    } else if (c.kind === "conflict") {
      if (policy === "skip") {
        steps.push({ action: "skip", src, reason: "conflict" });
        continue;
      }
      const existingPath = joinPath(dstDir, onDisk.get(k)!.name);
      // Trashing a folder that holds the source would take the source along.
      if (policy === "replace" && !isInside(src, existingPath, windows)) {
        replace = existingPath;
      } else {
        target = pickFreeName(c.name, isDir, isTaken);
      }
    }
    claimed.add(key(target));
    const dst = joinPath(dstDir, target);
    steps.push(replace ? { action: "transfer", src, dst, replace } : { action: "transfer", src, dst });
  }
  return steps;
}

// ---------- running ----------

export interface TransferDeps {
  /** Every entry in `dir`, hidden ones included. Must reject on failure. */
  list: (dir: string) => Promise<readonly ExistingEntry[]>;
  /** Asked once when `conflicts` is non-empty; null cancels the operation. */
  ask: (conflicts: string[], dstDir: string) => Promise<ConflictPolicy | null>;
  copy: (src: string, dst: string) => Promise<void>;
  move: (src: string, dst: string) => Promise<void>;
  trash: (path: string) => Promise<void>;
  windows: boolean;
}

export interface TransferResult {
  /** What actually happened, for undo entries. */
  done: Array<{ src: string; dst: string }>;
  /** Existing entries moved to the trash to make room. */
  replaced: string[];
  skipped: Array<{ src: string; reason: SkipReason }>;
  failed: Array<{ src: string; error: string }>;
  /** Set when the user cancelled a copy or move partway: how many items
   *  didn't happen, the cancelled one included. Steps before it stand. */
  cancelled?: number;
}

/** List the destination, ask about conflicts, and plan. Null = cancelled.
 *  Rejects if the destination can't be listed. */
export async function planTransfer(
  items: readonly TransferItem[],
  dstDir: string,
  op: TransferOp,
  deps: Pick<TransferDeps, "list" | "ask" | "windows">,
): Promise<TransferStep[] | null> {
  const existing = await deps.list(dstDir);
  const conflicts = findConflicts(items, dstDir, existing, deps.windows);
  let policy: ConflictPolicy = "keep-both";
  if (conflicts.length > 0) {
    const picked = await deps.ask(conflicts, dstDir);
    if (!picked) return null;
    policy = picked;
  }
  return planSteps(items, dstDir, existing, op, policy, deps.windows);
}

/** Plan and run a copy or move of `items` into `dstDir`, one item at a time.
 *  Null = the user cancelled at the conflict question; nothing was done. */
export async function runTransfer(
  items: readonly TransferItem[],
  dstDir: string,
  op: TransferOp,
  deps: TransferDeps,
): Promise<TransferResult | null> {
  const res: TransferResult = { done: [], replaced: [], skipped: [], failed: [] };
  let steps: TransferStep[] | null;
  try {
    steps = await planTransfer(items, dstDir, op, deps);
  } catch (err) {
    const error = `can't read ${dstDir}: ${errText(err)}`;
    res.failed = items.map(it => ({ src: it.path, error }));
    return res;
  }
  if (!steps) return null;
  const { basename } = pathOps(deps.windows);
  for (const [i, s] of steps.entries()) {
    if (s.action === "skip") { res.skipped.push({ src: s.src, reason: s.reason }); continue; }
    if (s.replace) {
      try {
        await deps.trash(s.replace);
        res.replaced.push(s.replace);
      } catch (err) {
        res.failed.push({
          src: s.src,
          error: `couldn't move the existing ${basename(s.replace)} to the trash: ${errText(err)}`,
        });
        continue;
      }
    }
    try {
      if (op === "copy") await deps.copy(s.src, s.dst);
      else await deps.move(s.src, s.dst);
      res.done.push({ src: s.src, dst: s.dst });
    } catch (err) {
      if (isCancelled(err)) {
        // The backend removed the partial copy; the rest doesn't start.
        const rest = steps.slice(i);
        res.cancelled = rest.filter(t => t.action !== "skip").length;
        for (const t of rest) if (t.action === "skip") res.skipped.push({ src: t.src, reason: t.reason });
        break;
      }
      res.failed.push({ src: s.src, error: errText(err) });
    }
  }
  return res;
}

// ---------- messages ----------

const countItems = (n: number) => `${n} item(s)`;

/** Text for the conflict question. */
export function conflictMessage(names: string[], dstDir: string, windows: boolean): string {
  const where = pathOps(windows).basename(dstDir) || dstDir;
  const trash = windows ? "Recycle Bin" : "Trash";
  if (names.length === 1) {
    return `"${names[0]}" already exists in ${where}.\n\n` +
      `keep both: the new one gets a " (copy)" name.\n` +
      `replace: the existing one goes to the ${trash} first.`;
  }
  const list = names.slice(0, 5).map(n => `  ${n}`);
  if (names.length > 5) list.push(`  …and ${names.length - 5} more`);
  return `${names.length} items already exist in ${where}:\n${list.join("\n")}\n\n` +
    `keep both: the new ones get " (copy)" names.\n` +
    `replace: the existing ones go to the ${trash} first.`;
}

/** One-line toast for a finished transfer. */
export function summarize(
  res: TransferResult,
  op: TransferOp,
  windows: boolean,
): { message: string; variant: "success" | "info" | "warning" } {
  const reasons = (r: SkipReason) => res.skipped.filter(s => s.reason === r).length;
  const parts: string[] = [];
  if (res.done.length || res.skipped.length + res.failed.length + (res.cancelled ?? 0) === 0) {
    parts.push(`${op === "copy" ? "copied" : "moved"} ${countItems(res.done.length)}`);
  }
  if (res.replaced.length) {
    parts.push(`replaced ${res.replaced.length} (old in the ${windows ? "Recycle Bin" : "Trash"})`);
  }
  if (reasons("conflict")) parts.push(`skipped ${reasons("conflict")} that already exist`);
  if (reasons("same-place")) parts.push(`${countItems(reasons("same-place"))} already there`);
  if (reasons("into-itself")) {
    parts.push(`skipped ${reasons("into-itself")}: a folder can't go inside itself`);
  }
  if (res.failed.length) parts.push(`${res.failed.length} failed`);
  if (res.cancelled) {
    parts.push(`cancelled: ${countItems(res.cancelled)} not ${op === "copy" ? "copied" : "moved"}`);
  }
  const variant = res.failed.length || reasons("into-itself")
    ? "warning"
    : res.done.length ? "success" : "info";
  return { message: parts.join(", "), variant };
}

/** Alert text listing failures, or null when nothing failed. */
export function failureDetails(res: TransferResult, windows: boolean): string | null {
  if (res.failed.length === 0) return null;
  const { basename } = pathOps(windows);
  const lines = res.failed.slice(0, 5).map(f => `${basename(f.src)}: ${f.error}`);
  if (res.failed.length > 5) lines.push(`…and ${res.failed.length - 5} more`);
  return lines.join("\n");
}
