import { useEffect, useMemo, useState } from "react";
import { TAURI_AVAILABLE, pickSavePath, writeText } from "../api";
import { normalizeHex } from "../contrast";
import { errText } from "../errors";
import { writeText as writeClipboardText } from "../clipboard";
import { THEME_TOKENS, TOKEN_HELP, type ThemeScheme, type ThemeToken } from "../themes";
import {
  contrastReport, exportFileName, exportTheme, newThemeId, saveUserTheme, setDraft, type UserTheme,
} from "../userThemes";

// ============= ThemeEditor =============
// Preferences → Appearance → theme → customize. Edits a copy of a theme's
// color tokens; the app shows the draft live (userThemes' draft) until it's
// saved as a custom theme or the editor closes. Warns, without refusing,
// where a color pair falls under WCAG AA.

/** Saves a theme as a file (a Save dialog in the app; the clipboard in a
 *  browser). Returns what happened, or null if cancelled; throws on error. */
export async function exportThemeFile(t: Pick<UserTheme, "name" | "scheme" | "colors">): Promise<string | null> {
  const json = exportTheme(t);
  if (TAURI_AVAILABLE) {
    const path = await pickSavePath({
      title: "Export theme",
      defaultPath: exportFileName(t.name),
      filters: [{ name: "glasshouse theme", extensions: ["json"] }],
    });
    if (!path) return null;
    await writeText(path, json);
    return `saved ${path}`;
  }
  await writeClipboardText(json);
  return "copied the theme file's text to the clipboard";
}

export interface ThemeEditorProps {
  /** What to start from: a custom theme to edit (keeps its id), or a
   *  theme's colors to copy (`id` empty). */
  start: UserTheme;
  /** Saved (the theme's id) or cancelled (null). */
  onDone: (savedId: string | null) => void;
}

export function ThemeEditor({ start, onDone }: ThemeEditorProps) {
  const [name, setName] = useState(start.name);
  const [scheme, setScheme] = useState<ThemeScheme>(start.scheme);
  const [colors, setColors] = useState<Record<ThemeToken, string>>(start.colors);
  // What's typed in each hex field, which may be half a color for a while.
  const [typed, setTyped] = useState<Partial<Record<ThemeToken, string>>>({});
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const draft: UserTheme = useMemo(
    () => ({ id: start.id, name: name.trim() || "untitled", scheme, colors }),
    [start.id, name, scheme, colors],
  );
  useEffect(() => { setDraft(draft); }, [draft]);
  useEffect(() => () => setDraft(null), []);

  const report = useMemo(() => contrastReport(colors), [colors]);
  const fails = report.filter(r => !r.ok);

  const setColor = (k: ThemeToken, v: string) => {
    setTyped(t => ({ ...t, [k]: v }));
    const hex = normalizeHex(v);
    if (hex) setColors(c => ({ ...c, [k]: hex }));
  };

  const save = (asNew: boolean) => {
    const id = !asNew && start.id ? start.id : newThemeId(draft.name);
    try {
      saveUserTheme({ ...draft, id });
      onDone(id);
    } catch (err) {
      setMessage({ text: errText(err), error: true });
    }
  };

  const doExport = async () => {
    try {
      const done = await exportThemeFile(draft);
      if (done) setMessage({ text: done });
    } catch (err) {
      setMessage({ text: errText(err), error: true });
    }
  };

  return (
    <div className="theme-editor" role="group" aria-label="theme editor">
      <div className="te-head">
        <label className="te-name">
          <span>name</span>
          <input
            type="text"
            value={name}
            maxLength={60}
            spellCheck={false}
            onChange={e => setName(e.target.value)}
          />
        </label>
        <div className="segmented" role="group" aria-label="theme scheme">
          {(["light", "dark"] as const).map(s => (
            <button key={s} type="button" className={s === scheme ? "active" : ""} aria-pressed={s === scheme} onClick={() => setScheme(s)}>{s}</button>
          ))}
        </div>
      </div>
      <p className="prefs-note">The app shows your changes as you make them. {scheme === "dark" ? "Dark" : "Light"} sets the window and system controls to match.</p>
      <div className="te-grid">
        {THEME_TOKENS.map(k => (
          <label key={k} className="te-token">
            <span className="te-swatch" style={{ background: colors[k] }}>
              <input type="color" value={colors[k]} aria-label={`--${k} color`} onChange={e => setColor(k, e.target.value)} />
            </span>
            <span className="te-label">
              <code>--{k}</code>
              <span className="prefs-hint">{TOKEN_HELP[k]}</span>
            </span>
            <input
              type="text"
              className={"te-hex" + (typed[k] !== undefined && !normalizeHex(typed[k]!) ? " bad" : "")}
              value={typed[k] ?? colors[k]}
              aria-label={`--${k} hex`}
              spellCheck={false}
              maxLength={9}
              onChange={e => setColor(k, e.target.value)}
              onBlur={() => setTyped(t => { const n = { ...t }; delete n[k]; return n; })}
            />
          </label>
        ))}
      </div>
      <div className={"te-contrast" + (fails.length ? " warn" : " ok")} role="status">
        {fails.length === 0
          ? <p>✓ Every pair passes the contrast checks (WCAG AA: 4.5:1 for text, 3:1 for icons and muted text).</p>
          : <>
              <p>⚠ {fails.length} {fails.length === 1 ? "pair is" : "pairs are"} under WCAG AA and may be hard to read:</p>
              <ul>
                {fails.map(f => (
                  <li key={f.fg + f.bg}>
                    <span className="te-pair" style={{ background: colors[f.bg], color: colors[f.fg] }}>Aa</span>
                    {f.what} (--{f.fg} on --{f.bg}): {f.ratio.toFixed(2)}:1, needs {f.min}:1
                  </li>
                ))}
              </ul>
            </>}
      </div>
      {message && <p className={"prefs-note" + (message.error ? " error" : "")} role={message.error ? "alert" : "status"}>{message.text}</p>}
      <div className="te-actions">
        <button type="button" className="primary" onClick={() => save(false)}>{start.id ? "save" : "save theme"}</button>
        {start.id && <button type="button" onClick={() => save(true)}>save as new</button>}
        <button type="button" onClick={() => void doExport()}>export…</button>
        <button type="button" onClick={() => onDone(null)}>cancel</button>
      </div>
    </div>
  );
}
