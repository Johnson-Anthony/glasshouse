// The window's tabs in one or two panes (tabLayout.ts), with each tab's
// live state (useTabState, through a headless TabShell keyed by tab id) and
// the operations the menus, keys and drags use. The owner of the session
// (session.ts) saves the layout whenever it, or a tab's folder or sort,
// changes. Moved out of App.tsx for split view; see
// docs/plans/completed/split-and-tear-off.md.

import { useEffect, useRef, useState } from "react";
import { registerTabListMutator, useTabState, type UseTabResult } from "./state";
import { makeTab, moveTab as moveTabIn, tabLabel, type TabRecord } from "./tabs";
import {
  addTab,
  closeOthersIn,
  closeTabIn,
  EMPTY_LAYOUT,
  focusedPane,
  relabel,
  setActive,
  setFocus,
  shownIds,
  type Layout,
} from "./tabLayout";
import { DEFAULT_SORT, saveSession, sessionOf, type TabSort } from "./session";

/** The sort a new tab opened from `h` starts with. */
export function sortOf(h: UseTabResult | undefined): TabSort | undefined {
  return h && { key: h.state.sortKey, dir: h.state.sortDir };
}

interface TabShellProps {
  id: number;
  initialPath: string;
  initialSort?: TabSort;
  isPrivate?: boolean;
  /** Shown in a pane; the others don't poll (see useTabState). */
  active: boolean;
  /** Called with the tab's latest state, and with null when it unmounts. */
  onReady: (id: number, r: UseTabResult | null) => void;
}

function TabShell({ id, initialPath, initialSort, isPrivate, active, onReady }: TabShellProps) {
  const tab = useTabState(initialPath, !!isPrivate, active, initialSort);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; });
  useEffect(() => {
    onReadyRef.current(id, tab);
  }, [id, tab]);
  useEffect(() => () => onReadyRef.current(id, null), [id]);
  return null;
}

export interface TabLayoutApi {
  layout: Layout;
  /** Keyed by TabRecord.id, never by position. */
  handles: Record<number, UseTabResult>;
  /** The focused pane's tabs and shown tab, and that tab's handle: what
   *  the menus, keys, toolbar, status bar and Inspector act on. */
  tabs: TabRecord[];
  activeTab: number;
  activeHandle: UseTabResult | undefined;
  /** The handle of the tab shown in `pane`. */
  shownHandle: (pane: number) => UseTabResult | undefined;
  /** Every layout change goes through here. */
  update: (fn: (l: Layout) => Layout) => void;
  setActiveTab: (i: number, pane?: number) => void;
  focusPane: (pane: number) => void;
  /** A tab at the folder `pane` (the focused one when unset) shows. */
  openNewTab: (pane?: number) => void;
  openPathInNewTab: (p: string, isPrivate?: boolean) => void;
  closeTabAt: (i: number, pane?: number) => void;
  closeOtherTabsAt: (keep: number, pane?: number) => void;
  duplicateTabAt: (i: number, pane?: number) => void;
  /** A tab for `h`'s folder, sort and private flag, unmounted. */
  copyOf: (h: UseTabResult | undefined, t: TabRecord) => TabRecord;
  /** The first layout, once the tabs to open are known. `owner`: this
   *  window saves the session from now on. */
  start: (l: Layout, owner: boolean) => void;
  /** The headless TabShells; render once. */
  shells: JSX.Element;
}

