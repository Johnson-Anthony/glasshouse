import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { MENUS, type MenuItemDef, type DynamicPayload, type DynamicSource } from "./data";
import { gitBranchList, listShellProfiles, readPins, readRecent } from "./api";
import { getVersion } from "@tauri-apps/api/app";
import type { TweakState } from "./components";
import { DISPLAY_MODE_DEFAULT, DISPLAY_MODE_KEY, LAYOUT_DEFAULT, LAYOUT_KEY } from "./handlers/view";
import { isModalOpen } from "./dialogs/modal";
import { firstIndex, fitPath, lastIndex, menuKey, mnemonics, titleForKey, type MenuPath } from "./menuNav";

// ─── dynamic menu expansion ────────────────────────────────────────────────
// Menu trees include `{ kind: "dynamic", source: … }` sentinel nodes. When a
// dropdown renders, we swap each sentinel for a fresh set of real `item`
// nodes with a `payload` field so the click handler knows whether to open a
// path or run a terminal profile. Results are cached per-mount in component
// state, so the menu only fetches once per open.

// Git branch resolver needs cwd; loadDynamic is cwd-agnostic, so App sets
// this module-level ref on tab change. Hacky but avoids threading cwd
// through every menu prop.
let currentCwdForBranches = "";
export function setDynamicGitCwd(cwd: string): void {
  currentCwdForBranches = cwd;
}

async function loadDynamic(source: DynamicSource): Promise<MenuItemDef[]> {
  switch (source) {
    case "recent": {
      const paths = await readRecent();
      return paths.map<MenuItemDef>((p) => ({
        kind: "item",
        label: p,
        payload: { type: "open-path", path: p },
      }));
    }
    case "bookmarks-pinned": {
      const pins = await readPins();
      return pins.map<MenuItemDef>((p) => ({
        kind: "item",
        label: p,
        payload: { type: "open-path", path: p },
      }));
    }
    case "terminal-profiles": {
      const profs = await listShellProfiles();
      return profs.map<MenuItemDef>((profile) => ({
        kind: "item",
        label: profile.label,
        payload: { type: "run-profile", profile },
      }));
    }
    case "ssh-hosts": {
      const profs = await listShellProfiles();
      return profs
        .filter((p) => p.kind === "ssh")
        .map<MenuItemDef>((profile) => ({
          kind: "item",
          label: profile.label,
          payload: { type: "run-profile", profile },
        }));
    }
    case "git-branches": {
      if (!currentCwdForBranches) return [];
      try {
        const branches = await gitBranchList(currentCwdForBranches);
        return branches.map<MenuItemDef>((b) => ({
          kind: "item",
          // show * prefix on current; dispatch via action so handler can
          // identify the target without parsing cosmetic prefixes.
          label: `${b.current ? "* " : "  "}${b.name}`,
          action: `git-branch:${b.name}`,
        }));
      } catch {
        return [];
      }
    }
  }
}

