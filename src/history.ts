// Per-tab back/forward history as pure functions. useTabState applies these
// outside React state updaters so StrictMode's double-invoked updaters can't
// duplicate entries. Each returns the input object unchanged when it's a no-op.
//
// Every path a tab opens comes through navInit or navGoTo, so this is where
// a Windows verbatim path (`\\?\C:\…`, from a saved file, another app or the
// command line) becomes the plain one the breadcrumb, tags and pins use.
import { plainPath } from "./paths";

export interface NavState {
  path: string;
  back: string[];
  forward: string[];
}

export function navInit(path: string): NavState {
  return { path: plainPath(path), back: [], forward: [] };
}

export function navGoTo(nav: NavState, to: string): NavState {
  const next = plainPath(to);
  if (nav.path === next) return nav;
  return { path: next, back: [...nav.back, nav.path], forward: [] };
}

export function navBack(nav: NavState): NavState {
  if (nav.back.length === 0) return nav;
  return {
    path: nav.back[nav.back.length - 1],
    back: nav.back.slice(0, -1),
    forward: [...nav.forward, nav.path],
  };
}

export function navForward(nav: NavState): NavState {
  if (nav.forward.length === 0) return nav;
  return {
    path: nav.forward[nav.forward.length - 1],
    back: [...nav.back, nav.path],
    forward: nav.forward.slice(0, -1),
  };
}

export function navClear(nav: NavState): NavState {
  if (nav.back.length === 0 && nav.forward.length === 0) return nav;
  return { path: nav.path, back: [], forward: [] };
}
