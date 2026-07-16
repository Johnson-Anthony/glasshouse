// Miller columns (ranger-style): parent | current | preview. The middle
// column mirrors the active tab's entries and selection; the outer columns
// are fetched on demand and stay read-only apart from navigation clicks.
import { useEffect, useMemo, useRef, useState } from "react";
import { listDir, type FileEntry } from "./api";
import { normalizePath, parentPath } from "./state";

export interface MillerViewProps {
  cwd: string;
  entries: FileEntry[];
  showHidden: boolean;
  focusIndex: number;
  setFocusIndex: (i: number) => void;
  setSelected: (sel: number[]) => void;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
  onActivate?: () => void;
}

interface Indexed {
  e: FileEntry;
  orig: number;
}

function sortView(entries: FileEntry[]): Indexed[] {
  return entries
    .map((e, orig) => ({ e, orig }))
    .sort((a, b) => {
      const af = a.e.kind === "folder" ? 0 : 1;
      const bf = b.e.kind === "folder" ? 0 : 1;
      if (af !== bf) return af - bf;
      const an = a.e.name.toLowerCase();
      const bn = b.e.name.toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
}

function rowIcon(e: FileEntry): string {
  return e.kind === "folder" ? "▸" : "·";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} G`;
}

export function MillerView({
  cwd,
  entries,
  showHidden,
  focusIndex,
  setFocusIndex,
  setSelected,
  onNavigate,
  onOpenFile,
  onActivate,
}: MillerViewProps) {
  const parent = parentPath(cwd);
  const atRoot = normalizePath(parent) === normalizePath(cwd);

  const [parentEntries, setParentEntries] = useState<FileEntry[]>([]);
  const [childEntries, setChildEntries] = useState<FileEntry[] | null>(null);

  const view = useMemo(() => sortView(entries), [entries]);
  const focused: FileEntry | undefined = entries[focusIndex];

  // Parent column follows cwd.
  useEffect(() => {
    let live = true;
    if (atRoot) { setParentEntries([]); return; }
    void listDir(parent, showHidden).then(es => { if (live) setParentEntries(es); });
    return () => { live = false; };
  }, [parent, showHidden, atRoot]);

  // Preview column follows the focused entry.
  useEffect(() => {
    let live = true;
    if (!focused || focused.kind !== "folder") { setChildEntries(null); return; }
    void listDir(focused.path, showHidden).then(es => { if (live) setChildEntries(es); });
    return () => { live = false; };
  }, [focused?.path, focused?.kind, showHidden]);

  const parentView = useMemo(() => sortView(parentEntries), [parentEntries]);
  const childView = useMemo(() => (childEntries ? sortView(childEntries) : null), [childEntries]);

  // Keep the focused middle row visible when focus moves by keyboard.
  const midRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = midRef.current?.querySelector<HTMLElement>(".mrow.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const focusAt = (orig: number) => {
    setFocusIndex(orig);
    setSelected([orig]);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const pos = view.findIndex(v => v.orig === focusIndex);
    if (ev.key === "ArrowDown" || ev.key === "j") {
      ev.preventDefault();
      const next = view[Math.min(pos < 0 ? 0 : pos + 1, view.length - 1)];
      if (next) focusAt(next.orig);
    } else if (ev.key === "ArrowUp" || ev.key === "k") {
      ev.preventDefault();
      const prev = view[Math.max(pos < 0 ? 0 : pos - 1, 0)];
      if (prev) focusAt(prev.orig);
    } else if (ev.key === "ArrowLeft" || ev.key === "h") {
      ev.preventDefault();
      if (!atRoot) onNavigate(parent);
    } else if (ev.key === "ArrowRight" || ev.key === "l" || ev.key === "Enter") {
      ev.preventDefault();
      if (!focused) return;
      if (focused.kind === "folder") onNavigate(focused.path);
      else onOpenFile(focused.path);
    }
  };

  const cwdNorm = normalizePath(cwd);

  return (
    <section className="miller" tabIndex={0} onKeyDown={onKeyDown} onFocus={onActivate}>
      <div className="mcol">
        {atRoot
          ? <div className="mrow dim">{cwd}</div>
          : parentView.map(({ e }) => (
              <div key={e.path}
                   className={"mrow" + (normalizePath(e.path) === cwdNorm ? " hilite" : "") + (e.hidden ? " dim" : "")}
                   onClick={() => { if (e.kind === "folder") onNavigate(e.path); }}>
                <span className="mic">{rowIcon(e)}</span>
                <span className="mname">{e.name}{e.ext && e.kind !== "folder" ? `.${e.ext}` : ""}</span>
              </div>
            ))}
      </div>
      <div className="mcol mid" ref={midRef}>
        {view.map(({ e, orig }) => (
          <div key={e.path}
               className={"mrow" + (orig === focusIndex ? " active" : "") + (e.hidden ? " dim" : "")}
               onClick={() => focusAt(orig)}
               onDoubleClick={() => {
                 if (e.kind === "folder") onNavigate(e.path);
                 else onOpenFile(e.path);
               }}>
            <span className="mic">{rowIcon(e)}</span>
            <span className="mname">{e.name}{e.ext && e.kind !== "folder" ? `.${e.ext}` : ""}</span>
            {e.kind !== "folder" && <span className="msize">{fmtBytes(e.size)}</span>}
          </div>
        ))}
        {view.length === 0 && <div className="mrow dim">empty</div>}
      </div>
      <div className="mcol">
        {focused && focused.kind === "folder" && childView && (
          childView.length > 0
            ? childView.map(({ e }) => (
                <div key={e.path}
                     className={"mrow" + (e.hidden ? " dim" : "")}
                     onClick={() => onNavigate(focused.path)}>
                  <span className="mic">{rowIcon(e)}</span>
                  <span className="mname">{e.name}{e.ext && e.kind !== "folder" ? `.${e.ext}` : ""}</span>
                </div>
              ))
            : <div className="mrow dim">empty</div>
        )}
        {focused && focused.kind !== "folder" && (
          <div className="mpreview">
            <div className="mp-name">{focused.name}{focused.ext ? `.${focused.ext}` : ""}</div>
            <div className="mp-line">kind <span>{focused.kind}</span></div>
            <div className="mp-line">size <span>{fmtBytes(focused.size)}</span></div>
            <div className="mp-line">modified <span>{new Date(focused.modified_ms).toLocaleString()}</span></div>
            {focused.git && <div className="mp-line">git <span>{focused.git}</span></div>}
          </div>
        )}
      </div>
    </section>
  );
}