function useExpandedItems(items: MenuItemDef[], trigger: unknown): MenuItemDef[] {
  const [expanded, setExpanded] = useState<MenuItemDef[]>(items);

  useEffect(() => {
    let cancelled = false;
    const sources: DynamicSource[] = [];
    const collect = (list: MenuItemDef[]) => {
      for (const it of list) {
        if (it.kind === "dynamic") sources.push(it.source);
        else if (it.kind === "sub") collect(it.children);
      }
    };
    collect(items);
    if (sources.length === 0) {
      setExpanded(items);
      return;
    }
    void (async () => {
      const unique = Array.from(new Set(sources));
      const resolved = new Map<DynamicSource, MenuItemDef[]>();
      await Promise.all(
        unique.map(async (s) => {
          try { resolved.set(s, await loadDynamic(s)); }
          catch { resolved.set(s, []); }
        }),
      );
      if (cancelled) return;
      const expand = (list: MenuItemDef[]): MenuItemDef[] => {
        const out: MenuItemDef[] = [];
        for (const it of list) {
          if (it.kind === "dynamic") {
            const got = resolved.get(it.source) ?? [];
            out.push(...got);
          } else if (it.kind === "sub") {
            out.push({ ...it, children: expand(it.children) });
          } else {
            out.push(it);
          }
        }
        return out;
      };
      setExpanded(expand(items));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, items]);

  return expanded;
}

// ============= Menu items =============

/** Toggle-state fed into the menubar so resolveChecked can reflect live UI
 *  state (tweaks + sidebar/status-bar visibility) rather than stale static
 *  `check: true` hints. `undefined` means "use the static hint on the item". */
export interface MenuToggleState {
  tweaks?: TweakState;
  sidebarVisible?: boolean;
  statusBarVisible?: boolean;
  inspectorVisible?: boolean;
}

const MenuToggleContext = React.createContext<MenuToggleState>({});

/** Resolve whether this menu item should render a ✓ mark. Checks live toggle
 *  state first (tweaks/sidebar/status-bar), then falls back to the submenu
 *  selection stored in localStorage for Display Mode / Layout, then the
 *  static `check: true` flag on the data.ts entry. */
function resolveChecked(item: MenuItemDef, toggles: MenuToggleState, parentLabel?: string): boolean {
  if (item.kind !== "item") return false;
  if (parentLabel === "Display Mode") {
    const stored = localStorage.getItem(DISPLAY_MODE_KEY) ?? DISPLAY_MODE_DEFAULT;
    return item.label === stored;
  }
  if (parentLabel === "Layout") {
    const stored = localStorage.getItem(LAYOUT_KEY) ?? LAYOUT_DEFAULT;
    return item.label === stored;
  }
  const tw = toggles.tweaks;
  switch (item.label) {
    case "Show Hidden Files":
    case "Show Hidden":
      return !!tw?.hidden;
    case "Show File Extensions":
      return !!tw?.showExtensions;
    case "Show Git Gutters":
      return !!tw?.showGitGutters;
    case "Folders First":
      return !!tw?.foldersFirst;
    case "Follow Folder":
      return !!tw?.termFollow;
    case "Sidebar":
      return toggles.sidebarVisible !== undefined ? toggles.sidebarVisible : !!item.check;
    case "Status Bar":
      return toggles.statusBarVisible !== undefined ? toggles.statusBarVisible : !!item.check;
    case "Inspector":
      return toggles.inspectorVisible !== undefined ? toggles.inspectorVisible : !!item.check;
  }
  return !!item.check;
}

// ============= Keyboard focus =============
// A menu takes the keyboard focus while it's open, so keys move in it rather
// than reaching the file pane or App's shortcuts, and gives it back when it
// closes.

/** What has focus now; null when nothing does. */
function focusOwner(): HTMLElement | null {
  const a = document.activeElement;
  return a instanceof HTMLElement && a !== document.body ? a : null;
}

/** Gives focus back to `prev` as a menu closes, unless it has already moved
 *  out of the menu (the command focused a field or opened a dialog). */
function giveBackFocus(prev: HTMLElement | null, menu: HTMLElement | null): void {
  const a = document.activeElement;
  if (a && a !== document.body && !menu?.contains(a)) return;
  if (prev?.isConnected) prev.focus({ preventScroll: true });
  else if (a instanceof HTMLElement && a !== document.body) a.blur();
}

/** Alt and F10 leave these alone: the terminal (its shell has F10 and the
 *  Alt+letters), the palette and an open context menu. */
const KEEPS_KEYS = ".term-drawer, .palette, .ctx-menu";

// ============= Menu lists =============

type ItemDef = Extract<MenuItemDef, { kind: "item" }>;
type SubDef = Extract<MenuItemDef, { kind: "sub" }>;

interface MenuListProps {
  items: MenuItemDef[];
  /** The highlighted item at each open level (see menuNav.ts). */
  path: MenuPath;
  /** The level of `path` this list shows. */
  level: number;
  setPath: (path: MenuPath) => void;
  onRun: (item: ItemDef) => void;
  parentLabel?: string;
}

/** One list of a menu: a dropdown, a context menu or a submenu. The mouse
 *  moves the same highlight the keys do. */
function MenuList(props: MenuListProps) {
  return <>{props.items.map((it, i) => <MenuItem key={i} {...props} item={it} index={i} />)}</>;
}

function MenuItem({ item, index, path, level, setPath, onRun, parentLabel }: MenuListProps & { item: MenuItemDef; index: number }) {
  const toggles = React.useContext(MenuToggleContext);
  const ref = useRef<HTMLDivElement>(null);
  const hot = path[level] === index;
  // A long context menu scrolls: keep the highlighted item in view.
  useEffect(() => {
    if (hot) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [hot]);
  if (item.kind === "sep") return <div className="sep" role="separator" />;
  if (item.kind === "grouplabel") return <div className="group-label">{item.label}</div>;
  if (item.kind === "dynamic") {
    // Should have been expanded upstream; render an empty sentinel if not.
    return null;
  }
  const isSub = item.kind === "sub";
  const subOpen = isSub && hot && path.length > level + 1;
  const danger = item.kind === "item" && item.danger;
  const check = resolveChecked(item, toggles, parentLabel);
  const kb = item.kind === "item" ? item.kb : undefined;
  return (
    <div
      ref={ref}
      className={"mi" + (danger ? " danger" : "") + (hot ? " hover" : "")}
      role="menuitem"
      aria-haspopup={isSub ? "menu" : undefined}
      aria-expanded={isSub ? subOpen : undefined}
      onMouseEnter={() => {
        // Back on an open submenu's item: keep what's highlighted inside.
        if (subOpen) return;
        const at = [...path.slice(0, level), index];
        setPath(isSub ? [...at, -1] : at);
      }}
      onClick={() => {
        if (item.kind === "item") onRun(item);
      }}
    >
      <span className="ic">{check ? "✓" : item.ic || ""}</span>
      <span>{item.label}</span>
      <span className="kb">{kb || ""}</span>
      <span className="chev">{isSub ? "›" : ""}</span>
      {item.kind === "sub" && subOpen && (
        <SubDropdown item={item} path={path} level={level + 1} setPath={setPath} onRun={onRun} />
      )}
    </div>
  );
}

/** A submenu. Its children came expanded with the menu it belongs to. */
function SubDropdown({ item, ...list }: Omit<MenuListProps, "items" | "parentLabel"> & { item: SubDef }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ left: "calc(100% + 2px)", top: -4, minWidth: 240 });
  // The menu is DOM inside the webview, so a submenu near a window edge just
  // clips — flip to the parent's left edge / shift up when the natural spot
  // runs off-screen. Anchored on the parent .mi rect so re-runs (dynamic
  // children arriving) stay stable regardless of the current placement.
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    const M = 6;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const next: React.CSSProperties = { left: "calc(100% + 2px)", minWidth: 240 };
    if (a.right + 2 + w > window.innerWidth - M && a.left - 2 - w > M) {
      next.left = "auto";
      next.right = "calc(100% + 2px)";
    }
    let top = -4;
    const overflow = a.top + top + h - (window.innerHeight - M);
    if (overflow > 0) top -= overflow;
    if (a.top + top < M) top = M - a.top;
    next.top = top;
    setStyle(next);
  }, [item.children.length]);
  return (
    <div ref={ref} className="dropdown" role="menu" style={style}>
      <MenuList {...list} items={item.children} parentLabel={item.label} />
    </div>
  );
}

