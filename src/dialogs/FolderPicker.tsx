import { useState, useEffect, useMemo } from "react";
import { drives as apiDrives, homeDir as apiHomeDir, listDir, type Drive, type FileEntry } from "../api";
import { parentPath, splitBreadcrumb } from "../paths";

// ============= FolderPickerDialog =============
// In-app folder picker modal. Replaces the Tauri native open-directory dialog
// for the "Move to…" flow (task #12). Left column = drives; right column =
// directory tree of the current path; header = breadcrumb + "Up" button.

export interface FolderPickerDialogProps {
  initialPath?: string;
  title?: string;
  onClose: () => void;
  onPick: (path: string) => void;
}

export function FolderPickerDialog({ initialPath, title, onClose, onPick }: FolderPickerDialogProps) {
  const [cwd, setCwd] = useState<string>(initialPath ?? "");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [driveList, setDriveList] = useState<Drive[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setDriveList(await apiDrives());
      if (!initialPath) {
        const h = await apiHomeDir();
        if (h) setCwd(h);
      }
    })();
  }, [initialPath]);

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    void (async () => {
      try {
        const list = await listDir(cwd, false);
        if (cancelled) return;
        setEntries(list.filter(e => e.kind === "folder"));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Enter" && cwd) { e.preventDefault(); onPick(cwd); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onPick, cwd]);

  const up = () => {
    if (!cwd) return;
    const parent = parentPath(cwd);
    if (parent && parent !== cwd) setCwd(parent);
  };

  const crumbs = useMemo(() => splitBreadcrumb(cwd), [cwd]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 280, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "80ch", maxWidth: "95vw", height: "60vh", maxHeight: "80vh",
        background: "var(--bg-2, #16161e)", border: "1px solid var(--accent)",
        borderRadius: 6, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--border, var(--fg-3))",
          background: "var(--bg-1, #1a1b26)",
        }}>
          <span style={{ color: "var(--accent)" }}>▸ {title ?? "pick folder"}</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>

        <div style={{
          padding: "6px 12px", borderBottom: "1px solid var(--border, var(--fg-3))",
          display: "flex", alignItems: "center", gap: 6, fontSize: 11, minHeight: 26,
        }}>
          <button
            onClick={up}
            disabled={!cwd}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)",
              color: cwd ? "var(--fg-1)" : "var(--fg-3)",
              padding: "2px 8px", cursor: cwd ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >↑ up</button>
          <div style={{
            flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
            color: "var(--fg-2, var(--fg-1))",
          }}>
            {crumbs.length === 0 ? <span style={{ color: "var(--fg-3)" }}>(select a drive)</span> : crumbs.map((c, i) => (
              <span key={i}>
                <span
                  onClick={() => setCwd(c.path)}
                  style={{ cursor: "pointer", color: i === crumbs.length - 1 ? "var(--fg-0, var(--fg-1))" : "var(--fg-2, var(--fg-1))" }}
                >{c.label}</span>
                {i < crumbs.length - 1 && <span style={{ color: "var(--fg-3)", margin: "0 3px" }}>›</span>}
              </span>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{
            width: "18ch", borderRight: "1px solid var(--border, var(--fg-3))",
            overflow: "auto", padding: "4px 0", fontSize: 12,
          }}>
            <div style={{ padding: "4px 10px", color: "var(--fg-3)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>drives</div>
            {driveList.length === 0 && <div style={{ padding: "4px 10px", color: "var(--fg-3)", fontSize: 11 }}>(none)</div>}
            {driveList.map((d) => {
              // d.letter is already a navigable root ("C:\" on Windows, a
              // mount point like "/" or "/home" on Linux) — use it verbatim.
              // Longest-prefix match keeps "/" from claiming every path.
              const root = d.letter;
              const matches = (r: string) => {
                const base = r.replace(/[\\/]+$/, "");
                if (base === "") return cwd.startsWith("/");
                return cwd === base || cwd.startsWith(base + (r.includes("\\") ? "\\" : "/"));
              };
              const best = driveList
                .map(x => x.letter)
                .filter(matches)
                .sort((a, b) => b.length - a.length)[0];
              const active = matches(root) && root === best;
              return (
                <div
                  key={d.letter}
                  onClick={() => setCwd(root)}
                  style={{
                    padding: "3px 10px",
                    cursor: "pointer",
                    background: active ? "var(--bg-sel, var(--bg-3))" : "transparent",
                    color: active ? "var(--fg-0, var(--fg-1))" : "var(--fg-1)",
                  }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget.style.background = "var(--bg-1, #1a1b26)"); }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget.style.background = "transparent"); }}
                >
                  <span style={{ color: "var(--accent)", marginRight: 4 }}>▪</span>
                  {d.letter} {d.label && <span style={{ color: "var(--fg-3)", fontSize: 10 }}>({d.label})</span>}
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "4px 0", fontSize: 12 }}>
            {busy && <div style={{ padding: "4px 12px", color: "var(--fg-3)" }}>loading…</div>}
            {err && <div style={{ padding: "4px 12px", color: "var(--red, #f7768e)" }}>{err}</div>}
            {!busy && !err && entries.length === 0 && (
              <div style={{ padding: "4px 12px", color: "var(--fg-3)" }}>(no subfolders)</div>
            )}
            {entries.map((e) => (
              <div
                key={e.path}
                onDoubleClick={() => setCwd(e.path)}
                onClick={() => setCwd(e.path)}
                style={{
                  padding: "3px 12px",
                  cursor: "pointer",
                  color: "var(--fg-1)",
                }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-1, #1a1b26)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                title={e.path}
              >
                <span style={{ color: "var(--blue, var(--accent))", marginRight: 6 }}>▸</span>
                {e.name}
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--border, var(--fg-3))",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6,
          background: "var(--bg-1, #1a1b26)",
        }}>
          <div style={{ color: "var(--fg-3)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cwd || "(no path)"}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onClose} style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 14px", cursor: "pointer", borderRadius: 3, fontFamily: "inherit", fontSize: 12,
            }}>cancel</button>
            <button
              onClick={() => cwd && onPick(cwd)}
              disabled={!cwd}
              style={{
                background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--bg-0, #0f0f14)",
                padding: "4px 14px", cursor: cwd ? "pointer" : "not-allowed",
                borderRadius: 3, fontFamily: "inherit", fontSize: 12, opacity: cwd ? 1 : 0.5,
              }}
            >move here</button>
          </div>
        </div>
      </div>
    </div>
  );
}
