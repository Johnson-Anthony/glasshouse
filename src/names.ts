// Name checks for creating and renaming inside a folder, run before the
// prompt closes so a taken name is refused inline. The backend's make_dir,
// rename_entry and creating write_text refuse a taken name too, which covers
// a name taken after this check (see `unlessTaken` in transferUi.ts).
// Policy notes: docs/decisions/2026-11-08-create-rename-conflicts-policy.md
import { errText } from "./errors";
import { joinPath } from "./paths";
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

/** One step of a bulk rename: `from` → `to` inside `dir`. */
export interface RenameStep extends RenameMove {
  dir: string;
}

/** How a run went. After a failure, `ran` steps had run before `error`, and
 *  `stuck` lists those that couldn't be put back. */
export type RenameRun =
  | { ok: true; ran: number }
  | { ok: false; ran: number; error: unknown; stuck: RenameStep[] };

/** Run `steps` in order through `rename` (full paths). If one fails, the
 *  steps before it are put back, newest first, so a failed run leaves the
 *  folders as they were, temporary names included. A step that can't be put
 *  back goes in `stuck` and the rest are still tried: the backend refuses a
 *  rename onto a taken name, so trying can't overwrite anything. */
export async function runRenameSteps(
  steps: readonly RenameStep[],
  rename: (from: string, to: string) => Promise<void>,
  onStep?: (ran: number) => void,
): Promise<RenameRun> {
  const done: RenameStep[] = [];
  try {
    for (const s of steps) {
      await rename(joinPath(s.dir, s.from), joinPath(s.dir, s.to));
      done.push(s);
      onStep?.(done.length);
    }
    return { ok: true, ran: done.length };
  } catch (error) {
    const stuck: RenameStep[] = [];
    for (const s of [...done].reverse()) {
      try {
        await rename(joinPath(s.dir, s.to), joinPath(s.dir, s.from));
      } catch {
        stuck.push(s);
      }
    }
    return { ok: false, ran: done.length, error, stuck };
  }
}

/** What to tell the user about a run that failed. */
export function renameFailure(run: Extract<RenameRun, { ok: false }>): string {
  const msg = errText(run.error);
  if (run.ran === 0) return msg;
  return run.stuck.length === 0
    ? `${msg} (the renames before it were put back)`
    : `${msg} (${run.stuck.length} earlier rename(s) couldn't be put back; check the folder)`;
}

/** Steps that undo `steps`: each one reversed, last first. */
export const reverseRenameSteps = (steps: readonly RenameStep[]): RenameStep[] =>
  [...steps].reverse().map(s => ({ dir: s.dir, from: s.to, to: s.from }));

/** Why `steps` can't run in folders that hold `listings` (names by folder),
 *  or null if they can. Walks the steps in order, so a name an earlier step
 *  frees counts as free, as it will be by then. */
export function renameStepsProblem(
  steps: readonly RenameStep[],
  listings: ReadonlyMap<string, readonly string[]>,
  windows: boolean,
): string | null {
  const byDir = new Map<string, NameSet>();
  for (const s of steps) {
    let names = byDir.get(s.dir);
    if (!names) {
      names = new NameSet(listings.get(s.dir) ?? [], windows);
      byDir.set(s.dir, names);
    }
    if (!names.has(s.from)) return `"${s.from}" is no longer in ${s.dir}`;
    if (names.has(s.to) && names.key(s.to) !== names.key(s.from)) {
      return `"${s.to}" already exists in ${s.dir}`;
    }
    names.delete(s.from);
    names.add(s.to);
  }
  return null;
}
