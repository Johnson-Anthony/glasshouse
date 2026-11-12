// Third-party notices view (Help → Third-party Notices, or "notices" in
// About): the license texts that ship with the app, as plain text. That's the
// bundled font files, then the npm packages and Rust crates for this platform.
// Links in the font files that point at another one are clickable, so
// LICENSES.md works as the index. Mounted once as <NoticesHost />; open it
// with openNotices().
import { useCallback, useEffect, useMemo, useState } from "react";
import { groupNotices, linkSegments, NOTICES_INDEX, type Notice } from "./notices";
import { errText } from "./errors";
import { useEscapeClose } from "./dialogs/useEscapeClose";
import { useModal } from "./dialogs/modal";

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
  const [filter, setFilter] = useState("");

  useEffect(() => {
    // Each open starts at the index, unfiltered.
    openRef = () => { setCurrent(NOTICES_INDEX); setFilter(""); setOpen(true); };
    return () => { openRef = null; };
  }, []);

  useEffect(() => {
    if (!open || notices) return;
    import("./noticesData").then(
      (m) => setNotices(m.NOTICES),
      (err: unknown) => setLoadError(errText(err)),
    );
  }, [open, notices]);

  const close = useCallback(() => setOpen(false), []);
  useEscapeClose(close, open);
  useModal(open);

  const known = useMemo(() => new Set(notices?.filter((n) => n.links).map((n) => n.path)), [notices]);
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matching = (notices ?? []).filter((n) => !q || (n.group + n.label).toLowerCase().includes(q));
    return groupNotices(matching);
  }, [notices, filter]);
  const shown = notices?.find((n) => n.path === current) ?? null;

  if (!open) return null;

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
            padding: "0 0 6px", fontSize: 12,
          }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter…"
              aria-label="filter notices"
              style={{
                position: "sticky", top: 0, display: "block", width: "100%", boxSizing: "border-box",
                padding: "6px 10px", border: "none", borderBottom: "1px solid var(--fg-3)",
                background: "var(--bg-2, #16161e)", color: "var(--fg-1)",
                fontFamily: "inherit", fontSize: "inherit", outline: "none",
              }}
            />
            {loadError && <div style={{ padding: "4px 10px", color: "var(--red, #f7768e)" }}>{loadError}</div>}
            {!notices && !loadError && <div style={{ padding: "4px 10px", color: "var(--fg-3)" }}>loading…</div>}
            {groups.map((g) => (
              <div key={g.group} style={{ marginTop: 6 }}>
                <div style={{ padding: "4px 10px", color: "var(--fg-3)" }}>{g.group}</div>
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
                    {n.label}
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
            {shown && (shown.links ? linkSegments(shown.path, shown.text, known) : [{ text: shown.text }]).map((s, i) => {
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
          <span style={{ color: "var(--fg-3)" }}>{shown ? shown.group + shown.label : ""}</span>
          <button onClick={close} style={{ ...button, padding: "4px 12px" }}>close</button>
        </div>
      </div>
    </div>
  );
}
