// The pins a first run starts with, so the sidebar doesn't open empty:
// home and the known folders that exist, then the folders the desktop's own
// file manager has as bookmarks (desktop_places: GTK's bookmarks, KDE's
// places, Quick Access on Windows). App asks for them only when there are no
// saved settings and no pins file, so pins the user has, or removed, stay.
// docs/decisions/2026-11-20-first-run-defaults.md

import { desktopPlaces, homeDir, knownFolder, pathKind, type KnownFolder } from "./api";
import { normalizePath } from "./paths";

/** In the order other file managers list them. */
const KNOWN: readonly KnownFolder[] = ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos"];

/** How long the bookmarks may take: one on a network share that's gone can
 *  hold up the OS's calls. Without them the known folders are pinned. */
export const PLACES_WAIT_MS = 3000;

export interface PlacesDeps {
  home: () => Promise<string | null>;
  known: (name: KnownFolder) => Promise<string | null>;
  isFolder: (path: string) => Promise<boolean>;
  places: () => Promise<string[]>;
}

const DEPS: PlacesDeps = {
  home: homeDir,
  known: knownFolder,
  isFolder: async p => (await pathKind(p)) === "folder",
  places: desktopPlaces,
};

/** `first`, then the paths of `then` that aren't in it; each path once. */
export function mergePins(first: readonly string[], then: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...first, ...then]) {
    const k = normalizePath(p);
    if (!p || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export async function firstRunPins(deps: PlacesDeps = DEPS, waitMs = PLACES_WAIT_MS): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const places = Promise.race([
    deps.places().catch((): string[] => []),
    new Promise<string[]>(resolve => { timer = setTimeout(() => resolve([]), waitMs); }),
  ]);
  const home = await deps.home().catch(() => null);
  const known = await Promise.all(KNOWN.map(n => deps.known(n).catch(() => null)));
  const candidates = mergePins([home, ...known].filter((p): p is string => !!p), []);
  const there = await Promise.all(candidates.map(p => deps.isFolder(p).catch(() => false)));
  const folders = candidates.filter((_, i) => there[i]);
  const found = await places;
  clearTimeout(timer);
  return mergePins(folders, found);
}
