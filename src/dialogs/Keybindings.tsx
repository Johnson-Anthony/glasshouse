import { useMemo } from "react";
import { MENUS, type MenuItemDef } from "../data";
import { CHEATSHEET } from "../keymap";
import { useEscapeClose } from "./useEscapeClose";

// ============= KeybindingsDialog =============
// Read-only reference for every keybind the app exposes. Grouped by category,
// scrollable, Esc / click-outside closes. Sourced from MENUS + hardcoded
// global shortcuts the App.tsx keydown listener owns (F2 rename, Alt+Arrow
// history, Ctrl+Tab etc.) that live outside the declarative menu tree.
export interface KeybindingsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface KbEntry {
  label: string;
  keys: string;
  group: string;
}

function collectMenuBinds(): KbEntry[] {
  const out: KbEntry[] = [];
  const walk = (items: MenuItemDef[], group: string): void => {
    for (const it of items) {
      if (it.kind === "item" && it.kb) {
        out.push({ label: it.label, keys: it.kb, group });
      } else if (it.kind === "sub") {
        walk(it.children, group);
      }
    }
  };
  for (const [group, items] of Object.entries(MENUS)) {
    walk(items, group);
  }
  return out;
}

export function KeybindingsDialog({ open, onClose }: KeybindingsDialogProps) {
  useEscapeClose(onClose, open);

  const binds = useMemo(() => {
    const all = [...collectMenuBinds(), ...CHEATSHEET];
    const byGroup = new Map<string, KbEntry[]>();
    for (const b of all) {
      const arr = byGroup.get(b.group) ?? [];
      arr.push(b);
      byGroup.set(b.group, arr);
    }
    for (const arr of byGroup.values()) {
      arr.sort((a, b) => a.label.localeCompare(b.label));
    }
    return Array.from(byGroup.entries());
  }, []);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "72ch", maxWidth: "95vw", maxHeight: "85vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}>⌨ keybindings</span>
          <span style={{ color: "var(--fg-3)", fontSize: 12 }}>esc / click to close</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }} aria-label="close">×</button>
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "4px 0", fontSize: 13 }}>
          {binds.map(([group, entries]) => (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{
                padding: "6px 16px 4px", color: "var(--fg-3)", fontSize: 11,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>{group}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {entries.map((b, i) => (
                    <tr key={i}>
                      <td style={{
                        padding: "2px 16px", color: "var(--fg-1)",
                        whiteSpace: "nowrap", width: "50%",
                      }}>{b.label}</td>
                      <td style={{
                        padding: "2px 16px", color: "var(--accent, var(--cyan))",
                        whiteSpace: "nowrap", textAlign: "right",
                      }}>{b.keys}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