// ============= Menu bar =============

export interface MenubarProps {
  onOpenPalette: () => void;
  onCommand: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
  toggles?: MenuToggleState;
}

const TITLES = Object.keys(MENUS);
/** Each title's underlined letter (an index into it). */
const MARKS = mnemonics(TITLES);

interface BarState {
  /** The title whose menu is open. */
  open: string | null;
  /** The title highlighted from the keyboard, its menu closed (after Alt or F10). */
  hot: string | null;
  /** The highlighted item in the open menu. */
  path: MenuPath;
}
const IDLE: BarState = { open: null, hot: null, path: [] };

function MenubarDropdown({
  items,
  itemsRef,
  ...list
}: Omit<MenuListProps, "level" | "parentLabel"> & {
  /** Gets the menu's items once its dynamic entries are expanded, for the
   *  menubar's key handler. */
  itemsRef: React.MutableRefObject<MenuItemDef[]>;
}) {
  const expanded = useExpandedItems(items, items);
  useLayoutEffect(() => { itemsRef.current = expanded; }, [expanded, itemsRef]);
  return (
    <div className="dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
      <MenuList {...list} items={expanded} path={fitPath(expanded, list.path)} level={0} />
    </div>
  );
}

export function Menubar({ onOpenPalette, onCommand, onPayload, toggles }: MenubarProps) {
  const [bar, setBarState] = useState<BarState>(IDLE);
  // The key handlers read the state as of the last key, not the last render.
  const barRef = useRef(bar);
  const setBar = (b: BarState) => { barRef.current = b; setBarState(b); };
  const [version, setVersion] = useState<string>("");
  const ref = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<MenuItemDef[]>([]);
  // What had focus before the menubar took it, to give back as it closes.
  const engaged = useRef(false);
  const prevFocus = useRef<HTMLElement | null>(null);
  const ctxValue = toggles ?? {};

  const engage = () => {
    if (!engaged.current) prevFocus.current = focusOwner();
    engaged.current = true;
    ref.current?.focus({ preventScroll: true });
  };
  const leave = () => {
    if (!engaged.current) return;
    engaged.current = false;
    setBar(IDLE);
    giveBackFocus(prevFocus.current, ref.current);
    prevFocus.current = null;
  };
  const openMenu = (k: string, path: MenuPath) => { engage(); setBar({ open: k, hot: null, path }); };
  const highlight = (k: string) => { engage(); setBar({ open: null, hot: k, path: [] }); };
  const neighbour = (k: string, d: number) => TITLES[(TITLES.indexOf(k) + d + TITLES.length) % TITLES.length];
  const openOnFirst = (k: string) => openMenu(k, [firstIndex(MENUS[k])]);
  const run = (it: ItemDef) => {
    // Focus goes back first, so a command that moves it (a field, a dialog) wins.
    leave();
    if (it.payload) onPayload?.(it.payload);
    else onCommand(it.action ?? it.label);
  };

  // For the window listeners below, which are installed once.
  const live = useRef({ leave, highlight, openOnFirst });
  live.current = { leave, highlight, openOnFirst };

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) live.current.leave();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Alt pressed and released alone, or F10, highlights the first title (or
  // leaves the menubar); Alt+letter opens the menu with that underlined
  // letter. In the capture phase, so they work whichever widget has focus.
  useEffect(() => {
    let altAlone = false;
    const free = () =>
      !isModalOpen() && !(document.activeElement as HTMLElement | null)?.closest?.(KEEPS_KEYS);
    const toggle = () => {
      if (engaged.current) live.current.leave();
      else live.current.highlight(TITLES[0]);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        if (!e.repeat) altAlone = !e.ctrlKey && !e.shiftKey && !e.metaKey;
        return;
      }
      altAlone = false;
      if (!free()) return;
      if (e.key === "F10" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        const k = titleForKey(TITLES, MARKS, e);
        if (!k) return;
        e.preventDefault();
        e.stopPropagation();
        live.current.openOnFirst(k);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      if (!free()) return;
      e.preventDefault();
      toggle();
    };
    // Alt with a click, a scroll or a switch to another window isn't a tap.
    const cancel = () => { altAlone = false; };
    const blur = () => { altAlone = false; live.current.leave(); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("wheel", cancel, { capture: true, passive: true });
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("wheel", cancel, { capture: true });
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        // tauri unavailable (e.g. vite dev without tauri host)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = barRef.current;
    if (!s.open && !s.hot) return;
    // The menubar has the keyboard while it's active.
    e.stopPropagation();
    if (e.key === "Tab") { e.preventDefault(); leave(); return; }
    if (s.open) {
      const items = itemsRef.current;
      const r = menuKey(items, fitPath(items, s.path), e);
      if (!r) return;
      e.preventDefault();
      if ("path" in r) setBar({ ...s, path: r.path });
      else if ("run" in r) run(r.run);
      // Esc goes back to the title; a second Esc leaves.
      else if (r.exit === "close") setBar({ open: null, hot: s.open, path: [] });
      else openOnFirst(neighbour(s.open, r.exit === "next" ? 1 : -1));
      return;
    }
    const hot = s.hot!;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight":
        e.preventDefault();
        highlight(neighbour(hot, e.key === "ArrowRight" ? 1 : -1));
        return;
      case "ArrowDown":
      case "Enter":
      case " ":
        e.preventDefault();
        openOnFirst(hot);
        return;
      case "ArrowUp":
        e.preventDefault();
        openMenu(hot, [lastIndex(MENUS[hot])]);
        return;
      case "Escape":
        e.preventDefault();
        leave();
        return;
    }
    const k = !e.ctrlKey && !e.altKey && !e.metaKey ? titleForKey(TITLES, MARKS, e) : undefined;
    if (k) { e.preventDefault(); openOnFirst(k); }
  };

  return (
    <MenuToggleContext.Provider value={ctxValue}>
      <div
        className="menubar"
        ref={ref}
        role="menubar"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // A press here leaves focus where it was, for the menu to give back.
        onMouseDown={(e) => e.preventDefault()}
      >
        {TITLES.map((k, ki) => (
          <div
            key={k}
            className={"menubar-item" + (bar.open === k ? " open" : "") + (bar.hot === k ? " hot" : "")}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={bar.open === k}
            onClick={() => (bar.open === k ? leave() : openMenu(k, []))}
            onMouseEnter={() => {
              if (bar.open && bar.open !== k) openMenu(k, []);
              else if (bar.hot && bar.hot !== k) highlight(k);
            }}
          >
            <span>
              {MARKS[ki] < 0 ? k : (
                <>{k.slice(0, MARKS[ki])}<span className="u">{k[MARKS[ki]]}</span>{k.slice(MARKS[ki] + 1)}</>
              )}
            </span>
            {bar.open === k && (
              <MenubarDropdown
                items={MENUS[k]}
                itemsRef={itemsRef}
                path={bar.path}
                setPath={(path) => setBar({ ...barRef.current, path })}
                onRun={run}
              />
            )}
          </div>
        ))}
        <div className="menubar-right">
          <span onClick={onOpenPalette} style={{cursor:"pointer"}}>
            <span className="kbd">Ctrl</span>&nbsp;<span className="kbd">P</span>&nbsp;palette
          </span>
          {version && <span>· glasshouse v{version}</span>}
        </div>
      </div>
    </MenuToggleContext.Provider>
  );
}

// ============= Context menu =============
export interface ContextMenuProps {
  items: MenuItemDef[];
  x: number;
  y: number;
  /** Opened from the keyboard: the first item starts highlighted. */
  keyboard?: boolean;
  onClose: () => void;
  onCommand?: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
}

export function ContextMenu({ items, x, y, keyboard, onClose, onCommand, onPayload }: ContextMenuProps) {
  const expanded = useExpandedItems(items, items);
  const [path, setPath] = useState<MenuPath>([]);
  // Another right-click while the menu is open starts the new menu over.
  useLayoutEffect(() => { setPath(keyboard ? [firstIndex(items)] : []); }, [items, keyboard]);
  const ref = useRef<HTMLDivElement>(null);
  // A right-click near the bottom/right window edge would push the menu tail
  // outside the webview, where it simply clips (it's DOM, not an OS popup).
  // Measure at natural size pre-paint and shift into view; if the menu is
  // taller than the window, pin it to the top edge and let it scroll.
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const M = 6;
    // Measure at 0,0 so proximity to the right/bottom edge can't shrink the
    // natural size (fixed-position boxes shrink-to-fit against the viewport).
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.maxHeight = "none";
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const fitH = Math.min(h, window.innerHeight - 2 * M);
    const left = Math.max(M, Math.min(x, window.innerWidth - M - w));
    const top = Math.max(M, Math.min(y, window.innerHeight - M - fitH));
    const maxHeight = h > fitH ? fitH : undefined;
    // Write the result straight to the DOM: React's style diff skips values
    // it saw last render, so it would leave the measurement position behind.
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.maxHeight = maxHeight ? `${maxHeight}px` : "";
    el.style.overflowY = maxHeight ? "auto" : "";
    setPos({ left, top, maxHeight });
  }, [x, y, expanded.length]);
  // The menu takes focus for its keys and gives it back when it closes:
  // after the commit that removes it, since React drops the focus events of
  // one, and the pane draws its focused row from its own focus handler.
  const prevFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    prevFocus.current = focusOwner();
    ref.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const el = ref.current;
    return () => giveBackFocus(prevFocus.current, el);
  }, []);
  useEffect(() => {
    const h = () => onClose();
    setTimeout(() => document.addEventListener("mousedown", h, { once: true }), 0);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const run = (it: ItemDef) => {
    if (it.payload) onPayload?.(it.payload);
    else onCommand?.(it.action ?? it.label);
    onClose();
  };
  const live = fitPath(expanded, path);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // The menu has the keyboard while it's open: no key reaches the pane or
    // App's shortcuts behind it.
    e.stopPropagation();
    if (e.key === "Tab") { e.preventDefault(); onClose(); return; }
    const r = menuKey(expanded, live, e);
    if (!r) return;
    e.preventDefault();
    if ("path" in r) setPath(r.path);
    else if ("run" in r) run(r.run);
    else if (r.exit === "close") onClose();
  };

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      tabIndex={-1}
      style={{left: pos.left, top: pos.top, maxHeight: pos.maxHeight, overflowY: pos.maxHeight ? "auto" : undefined}}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      // Stop mousedown so the document-level close listener below doesn't
      // fire → state update → re-render before the click reaches MenuItem.
      // Without this, every ctx-menu item appears to do nothing: the menu
      // closes on mousedown and the click lands on nothing.
      onMouseDown={(e) => e.stopPropagation()}
      // The Menu key's own context menu event can arrive after the menu has
      // taken focus (Windows sends it on key up): it does nothing here.
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <MenuList items={expanded} path={live} level={0} setPath={setPath} onRun={run} />
    </div>
  );
}
