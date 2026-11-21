// The window's tabs in one or two panes (tabLayout.ts), with each tab's
// live state (useTabState, through a headless TabShell keyed by tab id) and
// the operations the menus, keys and drags use. The layout is reported for
// the session (session.ts) whenever it, or a tab's folder or sort, changes.
// Moved out of App.tsx for split view; see
// docs/decisions/2026-11-21-split-and-tear-off-session.md.

import { useEffect, useRef, useState } from "react";
import { registerTabListMutator, useTabState, type TabSeed, type UseTabResult } from "./state";
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
import { DEFAULT_SORT, saveSession, sessionOf, type Session, type TabSort } from "./session";
import { recordFromTransfer, transferOf } from "./tabTransfer";
import { sessionReport } from "./api";

/** Whether this window has the focus (a page with no window to ask, as in
 *  the tests: yes). */
function windowFocused(): boolean {
  try { return document.hasFocus(); } catch { return true; }
}

/** The sort a new tab opened from `h` starts with. */
export function sortOf(h: UseTabResult | undefined): TabSort | undefined {
  return h && { key: h.state.sortKey, dir: h.state.sortDir };
}

interface TabShellProps {
  id: number;
  initialPath: string;
  initialSort?: TabSort;
  seed?: TabSeed;
  isPrivate?: boolean;
  /** Shown in a pane; the others don't poll (see useTabState). */
  active: boolean;
  /** Called with the tab's latest state, and with null when it unmounts. */
  onReady: (id: number, r: UseTabResult | null) => void;
}

function TabShell({ id, initialPath, initialSort, seed, isPrivate, active, onReady }: TabShellProps) {
  const tab = useTabState(initialPath, !!isPrivate, active, initialSort, seed);
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
  /** The first layout, once the tabs to open are known. From now on the
   *  tabs are reported for the session; `owner`: this window's process
   *  saves it, and the window writes the v1 key while it has the focus. */
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
  // Then every change is reported to the backend, which saves every
  // window's tabs; the owner's focused window also writes the v1 key, which
  // older builds read (session.ts).
  const session = useRef<{ owner: boolean; last: string | null; record: Session | null; reported: string | null } | null>(null);
  useEffect(() => {
    const s = session.current;
    if (!s || layout.panes[0].tabs.length === 0) return;
    const live = layout.panes.map(p => ({
      active: p.active,
      tabs: p.tabs.map(t => {
        const h = handles[t.id];
        return { path: h?.state.path ?? t.initialPath, sort: sortOf(h) ?? t.initialSort ?? DEFAULT_SORT, private: t.private };
      }),
    }));
    const record = sessionOf(live, layout.focus, layout.dir, layout.ratio);
    s.record = record;
    const json = JSON.stringify(record);
    if (json !== s.reported) {
      s.reported = json;
      void sessionReport(record);
    }
    if (s.owner && windowFocused()) s.last = saveSession(record, s.last);
  }, [layout, handles]);
  // A window that takes the focus writes the v1 key, whatever another
  // window wrote there meanwhile.
  useEffect(() => {
    const onFocus = () => {
      const s = session.current;
      if (s?.owner && s.record) s.last = saveSession(s.record, null);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

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
      // That tab's live folder, sort, history and filters, if it has a
      // handle; else what it opened with.
      const h = handles[t.id];
      const copy = h ? recordFromTransfer(transferOf(h.state)) : copyOf(undefined, t);
      setLayout(l => addTab(l, at, copy, undefined, false));
    },
    copyOf,
    start: (l, owner) => {
      session.current = { owner, last: null, record: null, reported: null };
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
            seed={t.seed}
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
