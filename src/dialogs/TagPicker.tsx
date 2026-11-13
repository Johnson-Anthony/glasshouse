import { useState, useEffect, useRef, useMemo } from "react";
import { SEED_TAGS, TAG_COLOR_MAP } from "../Sidebar";
import { getTags, setTags, useTags, useTagsLoaded } from "../tags";
import { useEscapeClose } from "./useEscapeClose";
import { useModal } from "./modal";

// ============= TagPickerDialog =============
export interface TagPickerDialogProps {
  path: string;
  onClose: () => void;
  /** Called once the path's tags are in the store (which writes the file). */
  onSaved: () => void;
}

export function TagPickerDialog({ path, onClose, onSaved }: TagPickerDialogProps) {
  const store = useTags();
  const loaded = useTagsLoaded();
  // This path's labels as edited here, from the store; null until it has
  // loaded. Save writes only this path's entry, so a change the app made to
  // other paths meanwhile (a move, a prune) stands.
  const [draft, setDraft] = useState<string[] | null>(() => (loaded ? getTags()[path] ?? [] : null));
  const [newTag, setNewTag] = useState("");
  const newTagRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loaded) setDraft(d => d ?? getTags()[path] ?? []);
  }, [loaded, path]);

  useEscapeClose(onClose);
  useModal();

  const current = useMemo(() => draft ?? [], [draft]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of SEED_TAGS) set.add(s.label);
    for (const tags of Object.values(store)) for (const t of tags) set.add(t);
    return Array.from(set);
  }, [store]);

  const hasTag = (t: string) => current.includes(t);

  const toggleTag = (t: string) => {
    setDraft(prev => {
      const cur = prev ?? [];
      return cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
    });
  };

  const addNewTag = () => {
    const t = newTag.trim();
    if (!t) return;
    setDraft(prev => {
      const cur = prev ?? [];
      return cur.includes(t) ? cur : [...cur, t];
    });
    setNewTag("");
    newTagRef.current?.focus();
  };

  const save = () => {
    if (!draft) return;
    setTags(prev => {
      const next = { ...prev };
      if (draft.length === 0) delete next[path];
      else next[path] = draft;
      return next;
    });
    onSaved();
  };

  const shownTags = useMemo(() => {
    const seedLabels = SEED_TAGS.map(s => s.label);
    const seedSet = new Set(seedLabels);
    const rest = new Set<string>();
    for (const t of allTags) if (!seedSet.has(t)) rest.add(t);
    for (const t of current) if (!seedSet.has(t)) rest.add(t);
    return [...seedLabels, ...Array.from(rest).sort()];
  }, [allTags, current]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "48ch", maxWidth: "95vw", maxHeight: "80vh",
        background: "var(--bg-1, #1a1b26)", border: "1px solid var(--fg-3)",
        borderRadius: 4, display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)", color: "var(--fg-1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--fg-3)",
          background: "var(--bg-2, #16161e)",
        }}>
          <span style={{ color: "var(--accent)" }}># tag picker</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "2px 8px", cursor: "pointer", borderRadius: 2,
          }}>×</button>
        </div>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--fg-3)", fontSize: 11, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {path}
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {!loaded && <div style={{ color: "var(--fg-3)" }}>loading…</div>}
          {loaded && shownTags.length === 0 && (
            <div style={{ color: "var(--fg-3)" }}>no tags yet — add one below</div>
          )}
          {shownTags.map(t => {
            const color = TAG_COLOR_MAP[t] ?? "var(--fg-2)";
            return (
              <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 0" }}>
                <input type="checkbox" checked={hasTag(t)} onChange={() => toggleTag(t)} />
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color }} />
                <span style={{ color: hasTag(t) ? "var(--fg-1)" : "var(--fg-2, var(--fg-1))" }}>{t}</span>
              </label>
            );
          })}
        </div>
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--fg-3)", display: "flex", gap: 6 }}>
          <input
            ref={newTagRef}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="add new tag…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewTag(); } }}
            style={{
              flex: 1,
              background: "var(--bg-0, #0f0f14)", color: "var(--fg-1)",
              border: "1px solid var(--fg-3)", borderRadius: 2,
              padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 13,
              outline: "none",
            }}
          />
          <button
            onClick={addNewTag}
            disabled={!newTag.trim()}
            style={{
              background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
              padding: "4px 10px", cursor: newTag.trim() ? "pointer" : "not-allowed",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >+</button>
        </div>
        <div style={{
          padding: "8px 12px", borderTop: "1px solid var(--fg-3)",
          display: "flex", justifyContent: "flex-end", gap: 6,
          background: "var(--bg-2, #16161e)",
        }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
            padding: "4px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "inherit",
          }}>cancel</button>
          <button
            onClick={save}
            disabled={!draft}
            style={{
              background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--bg-0)",
              padding: "4px 12px", cursor: draft ? "pointer" : "wait",
              borderRadius: 2, fontFamily: "inherit",
            }}
          >save</button>
        </div>
      </div>
    </div>
  );
}
