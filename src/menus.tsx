import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { MENUS, type MenuItemDef, type DynamicPayload, type DynamicSource } from "./data";
import { gitBranchList, listShellProfiles, readPins, readRecent } from "./api";
import { getVersion } from "@tauri-apps/api/app";
import type { TweakState } from "./components";
import { DISPLAY_MODE_DEFAULT, DISPLAY_MODE_KEY, LAYOUT_DEFAULT, LAYOUT_KEY } from "./handlers/view";

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

// ============= Menu bar + dropdown =============

interface MenuItemProps {
  item: MenuItemDef;
  onAction?: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
  onSubHover?: (sub: MenuItemDef | null) => void;
  subOpen?: boolean;
  parentLabel?: string;
}

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
    case "Sidebar":
      return toggles.sidebarVisible !== undefined ? toggles.sidebarVisible : !!item.check;
    case "Status Bar":
      return toggles.statusBarVisible !== undefined ? toggles.statusBarVisible : !!item.check;
    case "Inspector":
      return toggles.inspectorVisible !== undefined ? toggles.inspectorVisible : !!item.check;
  }
  return !!item.check;
}

function MenuItem({ item, onAction, onPayload, onSubHover, subOpen, parentLabel }: MenuItemProps) {
  const toggles = React.useContext(MenuToggleContext);
  if (item.kind === "sep") return <div className="sep" />;
  if (item.kind === "grouplabel") return <div className="group-label">{item.label}</div>;
  if (item.kind === "dynamic") {
    // Should have been expanded upstream; render an empty sentinel if not.
    return null;
  }
  const isSub = item.kind === "sub";
  const danger = item.kind === "item" && item.danger;
  const check = resolveChecked(item, toggles, parentLabel);
  const ic = item.kind === "item" || item.kind === "sub" ? item.ic : undefined;
  const kb = item.kind === "item" ? item.kb : undefined;
  const payload = item.kind === "item" ? item.payload : undefined;
  return (
    <div
      className={"mi" + (danger ? " danger" : "") + (subOpen ? " hover" : "")}
      onMouseEnter={() => onSubHover && onSubHover(isSub ? item : null)}
      onClick={() => {
        if (isSub) return;
        if (payload && onPayload) onPayload(payload);
        else if (onAction) {
          // `action` field lets a dynamic entry display one label ("main")
          // while dispatching another ("git-branch:main") so branch click
          // handlers can identify the target without parsing cosmetics.
          const dispatch = item.kind === "item" && item.action ? item.action : item.label;
          onAction(dispatch);
        }
      }}
    >
      <span className="ic">{check ? "✓" : ic || ""}</span>
      <span>{item.label}</span>
      <span className="kb">{kb || ""}</span>
      <span className="chev">{isSub ? "›" : ""}</span>
      {isSub && subOpen && (
        <SubDropdown item={item} onAction={onAction} onPayload={onPayload} />
      )}
    </div>
  );
}

/** Dropdown for a submenu — expands any `dynamic` children at open time. */
function SubDropdown({
  item,
  onAction,
  onPayload,
}: {
  item: Extract<MenuItemDef, { kind: "sub" }>;
  onAction?: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
}) {
  const children = useExpandedItems(item.children, item);
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
  }, [children.length]);
  return (
    <div ref={ref} className="dropdown" style={style}>
      {children.map((c, i) => (
        <MenuItem key={i} item={c} onAction={onAction} onPayload={onPayload} parentLabel={item.label} />
      ))}
    </div>
  );
}

export interface MenubarProps {
  onOpenPalette: () => void;
  onCommand: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
  toggles?: MenuToggleState;
}

function MenubarDropdown({
  items,
  subHover,
  setSubHover,
  onAction,
  onPayload,
}: {
  items: MenuItemDef[];
  subHover: MenuItemDef | null;
  setSubHover: (s: MenuItemDef | null) => void;
  onAction: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
}) {
  const expanded = useExpandedItems(items, items);
  return (
    <div className="dropdown" onClick={(e) => e.stopPropagation()}>
      {expanded.map((it, i) => (
        <MenuItem
          key={i}
          item={it}
          subOpen={subHover !== null && "label" in subHover && "label" in it && subHover.label === (it as { label: string }).label}
          onSubHover={(s) => setSubHover(s)}
          onAction={onAction}
          onPayload={onPayload}
        />
      ))}
    </div>
  );
}

export function Menubar({ onOpenPalette, onCommand, onPayload, toggles }: MenubarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [subHover, setSubHover] = useState<MenuItemDef | null>(null);
  const [version, setVersion] = useState<string>("");
  const ref = useRef<HTMLDivElement>(null);
  const ctxValue = toggles ?? {};

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(null); setSubHover(null); }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
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

  const keys = Object.keys(MENUS);
  return (
    <MenuToggleContext.Provider value={ctxValue}>
      <div className="menubar" ref={ref}>
        {keys.map(k => (
          <div
            key={k}
            className={"menubar-item" + (open === k ? " open" : "")}
            onClick={() => setOpen(open === k ? null : k)}
            onMouseEnter={() => open && setOpen(k)}
          >
            <span><span className="u">{k[0]}</span>{k.slice(1)}</span>
            {open === k && (
              <MenubarDropdown
                items={MENUS[k]}
                subHover={subHover}
                setSubHover={setSubHover}
                onAction={(label) => { setOpen(null); onCommand(label); }}
                onPayload={(p) => { setOpen(null); onPayload?.(p); }}
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
  onClose: () => void;
  onCommand?: (label: string) => void;
  onPayload?: (payload: DynamicPayload) => void;
}

export function ContextMenu({ items, x, y, onClose, onCommand, onPayload }: ContextMenuProps) {
  const [subHover, setSubHover] = useState<MenuItemDef | null>(null);
  const expanded = useExpandedItems(items, items);
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
  useEffect(() => {
    const h = () => onClose();
    setTimeout(() => document.addEventListener("mousedown", h, { once: true }), 0);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{left: pos.left, top: pos.top, maxHeight: pos.maxHeight, overflowY: pos.maxHeight ? "auto" : undefined}}
      onClick={(e) => e.stopPropagation()}
      // Stop mousedown so the document-level close listener below doesn't
      // fire → state update → re-render before the click reaches MenuItem.
      // Without this, every ctx-menu item appears to do nothing: the menu
      // closes on mousedown and the click lands on nothing.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {expanded.map((it, i) => (
        <MenuItem key={i} item={it}
          subOpen={subHover !== null && "label" in subHover && "label" in it && subHover.label === (it as { label: string }).label}
          onSubHover={(s) => setSubHover(s)}
          onAction={(label) => { if (onCommand) onCommand(label); onClose(); }}
          onPayload={(p) => { onPayload?.(p); onClose(); }}
        />
      ))}
    </div>
  );
}