export function useTabLayout(fallbackPath: () => string, hidden: boolean): TabLayoutApi {
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const [handles, setHandles] = useState<Record<number, UseTabResult>>({});
  const update = (fn: (l: Layout) => Layout) => setLayout(fn);

  const pane = focusedPane(layout);
  const tabs = pane.tabs;
  const activeTab = pane.active;
  const activeId = tabs[activeTab]?.id;
  const activeHandle = activeId === undefined ? undefined : handles[activeId];
  const shownHandle = (p: number) => {
    const l = layout.panes[p];
    const id = l?.tabs[l.active]?.id;
    return id === undefined ? undefined : handles[id];
  };
  const focusOr = (p: number | undefined) => p ?? layout.focus;
  const shown = shownIds(layout);

  // Set once the tabs are known (start); until then there's nothing to save.
  // The owner then saves the tabs as they change.
  const session = useRef<{ owner: boolean; last: string | null } | null>(null);
  useEffect(() => {
    const s = session.current;
    if (!s?.owner || layout.panes[0].tabs.length === 0) return;
    const live = layout.panes.map(p => ({
      active: p.active,
      tabs: p.tabs.map(t => {
        const h = handles[t.id];
        return { path: h?.state.path ?? t.initialPath, sort: sortOf(h) ?? t.initialSort ?? DEFAULT_SORT, private: t.private };
      }),
    }));
    s.last = saveSession(sessionOf(live, layout.focus, layout.dir, layout.ratio), s.last);
  }, [layout, handles]);

  // Show Hidden is a setting: each shown tab follows it.
  const shownKey = shown.join(",");
  useEffect(() => {
    for (const id of shown) {
      const h = handles[id];
      if (h && h.state.showHidden !== hidden) h.actions.setShowHidden(hidden);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, shownKey, handles]);

  // Each shown tab's label follows its folder.
  const labels = shown.map(id => {
    const h = handles[id];
    return h ? `${id}\0${tabLabel(h.state.path, h.state.private)}` : "";
  }).join("\n");
  useEffect(() => {
    for (const line of labels.split("\n")) {
      if (!line) continue;
      const [id, label] = line.split("\0");
      setLayout(l => relabel(l, Number(id), label));
    }
  }, [labels]);

  const copyOf = (h: UseTabResult | undefined, t: TabRecord) =>
    makeTab(h?.state.path ?? t.initialPath, { private: t.private, sort: sortOf(h) ?? t.initialSort });

  const openPathInNewTab = (p: string, isPrivate: boolean = false) => {
    const sort = sortOf(activeHandle);
    setLayout(l => addTab(l, l.focus, makeTab(p, { private: isPrivate, sort }), undefined, false));
  };

  const api: TabLayoutApi = {
    layout,
    handles,
    tabs,
    activeTab,
    activeHandle,
    shownHandle,
    update,
    setActiveTab: (i, p) => setLayout(l => setActive(l, p ?? l.focus, i)),
    focusPane: p => setLayout(l => setFocus(l, p)),
    openNewTab: p => {
      const at = focusOr(p);
      const from = shownHandle(at);
      const seed = from?.state.path ?? fallbackPath();
      const sort = sortOf(from);
      setLayout(l => addTab(l, at, makeTab(seed, { sort }), undefined, false));
    },
    openPathInNewTab,
    // Each TabShell drops its own handle when it unmounts, so closing only
    // edits the layout.
    closeTabAt: (i, p) => {
      const at = focusOr(p);
      setLayout(l => closeTabIn(l, at, i, fallbackPath()));
    },
    closeOtherTabsAt: (keep, p) => {
      const at = focusOr(p);
      setLayout(l => closeOthersIn(l, at, keep));
    },
    duplicateTabAt: (i, p) => {
      const at = focusOr(p);
      const t = layout.panes[at]?.tabs[i];
      if (!t) return;
      // The live folder and sort of that tab, if it has a handle.
      const copy = copyOf(handles[t.id], t);
      setLayout(l => addTab(l, at, copy, undefined, false));
    },
    copyOf,
    start: (l, owner) => {
      session.current = { owner, last: null };
      setLayout(l);
    },
    shells: (
      <>
        {layout.panes.flatMap(p => p.tabs).map(t => (
          <TabShell
            key={t.id}
            id={t.id}
            initialPath={t.initialPath}
            initialSort={t.initialSort}
            isPrivate={t.private}
            active={shown.includes(t.id)}
            onReady={(id, r) => setHandles(prev => {
              if (r) return prev[id] === r ? prev : { ...prev, [id]: r };
              if (!(id in prev)) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            })}
          />
        ))}
      </>
    ),
  };

  useEffect(() => {
    registerTabListMutator({
      moveTab: (from, to) => setLayout(l => {
        const p = l.panes[l.focus];
        return from === to ? l : { ...l, panes: l.panes.map((x, i) => (i === l.focus ? moveTabIn(p, from, to) : x)) };
      }),
      newTab: (path, opts) => {
        const p = path ?? activeHandle?.state.path ?? fallbackPath();
        const sort = sortOf(activeHandle);
        setLayout(l => addTab(l, l.focus, makeTab(p, { private: !!opts?.private, sort })));
      },
    });
    return () => registerTabListMutator(null);
  });

  return api;
}
