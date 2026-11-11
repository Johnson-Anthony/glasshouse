import React, { useState, useEffect, useRef, useMemo } from "react";
import { joinPath, parentPath } from "../paths";
import { checkRenames, orderRenames } from "../names";
import { IS_WINDOWS } from "../platform";
import { errText } from "../errors";
import { useEscapeClose } from "./useEscapeClose";
import { useModal } from "./modal";

// ============= Bulk rename dialog =============

export interface BulkRenameItem {
  /** Absolute source path. */
  path: string;
  /** Filename (with extension) — what gets transformed. */
  name: string;
}

export interface BulkRenamePlan {
  path: string;
  from: string;
  to: string;
}

export interface BulkRenameDialogProps {
  items: BulkRenameItem[];
  onClose: () => void;
  /** Called once per file, sequentially, to perform the rename server-side. */
  renameOne: (from: string, to: string) => Promise<void>;
  /** Every name in a folder, hidden ones included; rejects if unreadable. */
  listNames: (dir: string) => Promise<string[]>;
  /** Called after all renames complete (or threw) so parent can refresh. */
  onDone: () => void;
}

export type CaseMode = "none" | "lower" | "upper" | "title";

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Split filename into (base, ext). Dotfiles (e.g. ".gitignore") have no ext. */
function splitName(name: string): { base: string; ext: string } {
  if (name.startsWith(".")) {
    // Keep leading-dot files whole. If they have a second dot, take that.
    const idx = name.indexOf(".", 1);
    if (idx < 0) return { base: name, ext: "" };
    return { base: name.slice(0, idx), ext: name.slice(idx) };
  }
  const i = name.lastIndexOf(".");
  if (i <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

function parseFind(raw: string): { re: RegExp | null; literal: string } {
  const m = /^\/(.*)\/([gimsuy]*)$/.exec(raw);
  if (m) {
    try {
      // Always global so replace hits every occurrence.
      const flags = m[2].includes("g") ? m[2] : m[2] + "g";
      return { re: new RegExp(m[1], flags), literal: "" };
    } catch {
      return { re: null, literal: raw };
    }
  }
  return { re: null, literal: raw };
}

function applyCase(s: string, mode: CaseMode): string {
  switch (mode) {
    case "lower": return s.toLowerCase();
    case "upper": return s.toUpperCase();
    case "title": return titleCase(s);
    default: return s;
  }
}

function formatNumber(n: number, digits: number): string {
  const s = String(n);
  if (s.length >= digits) return s;
  return "0".repeat(digits - s.length) + s;
}

/** Substitute {n} / {n:W} tokens with the row's sequence index, zero-padded
 *  to `defaultDigits`, or to W when the token gives one. */
function expandNumbering(s: string, seq: number, defaultDigits: number): string {
  return s.replace(/\{n(?::(\d+))?\}/g, (_m, d: string | undefined) => {
    const digits = d ? Math.max(1, parseInt(d, 10)) : defaultDigits;
    return formatNumber(seq, digits);
  });
}

export interface BulkRenameOptions {
  find: string;
  replace: string;
  prefix: string;
  suffix: string;
  numberEnabled: boolean;
  numberStart: number;
  /** Width `{n}` is padded to; `{n:W}` overrides it. */
  numberDigits: number;
  caseMode: CaseMode;
}

/** The dialog's preview: each item's new name under `opts`. */
export function bulkRenamePreview(items: BulkRenameItem[], opts: BulkRenameOptions): BulkRenamePlan[] {
  const { find, replace, prefix, suffix, numberEnabled, numberStart, numberDigits, caseMode } = opts;
  const { re, literal } = parseFind(find);
  return items.map((it, idx) => {
    const { base, ext } = splitName(it.name);
    let next = base;
    // 1. find / replace
    if (re) {
      try { next = next.replace(re, replace); } catch { /* bad regex */ }
    } else if (literal) {
      // Global literal replace — split/join.
      next = next.split(literal).join(replace);
    }
    // 2. numbering token substitution in prefix/suffix/replace
    const seq = numberEnabled ? numberStart + idx : 0;
    if (numberEnabled) next = expandNumbering(next, seq, numberDigits);
    const pfx = numberEnabled ? expandNumbering(prefix, seq, numberDigits) : prefix;
    const sfx = numberEnabled ? expandNumbering(suffix, seq, numberDigits) : suffix;
    // 3. prefix / suffix
    next = pfx + next + sfx;
    // 4. case transform (ext preserved verbatim)
    next = applyCase(next, caseMode);
    const finalName = next + ext;
    return { path: it.path, from: it.name, to: finalName };
  });
}

export function BulkRenameDialog({ items, onClose, renameOne, listNames, onDone }: BulkRenameDialogProps) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [numberEnabled, setNumberEnabled] = useState(false);
  const [numberStart, setNumberStart] = useState(1);
  const [numberDigits, setNumberDigits] = useState(3);
  const [caseMode, setCaseMode] = useState<CaseMode>("none");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  // What's already in each affected folder, so the preview can flag names
  // that would replace something outside the batch.
  const dirs = useMemo(() => [...new Set(items.map(it => parentPath(it.path)))], [items]);
  const [listings, setListings] = useState<Map<string, string[]> | null>(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(dirs.map(async d => [d, await listNames(d)] as const))
      .then(entries => { if (!cancelled) setListings(new Map(entries)); })
      .catch(e => { if (!cancelled) setErr(`can't read the folder: ${errText(e)}`); });
    return () => { cancelled = true; };
  }, [dirs, listNames]);

  useEscapeClose(onClose, !running);
  useModal();

  const preview = useMemo(
    () => bulkRenamePreview(items, { find, replace, prefix, suffix, numberEnabled, numberStart, numberDigits, caseMode }),
    [items, find, replace, prefix, suffix, numberEnabled, numberStart, numberDigits, caseMode],
  );

  // Problems by row: an invalid or duplicate name, or one already used by
  // something outside the batch.
  const { problems, changedCount } = useMemo(() => {
    const found = new Map<number, string>();
    for (const dir of dirs) {
      const rows = preview.map((_, i) => i).filter(i => parentPath(preview[i].path) === dir);
      const names = listings?.get(dir) ?? [];
      checkRenames(rows.map(i => preview[i]), names, IS_WINDOWS)
        .forEach((p, j) => { if (p) found.set(rows[j], p); });
    }
    let changed = 0;
    for (const p of preview) if (p.to !== p.from) changed++;
    return { problems: found, changedCount: changed };
  }, [preview, dirs, listings]);

  const hasCollision = problems.size > 0;
  const canRun = !running && listings !== null && !hasCollision && changedCount > 0;

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    setErr(null);
    // Re-read each folder (the dialog may have been open a while) and order
    // the renames so none lands on a name that's still in use.
    const steps: Array<{ dir: string; from: string; to: string }> = [];
    try {
      for (const dir of dirs) {
        const moves = preview.filter(p => p.to !== p.from && parentPath(p.path) === dir);
        if (moves.length === 0) continue;
        const names = await listNames(dir);
        const problem = checkRenames(moves, names, IS_WINDOWS).find(p => p !== null);
        if (problem) throw new Error(problem);
        for (const s of orderRenames(moves, names, IS_WINDOWS)) steps.push({ dir, ...s });
      }
    } catch (e) {
      setErr(errText(e));
      setRunning(false);
      return;
    }
    setProgress({ done: 0, total: steps.length });
    const done: typeof steps = [];
    try {
      for (const s of steps) {
        await renameOne(joinPath(s.dir, s.from), joinPath(s.dir, s.to));
        done.push(s);
        setProgress({ done: done.length, total: steps.length });
      }
      onDone();
      onClose();
    } catch (e) {
      const msg = errText(e);
      // Put back what already ran, newest first, so nothing is left half
      // renamed or under a temporary name.
      let undone = true;
      for (const s of [...done].reverse()) {
        try { await renameOne(joinPath(s.dir, s.to), joinPath(s.dir, s.from)); }
        catch { undone = false; }
      }
      setErr(done.length === 0 ? msg
        : undone ? `${msg} (the renames before it were put back)`
          : `${msg} (some earlier renames couldn't be put back; check the folder)`);
      onDone();
    } finally {
      setRunning(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
    border: "1px solid var(--fg-3)", borderRadius: 2,
    padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 13,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: "var(--fg-3)", marginBottom: 2,
  };

  return (
    <div
      onClick={() => { if (!running) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90ch", maxWidth: "95vw", maxHeight: "90vh",
          background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
          borderRadius: 4, display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
            background: "var(--bg-2, #16161e)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>✎ bulk rename · {items.length} file{items.length === 1 ? "" : "s"}</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>
            {running
              ? `renaming ${progress?.done ?? 0}/${progress?.total ?? 0}…`
              : hasCollision
                ? `${problems.size} problem${problems.size === 1 ? "" : "s"}`
                : `${changedCount} change${changedCount === 1 ? "" : "s"}`}
          </span>
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "2px 8px", cursor: running ? "not-allowed" : "pointer", borderRadius: 2,
            }}
          >×</button>
        </div>

        <div style={{
          padding: "10px 12px", borderBottom: "1px solid var(--fg-3)",
          display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 12, rowGap: 8,
        }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>find (use /regex/ for regex)</span>
            <input
              ref={firstInputRef}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="text or /pattern/i"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>replace ($1 for regex groups)</span>
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="replacement"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>prefix</span>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="prepend… ({n} = number)"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>suffix</span>
            <input
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="append… ({n} = number)"
              style={inputStyle}
              disabled={running}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={numberEnabled}
                onChange={(e) => setNumberEnabled(e.target.checked)}
                disabled={running}
              />
              numbering
            </label>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>start</span>
            <input
              type="number"
              value={numberStart}
              onChange={(e) => setNumberStart(parseInt(e.target.value, 10) || 0)}
              style={{ ...inputStyle, width: "7ch" }}
              disabled={running || !numberEnabled}
            />
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>digits</span>
            <input
              type="number"
              min={1}
              max={9}
              value={numberDigits}
              onChange={(e) => setNumberDigits(Math.min(9, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              style={{ ...inputStyle, width: "5ch" }}
              disabled={running || !numberEnabled}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>case</span>
            <div className="segmented" style={{ display: "flex" }}>
              {(["none", "lower", "upper", "title"] as CaseMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setCaseMode(m)}
                  disabled={running}
                  style={{
                    background: caseMode === m ? "var(--accent)" : "transparent",
                    color: caseMode === m ? "var(--bg-0, #0f0f14)" : "var(--fg-1)",
                    border: "1px solid var(--fg-3)", padding: "2px 8px",
                    fontSize: 12, cursor: running ? "not-allowed" : "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >{m}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ overflow: "auto", flex: 1, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            padding: "4px 12px", color: "var(--fg-3)",
            borderBottom: "1px solid var(--fg-3)", position: "sticky", top: 0,
            background: "var(--bg-2, #16161e)",
          }}>
            <span>before</span>
            <span>after</span>
          </div>
          {preview.map((p, i) => {
            const problem = problems.get(i);
            const dup = problem !== undefined;
            const unchanged = p.to === p.from;
            return (
              <div key={i} title={problem} style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                padding: "2px 12px",
                background: dup ? "rgba(255,80,80,0.12)" : "transparent",
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.from}
                </span>
                <span style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: dup ? "var(--red, #f7768e)" : unchanged ? "var(--fg-3)" : "var(--green, #9ece6a)",
                }}>
                  {p.to || "(empty)"}
                </span>
              </div>
            );
          })}
        </div>

        {err && (
          <div style={{
            padding: "6px 12px", borderTop: "1px solid var(--fg-3)",
            color: "var(--red, #f7768e)", fontSize: 12,
          }}>
            {err}
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          {hasCollision && (
            <span style={{ color: "var(--red, #f7768e)", fontSize: 12, marginRight: "auto" }}>
              {problems.values().next().value}{problems.size > 1 ? ` (+${problems.size - 1} more)` : ""} — resolve before renaming
            </span>
          )}
          <button
            onClick={onClose}
            disabled={running}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 12px", cursor: running ? "not-allowed" : "pointer",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
            }}
          >cancel</button>
          <button
            onClick={run}
            disabled={!canRun}
            style={{
              background: canRun ? "var(--accent)" : "var(--bg-0, #0f0f14)",
              color: canRun ? "var(--bg-0, #0f0f14)" : "var(--fg-3)",
              border: "1px solid var(--accent)",
              padding: "4px 12px", cursor: canRun ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 12,
              fontWeight: 600,
            }}
          >
            {running
              ? `renaming ${progress?.done ?? 0}/${progress?.total ?? 0}…`
              : `rename ${changedCount} file${changedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
