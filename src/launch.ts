// What a window started with paths opens: another app's "Show in folder"
// (FileManager1, through the resident in src-tauri/src/resident.rs), a
// folder opened from another app (the desktop entry's %U, Explorer's
// folder verb) or `glasshouse PATH…` in a terminal (startup.rs).
//
// One tab per folder, in the order given. A folder opens as itself; a file,
// and with "select" or "properties" every item, opens its folder with it
// selected, items of one folder together. Such a window never takes the
// session (session.rs), so it neither restores nor saves tabs.

import { pathKind, type LaunchRequest } from "./api";
import { pathOps, type PathOps } from "./paths";
import { IS_WINDOWS } from "./platform";

/** What `pathKind` said about a path. */
export type Kind = "folder" | "file" | "unknown" | null;

export interface LaunchTab {
  /** The folder the tab opens. */
  path: string;
  /** What to select in it once it's listed; none: just the folder. */
  select: string[];
}

export interface LaunchPlan {
  tabs: LaunchTab[];
  /** The item whose Properties to show once it's selected. */
  properties: string | null;
  /** What couldn't be opened, each with why. */
  problems: string[];
}

export function planLaunch(
  req: LaunchRequest,
  kinds: ReadonlyMap<string, Kind>,
  ops: Pick<PathOps, "normalizePath" | "parentPath">,
): LaunchPlan {
  const tabs: LaunchTab[] = [];
  const problems = [...req.skipped];
  let properties: string | null = null;
  const same = (a: string, b: string) => ops.normalizePath(a) === ops.normalizePath(b);
  const tabFor = (folder: string): LaunchTab => {
    let t = tabs.find(t => same(t.path, folder));
    if (!t) {
      t = { path: folder, select: [] };
      tabs.push(t);
    }
    return t;
  };
  for (const p of req.paths) {
    // "unknown": the stat failed, so the tab's listing says why. (null is
    // an answer: nothing is there.)
    const asked = kinds.get(p);
    const kind = asked === undefined ? "unknown" : asked;
    if (kind === null) {
      problems.push(`${p}: no such file or folder`);
      continue;
    }
    const parent = ops.parentPath(p);
    // A root has no folder to be selected in: it opens.
    const select = (req.mode !== "open" || kind === "file") && parent !== p;
    if (!select) {
      tabFor(p);
      continue;
    }
    const t = tabFor(parent);
    if (!t.select.some(s => same(s, p))) t.select.push(p);
    if (req.mode === "properties" && properties === null) properties = p;
  }
  return { tabs, properties, problems };
}

/** The plan for `req`, with one stat per path. */
export async function launchPlan(req: LaunchRequest): Promise<LaunchPlan> {
  const kinds = new Map(await Promise.all(req.paths.map(async p => [p, await pathKind(p)] as const)));
  return planLaunch(req, kinds, pathOps(IS_WINDOWS));
}
