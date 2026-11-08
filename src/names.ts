// Name checks for creating and renaming inside a folder, run before the
// prompt closes so a taken name is refused inline. The backend's make_dir,
// rename_entry and creating write_text refuse a taken name too, which covers
// a name taken after this check (see `unlessTaken` in transferUi.ts).
// Policy notes: docs/decisions/2026-11-08-create-rename-conflicts-policy.md
import { splitExt } from "./transfer";

/** Names in one folder, compared case-insensitively on Windows. */
export class NameSet {
  private keys = new Set<string>();

  constructor(names: Iterable<string>, readonly windows: boolean) {
    for (const n of names) this.add(n);
  }

  key(name: string): string {
    return this.windows ? name.toLowerCase() : name;
  }

  has = (name: string): boolean => this.keys.has(this.key(name));

  add(name: string): void {
    this.keys.add(this.key(name));
  }

  delete(name: string): void {
    this.keys.delete(this.key(name));
  }
}

/** The problem `nameProblem` reports for a name that's taken. */
export const takenProblem = (name: string): string => `"${name}" already exists here`;

/** Why `name` can't be given to a new or renamed entry in a folder holding
 *  `taken`, or null if it can. `self` is the current name of the entry being
 *  renamed: keeping it in another case is fine where names ignore case. */
export function nameProblem(name: string, taken: NameSet, self?: string): string | null {
  if (!name.trim()) return "name required";
  if (name === "." || name === "..") return `"${name}" isn't a usable name`;
  if (name.includes("/") || (taken.windows && name.includes("\\"))) {
    return taken.windows ? "a name can't contain / or \\" : "a name can't contain /";
  }
  if (taken.has(name) && !(self !== undefined && taken.key(self) === taken.key(name))) {
    return takenProblem(name);
  }
  return null;
}

/** `name` if free, else "name (2).ext", "name (3).ext"… For suggesting a
 *  default name for something new (copies use transfer.ts's pickFreeName). */
export function freeNewName(name: string, isDir: boolean, isTaken: (name: string) => boolean): string {
  if (!isTaken(name)) return name;
  const [stem, ext] = splitExt(name, isDir);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!isTaken(candidate)) return candidate;
  }
}

// ---------- bulk rename ----------

/** One rename inside a single folder, by name. */
export interface RenameMove {
  from: string;
  to: string;
}

/** Per-move problem (or null), parallel to `moves`. Unchanged moves
 *  (`from === to`) keep their name, so it stays taken. `existing` is every
 *  name in the folder, the batch's own entries included. */
export function checkRenames(
  moves: readonly RenameMove[],
  existing: readonly string[],
  windows: boolean,
): (string | null)[] {
  const changing = (m: RenameMove) => m.from !== m.to;
  // Names that will still be there: everything on disk except what moves away.
  const staying = new NameSet(existing, windows);
  for (const m of moves) if (changing(m)) staying.delete(m.from);
  const targets = new Map<string, number>();
  for (const m of moves) {
    if (!changing(m)) continue;
    const k = staying.key(m.to);
    targets.set(k, (targets.get(k) ?? 0) + 1);
  }
  return moves.map(m => {
    if (!changing(m)) return null;
    const p = nameProblem(m.to, staying);
    if (p) return p;
    return targets.get(staying.key(m.to))! > 1 ? `more than one item would be "${m.to}"` : null;
  });
}

/** An order to run `moves` (all changing, already checked) so that no rename
 *  lands on a name that is still in use. Chains run target-first; a cycle
 *  (a→b, b→a) parks one item under a temporary "name~rename" first. */
export function orderRenames(
  moves: readonly RenameMove[],
  existing: readonly string[],
  windows: boolean,
): RenameMove[] {
  const occupied = new NameSet(existing, windows);
  const targets = new NameSet(moves.map(m => m.to), windows);
  const pending = moves.map(m => ({ ...m }));
  const steps: RenameMove[] = [];
  while (pending.length > 0) {
    const i = pending.findIndex(m =>
      occupied.key(m.to) === occupied.key(m.from) || !occupied.has(m.to));
    if (i >= 0) {
      const [m] = pending.splice(i, 1);
      steps.push(m);
      occupied.delete(m.from);
      occupied.add(m.to);
      continue;
    }
    // Nothing can run, so the remaining targets are held by pending sources
    // (a cycle); anything else means the batch skipped checkRenames.
    const sources = new NameSet(pending.map(p => p.from), windows);
    const m = pending.find(p => sources.has(p.to));
    if (!m) throw new Error(`"${pending[0].to}" already exists here`);
    const tmp = freeNewName(`${m.from}~rename`, true, n => occupied.has(n) || targets.has(n));
    steps.push({ from: m.from, to: tmp });
    occupied.delete(m.from);
    occupied.add(tmp);
    m.from = tmp;
  }
  return steps;
}
