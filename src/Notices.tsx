// Third-party notices view (Help → Third-party Notices, or "notices" in
// About): the license texts that ship with the app, as plain text. Links in
// them that point at another bundled notice are clickable, so LICENSES.md
// works as the index. Mounted once as <NoticesHost />; open it with
// openNotices().
import { useEffect, useMemo, useState } from "react";
import { groupByFolder, linkSegments, NOTICES_INDEX, type Notice } from "./notices";

let openRef: (() => void) | null = null;

/** Show the notices view. Does nothing before <NoticesHost /> mounts. */
export function openNotices(): void {
  openRef?.();
}

const button: React.CSSProperties = {
  background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
  padding: "2px 8px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
};

export function NoticesHost() {
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    // Each open starts at the index.
    openRef = () => { setCurrent(NOTICES_INDEX); setOpen(true); };
    return () => { openRef = null; };
  }, []);

  useEffect(() => {
    if (!open || notices) return;
    import("./noticesData").then(
      (m) => setNotices(m.NOTICES),
      (err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)),
    );
  }, [open, notices]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  const known = useMemo(() => new Set(notices?.map((n) => n.path)), [notices]);
  const groups = useMemo(() => groupByFolder(notices ?? []), [notices]);
  const shown = notices?.find((n) => n.path === current) ?? null;

  if (!open) return null;
  const close = () => setOpen(false);

  return (
    <div onClick={close} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div
        role="dialog"
        aria-label="third-party notices"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(120ch, 95vw)", height: "85vh",
          background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
          borderRadius: 4, display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)", color: "var(--fg-1)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>third-party notices</span>
          <button onClick={close} style={button} aria-label="close">×</button>
        </div>
        <div style={{
          flex: 1, minHeight: 0, display: "grid",
          gridTemplateColumns: "minmax(16ch, 30ch) 1fr",
        }}>
          <nav style={{
            overflowY: "auto", borderRight: "1px solid var(--fg-3)",
            padding: "6px 0", fontSize: 12,
          }}>
            {loadError && <div style={{ padding: "4px 10px", color: "var(--red, #f7768e)" }}>{loadError}</div>}
            {!notices && !loadError && <div style={{ padding: "4px 10px", color: "var(--fg-3)" }}>loading…</div>}
            {groups.map((g) => (
              <div key={g.folder} style={{ marginBottom: 6 }}>
                <div style={{ padding: "4px 10px", color: "var(--fg-3)" }}>fonts/{g.folder}</div>
                {g.items.map((n) => (
                  <button
                    key={n.path}
                    onClick={() => setCurrent(n.path)}
                    aria-current={n.path === current ? "page" : undefined}
                    title={n.path}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "3px 10px 3px 18px", border: "none", cursor: "pointer",
                      fontFamily: "inherit", fontSize: "inherit",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      background: n.path === current ? "var(--bg-3, var(--bg-2, #24283b))" : "transparent",
                      color: n.path === current ? "var(--accent)" : "var(--fg-1)",
                    }}
                  >
                    {n.path.slice(g.folder.length)}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {/* Keyed by path so switching notices starts at the top. */}
          <pre key={shown?.path} style={{
            margin: 0, padding: "10px 14px", overflow: "auto",
            whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.5,
          }}>
            {shown && linkSegments(shown.path, shown.text, known).map((s, i) => {
              const target = s.target;
              return target ? (
                <a
                  key={i}
                  href="#"
                  onClick={(e) => { e.preventDefault(); setCurrent(target); }}
                  style={{ color: "var(--accent)" }}
                >{s.text}</a>
              ) : (
                <span key={i}>{s.text}</span>
              );
            })}
          </pre>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "var(--bg-2, #16161e)", fontSize: 12,
        }}>
          <span style={{ color: "var(--fg-3)" }}>{shown ? `fonts/${shown.path}` : ""}</span>
          <button onClick={close} style={{ ...button, padding: "4px 12px" }}>close</button>
        </div>
      </div>
    </div>
  );
}
