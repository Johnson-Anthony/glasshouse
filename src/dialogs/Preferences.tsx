import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  TAURI_AVAILABLE, integrationSet, integrationStatus, pickFile, readText,
  type IntegrationDialogs, type IntegrationFeature, type IntegrationKey, type IntegrationStatus,
} from "../api";
import type { TweakState } from "../components";
import { AA_LARGE, contrast, normalizeHex } from "../contrast";
import { errText } from "../errors";
import { KEYMAP, matches } from "../keymap";
import {
  DENSITIES, FONTS, FONT_SIZES, LOOK_DEFAULTS, PRESETS, SIDEBAR_WIDTH,
  applyPreset, customFont, fontFamilyName, fontInstalled, isPreset, pickLook, resolveTheme, themeScheme,
  type Density, type FontOption, type LookState,
} from "../look";
import { IS_WINDOWS } from "../platform";
import { STATUS_DEFAULTS, STATUS_ITEMS, ordered, withItem } from "../statusItems";
import { THEME_LIST, builtinTheme, type ThemeGroup } from "../themes";
import {
  DRAFT_ID, MAX_FILE_BYTES, deleteUserTheme, newThemeId, parseThemeFile, readThemeColors, saveUserTheme,
  userThemeScheme, useUserThemes, type UserTheme,
} from "../userThemes";
import { useOsLook } from "../useLook";
import { stepZoom, ZOOM_DEFAULT, ZOOM_STEPS, zoomLabel } from "../zoom";
import { ThemeEditor, exportThemeFile } from "./ThemeEditor";
import { useEscapeClose } from "./useEscapeClose";
import { useModal } from "./modal";

// ============= PreferencesDialog =============
// Edit → Preferences… (Ctrl+,). Each change applies at once and is saved with
// the other settings (App's TweakState, localStorage["glasshouse.tweaks"]);
// the View menu toggles several of the same ones. Settings are in
// categories, one shown at a time; the filter searches them all. There's no
// native <select> here: WebKitGTK draws a select's open list with GTK, which
// CSS can't theme.

/** The binding that opens Preferences… also closes it (App's keymap is off
 *  while a modal is open). */
const PREFS_KEYS = KEYMAP.filter(b => b.send === "Preferences…");

type Category = "theme" | "text" | "window" | "statusbar" | "list" | "effects" | "files" | "terminal" | "integration";
const CATEGORIES: ReadonlyArray<{ id: Category; label: string; group: string }> = [
  { id: "theme", label: "theme", group: "appearance" },
  { id: "text", label: "text", group: "appearance" },
  { id: "window", label: "window", group: "appearance" },
  { id: "statusbar", label: "status bar", group: "appearance" },
  { id: "list", label: "file list", group: "appearance" },
  { id: "effects", label: "effects", group: "appearance" },
  { id: "files", label: "files", group: "behavior" },
  { id: "terminal", label: "terminal", group: "behavior" },
  { id: "integration", label: "integration", group: "behavior" },
];

type SetState = React.Dispatch<React.SetStateAction<TweakState>>;

export interface PreferencesDialogProps {
  open: boolean;
  state: TweakState;
  setState: SetState;
  onClose: () => void;
}

export function PreferencesDialog({ open, state, setState, onClose }: PreferencesDialogProps) {
  const [query, setQuery] = useState("");
  // Escape clears the filter first.
  useEscapeClose(onClose, open && !query);
  useModal(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [cat, setCat] = useState<Category>("theme");
  const [undo, setUndo] = useState<LookState | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);

  // On open only: App passes a new onClose each render, and a change of
  // setting re-renders it, which mustn't pull focus off the control used.
  // It stays mounted while closed: it opens on the category last used, with
  // no filter or undo left over.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    setQuery("");
    setUndo(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (PREFS_KEYS.some(b => matches(b, e))) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void integrationStatus().then(s => { if (live) setIntegration(s); });
    return () => { live = false; };
  }, [open]);

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  useLayoutEffect(() => {
    setNoMatch(words.length > 0 && !bodyRef.current?.querySelector(".prefs-row"));
  });

  if (!open) return null;

  const set = <K extends keyof TweakState>(key: K) => (value: TweakState[K]) =>
    setState(prev => ({ ...prev, [key]: value }));
  const props = { state, setState, set };
  const filtering = words.length > 0;
  const shows = (c: Category) => filtering || c === cat;
  const cats = CATEGORIES.filter(c => c.id !== "integration" || integration?.supported);

  const resetLook = () => {
    setUndo(pickLook(state));
    setState(prev => ({ ...prev, ...LOOK_DEFAULTS }));
  };
  const undoReset = () => {
    if (undo) setState(prev => ({ ...prev, ...undo }));
    setUndo(null);
  };

  return (
    <div className="prefs-backdrop" onClick={onClose}>
      <div
        className="prefs"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefs-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="prefs-head">
          <span id="prefs-title">⚙ preferences</span>
          <input
            type="search"
            className="prefs-filter"
            placeholder="filter settings"
            aria-label="filter settings"
            spellCheck={false}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}
          />
          <span className="prefs-sub">changes apply at once · esc to close</span>
          <button type="button" className="prefs-x" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="prefs-main">
          <nav className="prefs-nav" aria-label="preference categories">
            {cats.map((c, i) => (
              <React.Fragment key={c.id}>
                {c.group !== cats[i - 1]?.group && <div className="prefs-nav-group">{c.group}</div>}
                <button
                  type="button"
                  className={!filtering && c.id === cat ? "active" : ""}
                  aria-current={!filtering && c.id === cat ? "page" : undefined}
                  onClick={() => { setCat(c.id); setQuery(""); bodyRef.current?.scrollTo?.({ top: 0 }); }}
                >{c.label}</button>
              </React.Fragment>
            ))}
          </nav>
          <div className="prefs-body" ref={bodyRef}>
            <FilterCtx.Provider value={words}>
              {shows("theme") && <ThemeSection {...props} />}
              {shows("text") && <TextSection {...props} />}
              {shows("window") && <WindowSection {...props} />}
              {shows("statusbar") && <StatusBarSection {...props} />}
              {shows("list") && <ListSection {...props} />}
              {shows("effects") && <EffectsSection {...props} />}
              {shows("files") && <FilesSection {...props} />}
              {shows("terminal") && (
                <Section title="terminal">
                  <Row label="follow folder" hint="cd to the active tab's folder">
                    <Choice label="follow folder" value={state.termFollow} options={OFF_ON} onPick={set("termFollow")} />
                  </Row>
                </Section>
              )}
              {shows("integration") && integration?.supported && (
                <IntegrationSection status={integration} setStatus={setIntegration} />
              )}
            </FilterCtx.Provider>
            {noMatch && <p className="prefs-empty">No settings match “{query}”.</p>}
          </div>
        </div>
        <div className="prefs-foot">
          {undo
            ? <>
                <span className="prefs-foot-msg" role="status">Appearance reset to the defaults.</span>
                <button type="button" onClick={undoReset}>undo</button>
              </>
            : <button type="button" onClick={resetLook} title="every setting under appearance; files, terminal and zoom stay">reset appearance</button>}
          <button type="button" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  state: TweakState;
  setState: SetState;
  set: <K extends keyof TweakState>(key: K) => (value: TweakState[K]) => void;
}

const OFF_ON: Array<[boolean, string]> = [[false, "off"], [true, "on"]];
const SHOW_HIDE: Array<[boolean, string]> = [[false, "hide"], [true, "show"]];

// ---- theme ----
const GROUPS: ReadonlyArray<[ThemeGroup | "all" | "yours", string]> = [
  ["all", "all"], ["light", "light"], ["dark", "dark"], ["contrast", "high contrast"], ["retro", "retro"], ["yours", "yours"],
];

/** Accent choices: a theme's own, these, or any hex color. */
const ACCENTS: ReadonlyArray<[string, string]> = [
  ["#2f81f7", "blue"], ["#8b5cf6", "violet"], ["#d946ef", "pink"], ["#e5484d", "red"], ["#f76b15", "orange"],
  ["#e2a336", "amber"], ["#30a46c", "green"], ["#12a594", "teal"], ["#8b8d98", "gray"],
];

function ThemeSection({ state, setState, set }: SectionProps) {
  const os = useOsLook();
  const users = useUserThemes();
  const shown = resolveTheme(state, os, id => isKnown(id, users.themes));
  const system = state.theme === "system";
  const [hover, setHover] = useState<string | null>(null);
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>("all");
  const [editing, setEditing] = useState<UserTheme | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const schemeOf = (id: string) => themeScheme(id, x => userThemeScheme(x));
  const pick = (id: string) => setState(prev =>
    prev.theme === "system"
      ? { ...prev, [schemeOf(id) === "dark" ? "darkTheme" : "lightTheme"]: id }
      : { ...prev, theme: id });
  const isPicked = (id: string) => (system ? id === state.lightTheme || id === state.darkTheme : id === state.theme);
  const setMode = (toSystem: boolean) => setState(prev => {
    if (!toSystem) return { ...prev, theme: shown };
    if (prev.theme === "system") return prev;
    // The fixed theme becomes System's pick for its scheme.
    const slot = schemeOf(prev.theme) === "dark" ? "darkTheme" : "lightTheme";
    return { ...prev, theme: "system", [slot]: prev.theme };
  });

  const cards: Array<{ id: string; label: string }> = [
    ...THEME_LIST.filter(t => group === "all" || t.group === group).map(t => ({ id: t.id, label: t.label })),
    ...(group === "all" || group === "yours" ? users.themes.map(t => ({ id: t.id, label: t.name })) : []),
  ];

  const customize = () => {
    const info = builtinTheme(shown);
    const own = users.themes.find(t => t.id === shown);
    setMessage(null);
    setEditing({
      id: "",
      name: `${own?.name ?? info?.label ?? "my theme"} (custom)`,
      scheme: schemeOf(shown),
      colors: own?.colors ?? readThemeColors(shown),
    });
  };
  const addTheme = (text: string) => {
    const r = parseThemeFile(text);
    if ("error" in r) { setMessage({ text: r.error, error: true }); return false; }
    const id = newThemeId(r.theme.name);
    try {
      saveUserTheme({ ...r.theme, id });
    } catch (err) {
      setMessage({ text: errText(err), error: true });
      return false;
    }
    pick(id);
    setMessage({ text: [`added “${r.theme.name}”`, ...r.warnings].join(" · ") });
    return true;
  };
  const importFile = async () => {
    setMessage(null);
    try {
      const path = await pickFile({ title: "Import a theme", filters: [{ name: "glasshouse theme", extensions: ["json"] }] });
      if (!path) return;
      const text = await readText(path, MAX_FILE_BYTES + 1);
      addTheme(text || "");
    } catch (err) {
      setMessage({ text: errText(err), error: true });
    }
  };
  const exportOne = async (t: UserTheme) => {
    try {
      const done = await exportThemeFile(t);
      if (done) setMessage({ text: done });
    } catch (err) {
      setMessage({ text: errText(err), error: true });
    }
  };

  return (
    <Section title="theme">
      <Row label="presets" hint="a whole look in one click" keys="style look reset standard terminal compact retro">
        <div className="prefs-presets" role="group" aria-label="presets">
          {PRESETS.map(p => {
            const on = isPreset(p.id, state);
            return (
              <button
                key={p.id}
                type="button"
                className={on ? "active" : ""}
                aria-pressed={on}
                title={p.hint}
                onClick={() => setState(prev => ({ ...prev, ...applyPreset(p.id, prev) }))}
              >{p.label}</button>
            );
          })}
        </div>
      </Row>
      <Row label="mode" hint={system ? `now ${os.dark ? "dark" : "light"}${os.contrast ? ", with more contrast" : ""}` : undefined} keys="system light dark automatic os follow">
        <Choice label="theme mode" value={system} options={[[true, "follow system"], [false, "one theme"]]} onPick={setMode} />
        {system && (
          <p className="prefs-note">
            Pick a light theme and a dark one; glasshouse shows the one that matches your system’s setting.
            {os.contrast && " Your system asks for more contrast, so the high contrast themes show."}
          </p>
        )}
      </Row>
      <Row label="themes" hint={system ? "☀ light pick · ☾ dark pick" : undefined} keys="theme color palette colours scheme">
        <div className="prefs-theme-pick">
          {/* Stays in view while the cards scroll under it. */}
          <div className="prefs-theme-top">
            <ThemePreview theme={hover ?? (editing ? DRAFT_ID : shown)} />
            <div className="prefs-groups" role="group" aria-label="theme group">
              {GROUPS.filter(([g]) => g !== "yours" || users.themes.length > 0).map(([g, name]) => (
                <button key={g} type="button" className={g === group ? "active" : ""} aria-pressed={g === group} onClick={() => setGroup(g)}>
                  {name}{g === "yours" ? ` (${users.themes.length})` : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="prefs-themes" role="group" aria-label="theme" onMouseLeave={() => setHover(null)}>
            {cards.map(t => {
              const on = isPicked(t.id);
              const scheme = schemeOf(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  data-theme={t.id}
                  className={"prefs-theme" + (on ? " active" : "") + (t.id === shown ? " shown" : "")}
                  aria-pressed={on}
                  onClick={() => pick(t.id)}
                  onMouseEnter={() => setHover(t.id)}
                  onFocus={() => setHover(t.id)}
                  onBlur={() => setHover(null)}
                >
                  <span className="name">{t.label}</span>
                  <span className="dots" aria-hidden="true">
                    {["--accent", "--accent-2", "--green", "--yellow", "--red"].map(v => (
                      <i key={v} style={{ background: `var(${v})` }} />
                    ))}
                    {system && on && <b className="pick">{scheme === "dark" ? "☾" : "☀"}</b>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Row>
      <Row label="accent" hint="selection edges, focus, active tabs" keys="color colour highlight">
        <AccentPicker accent={state.accent} theme={shown} onPick={set("accent")} />
      </Row>
      <Row label="your themes" hint="make, import and share themes" keys="custom editor import export json create edit">
        {editing
          ? <ThemeEditor start={editing} onDone={id => { setEditing(null); if (id) pick(id); }} />
          : <>
              {users.themes.length > 0 && (
                <ul className="prefs-uthemes">
                  {users.themes.map(t => (
                    <li key={t.id}>
                      <span className="name" data-theme={t.id}><i aria-hidden="true" />{t.name}</span>
                      <button type="button" onClick={() => { setMessage(null); setEditing(t); }}>edit</button>
                      <button type="button" onClick={() => void exportOne(t)}>export…</button>
                      {confirmDelete === t.id
                        ? <button type="button" className="danger" onClick={() => { deleteUserTheme(t.id); setConfirmDelete(null); }}>delete “{t.name}”?</button>
                        : <button type="button" onClick={() => setConfirmDelete(t.id)}>delete</button>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="prefs-actions">
                <button type="button" onClick={customize}>customize the current theme…</button>
                {TAURI_AVAILABLE && <button type="button" onClick={() => void importFile()}>import a file…</button>}
                <button type="button" onClick={() => { setMessage(null); setPaste(paste === null ? "" : null); }}>paste a theme…</button>
              </div>
              {paste !== null && (
                <div className="prefs-paste">
                  <textarea
                    aria-label="theme file text"
                    placeholder='{ "glasshouse-theme": 1, "name": …, "colors": { … } }'
                    spellCheck={false}
                    value={paste}
                    onChange={e => setPaste(e.target.value)}
                  />
                  <button type="button" disabled={!paste.trim()} onClick={() => { if (addTheme(paste)) setPaste(null); }}>add theme</button>
                </div>
              )}
            </>}
        {message && <p className={"prefs-note" + (message.error ? " error" : "")} role={message.error ? "alert" : "status"}>{message.text}</p>}
      </Row>
    </Section>
  );
}

const isKnown = (id: string, themes: readonly UserTheme[]) => !!builtinTheme(id) || themes.some(t => t.id === id);

function AccentPicker({ accent, theme, onPick }: { accent: string; theme: string; onPick: (v: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const bg = useMemo(() => readThemeColors(theme)["bg-0"], [theme]);
  const ratio = accent ? contrast(accent, bg) : null;
  return (
    <div className="prefs-accent-wrap">
      <div className="prefs-accent" role="group" aria-label="accent">
        <button type="button" className={"own" + (accent === "" ? " active" : "")} aria-pressed={accent === ""} onClick={() => onPick("")}>theme’s own</button>
        {ACCENTS.map(([hex, name]) => (
          <button
            key={hex}
            type="button"
            className={accent === hex ? "active" : ""}
            aria-pressed={accent === hex}
            aria-label={name}
            title={name}
            onClick={() => onPick(hex)}
          ><i style={{ background: hex }} /></button>
        ))}
        <input
          type="text"
          className={"prefs-hex" + (typed !== null && !normalizeHex(typed) ? " bad" : "")}
          aria-label="accent hex color"
          placeholder="#rrggbb"
          spellCheck={false}
          maxLength={9}
          value={typed ?? accent}
          onChange={e => {
            setTyped(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex) onPick(hex);
          }}
          onBlur={() => setTyped(null)}
        />
      </div>
      {ratio !== null && ratio < AA_LARGE && (
        <p className="prefs-note warn">Low contrast on this theme’s background ({ratio.toFixed(1)}:1; 3:1 or more is easy to see).</p>
      )}
    </div>
  );
}

/** A small mock of the app in one theme: what a theme card's hover shows. */
function ThemePreview({ theme }: { theme: string }) {
  const rows: Array<[string, string, string, string]> = [
    ["folder", "src", "", ""],
    ["folder", "docs", "", "M"],
    ["ts", "main.ts", "4 KB", "M"],
    ["md", "README.md", "2 KB", ""],
    ["image", "logo.png", "18 KB", "A"],
  ];
  const label = builtinTheme(theme)?.label ?? (theme === DRAFT_ID ? "your draft" : "custom theme");
  return (
    <div className="theme-preview" data-theme={theme} aria-hidden="true">
      <div className="tp-bar"><span className="tp-tab active">{label}</span><span className="tp-tab">home</span></div>
      <div className="tp-main">
        <div className="tp-side">
          <span className="active">⌂ home</span>
          <span>▤ documents</span>
          <span>↓ downloads</span>
        </div>
        <div className="tp-list">
          {rows.map(([ft, name, size, git], i) => (
            <div key={name} className={"tp-row" + (i === 2 ? " sel" : "")} data-ft={ft}>
              <span className="tp-ic">{ft === "folder" ? "▸" : "▢"}</span>
              <span className="tp-name">{name}</span>
              <span className="tp-size">{size}</span>
              <span className={"tp-git g" + git}>{git}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tp-status"><span className="ok">● 5 items</span><span className="warn">2 changed</span><span className="err">1 error</span></div>
    </div>
  );
}

// ---- text ----
function TextSection({ state, setState, set }: SectionProps) {
  const zoomBy = (dir: 1 | -1) => setState(prev => ({ ...prev, zoom: stepZoom(prev.zoom, dir) }));
  const sizeBy = (dir: 1 | -1) => setState(prev => {
    const next = dir > 0 ? FONT_SIZES.find(s => s > prev.fontSize) : [...FONT_SIZES].reverse().find(s => s < prev.fontSize);
    return next === undefined ? prev : { ...prev, fontSize: next };
  });
  return (
    <Section title="text">
      <Row label="interface font" hint="menus, panels and dialogs" keys="typeface family ui">
        <FontPicker label="interface font" value={state.font} options={FONTS} onPick={set("font")} />
      </Row>
      <Row label="file list font" hint="names, sizes and dates" keys="typeface family">
        <FontPicker label="file list font" value={state.listFont} options={FONTS} same="same as interface" onPick={set("listFont")} />
      </Row>
      <Row label="code font" hint="previews and the terminal" keys="monospace typeface family">
        <FontPicker label="code font" value={state.monoFont} options={FONTS.filter(f => f.mono)} mono onPick={set("monoFont")} />
      </Row>
      <Row label="text size" hint="all the app’s text" keys="font size bigger smaller">
        <Stepper
          label="text size"
          value={`${state.fontSize}px`}
          down={{ label: "smaller text", disabled: state.fontSize <= FONT_SIZES[0], run: () => sizeBy(-1) }}
          up={{ label: "larger text", disabled: state.fontSize >= FONT_SIZES[FONT_SIZES.length - 1], run: () => sizeBy(1) }}
          reset={state.fontSize === LOOK_DEFAULTS.fontSize ? undefined : () => set("fontSize")(LOOK_DEFAULTS.fontSize)}
        />
      </Row>
      <Row label="line spacing" keys="line height leading">
        <Choice label="line spacing" value={state.lineHeight} options={[["tight", "tight"], ["normal", "normal"], ["relaxed", "relaxed"], ["loose", "loose"]]} onPick={set("lineHeight")} />
      </Row>
      <Row label="zoom" hint="Ctrl+= · Ctrl+- · Ctrl+0" keys="scale bigger smaller">
        <Stepper
          label="zoom"
          value={zoomLabel(state.zoom)}
          down={{ label: "zoom out", disabled: state.zoom <= ZOOM_STEPS[0], run: () => zoomBy(-1) }}
          up={{ label: "zoom in", disabled: state.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1], run: () => zoomBy(1) }}
          reset={() => set("zoom")(ZOOM_DEFAULT)}
          resetDisabled={state.zoom === ZOOM_DEFAULT}
        />
      </Row>
    </Section>
  );
}

/** Font buttons, each in its own font. One that isn't bundled is offered
 *  only when installed; any other installed family can be typed in. */
function FontPicker({ label, value, options, same, mono = false, onPick }: {
  label: string;
  value: string;
  options: readonly FontOption[];
  /** The label for "" (follow another font), if allowed. */
  same?: string;
  mono?: boolean;
  onPick: (v: string) => void;
}) {
  const installed = useMemo(
    () => new Map(options.filter(o => !o.bundled).map(o => [o.value, fontInstalled(o.family!)])),
    [options],
  );
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const custom = value !== "" && !options.some(o => o.value === value);
  const applyTyped = () => {
    const v = customFont(typed, mono);
    if (!v) { setNote("not a font name"); return; }
    onPick(v);
    setNote(fontInstalled(typed.trim()) ? null : `“${typed.trim()}” wasn’t found; the fallback shows until it’s installed`);
    setTyped("");
  };
  const btn = (v: string, name: string, extra?: { disabled?: boolean; title?: string; font?: string }) => (
    <button
      key={v || "same"}
      type="button"
      className={v === value ? "active" : ""}
      aria-pressed={v === value}
      disabled={extra?.disabled}
      title={extra?.title}
      style={extra?.font ? { fontFamily: extra.font } : undefined}
      onClick={() => { setNote(null); onPick(v); }}
    >{name}</button>
  );
  return (
    <div className="prefs-fonts">
      <div className="prefs-chips" role="group" aria-label={label}>
        {same !== undefined && btn("", same)}
        {options.map(o => {
          const missing = !o.bundled && !installed.get(o.value);
          return btn(o.value, missing ? `${o.label} (not installed)` : o.label, {
            font: o.value,
            disabled: missing && o.value !== value,
            title: missing ? `${o.label} isn’t bundled with glasshouse; install it to use it` : undefined,
          });
        })}
        {custom && btn(value, fontFamilyName(value), { font: value })}
      </div>
      <div className="prefs-inline">
        <input
          type="text"
          aria-label={`${label}: another installed font`}
          placeholder="another installed font…"
          spellCheck={false}
          maxLength={64}
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && typed.trim()) { e.preventDefault(); applyTyped(); } }}
        />
        <button type="button" disabled={!typed.trim()} onClick={applyTyped}>use</button>
      </div>
      {note && <p className="prefs-note warn">{note}</p>}
    </div>
  );
}

// ---- window ----
function WindowSection({ state, set }: SectionProps) {
  const sbBy = (d: number) => set("sidebarWidth")(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, state.sidebarWidth + d * SIDEBAR_WIDTH.step)));
  return (
    <Section title="window">
      <Row label="window buttons" hint={`automatic: ${IS_WINDOWS ? "Windows" : "GNOME"} style here`} keys="title bar controls minimize maximize close traffic lights decorations">
        <Choice
          label="window buttons"
          value={state.windowControls}
          options={[["auto", "automatic"], ["windows", "Windows"], ["gnome", "GNOME"], ["mac", "macOS"], ["hidden", "hidden"]]}
          onPick={set("windowControls")}
        />
        {state.windowControls === "hidden" && <p className="prefs-note">Move, resize and close the window with your system’s keys (Alt+F4, Super+arrows…).</p>}
      </Row>
      <Row label="window edge" hint="the line around the window" keys="frame border outline">
        <Choice label="window edge" value={state.frame} options={[["auto", "automatic"], ["flat", "none"], ["line", "thin line"], ["rounded", "accent outline"]]} onPick={set("frame")} />
      </Row>
      <Row label="corners" keys="radius rounded square">
        <Choice label="corners" value={state.radius} options={[["none", "square"], ["small", "small"], ["medium", "medium"], ["large", "large"]]} onPick={set("radius")} />
      </Row>
      <Row label="borders" hint="lines between panels" keys="lines dividers separators">
        <Choice label="borders" value={state.borders} options={[["none", "none"], ["subtle", "subtle"], ["normal", "normal"], ["strong", "strong"]]} onPick={set("borders")} />
      </Row>
      <Row label="shadows" hint="under menus and dialogs" keys="depth elevation">
        <Choice label="shadows" value={state.shadows} options={[["none", "none"], ["soft", "soft"], ["deep", "deep"]]} onPick={set("shadows")} />
      </Row>
      <Row label="tabs" keys="tab style">
        <Choice label="tabs" value={state.tabStyle} options={[["chrome", "browser"], ["pill", "pills"], ["line", "underlined"], ["minimal", "minimal"]]} onPick={set("tabStyle")} />
      </Row>
      <Row label="toolbar buttons" hint="back, forward, up, refresh" keys="navigation nav">
        <Choice label="toolbar buttons" value={state.navButtons} options={SHOW_HIDE} onPick={set("navButtons")} />
      </Row>
      <Row label="path bar" hint="how the folder path is drawn" keys="breadcrumbs crumbs location address">
        <Choice label="path bar" value={state.breadcrumbs} options={[["slashes", "a / b"], ["chevrons", "a › b"], ["pills", "pills"]]} onPick={set("breadcrumbs")} />
      </Row>
      <Row label="sidebar width" keys="side panel places">
        <Stepper
          label="sidebar width"
          value={`${state.sidebarWidth}px`}
          down={{ label: "narrower sidebar", disabled: state.sidebarWidth <= SIDEBAR_WIDTH.min, run: () => sbBy(-1) }}
          up={{ label: "wider sidebar", disabled: state.sidebarWidth >= SIDEBAR_WIDTH.max, run: () => sbBy(1) }}
          reset={state.sidebarWidth === LOOK_DEFAULTS.sidebarWidth ? undefined : () => set("sidebarWidth")(LOOK_DEFAULTS.sidebarWidth)}
        />
      </Row>
      <Row label="sidebar icons" keys="side panel places size">
        <Choice label="sidebar icons" value={state.sidebarIcons} options={[["small", "small"], ["medium", "medium"], ["large", "large"]]} onPick={set("sidebarIcons")} />
      </Row>
      <Row label="sidebar" hint="Ctrl+B" keys="panel places show hide">
        <Choice label="sidebar" value={state.showSidebar} options={SHOW_HIDE} onPick={set("showSidebar")} />
      </Row>
      <Row label="inspector" hint="the details panel · Ctrl+J" keys="panel details preview show hide">
        <Choice label="inspector" value={state.showInspector} options={SHOW_HIDE} onPick={set("showInspector")} />
      </Row>
    </Section>
  );
}

// ---- status bar ----
const ALL_ITEMS = ordered(STATUS_ITEMS.map(i => i.id));
const sameItems = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function StatusBarSection({ state, set }: SectionProps) {
  const items = state.statusItems;
  const lean = sameItems(items, ordered(STATUS_DEFAULTS));
  const all = sameItems(items, ALL_ITEMS);
  return (
    <Section title="status bar">
      <Row label="status bar" keys="panel bottom show hide">
        <Choice label="status bar" value={state.showStatusBar} options={SHOW_HIDE} onPick={set("showStatusBar")} />
      </Row>
      <Row label="items" hint="lean: items, size and free space" keys="default reset all everything">
        <div className="segmented" role="group" aria-label="status bar items">
          <button type="button" className={lean ? "active" : ""} aria-pressed={lean} onClick={() => set("statusItems")(ordered(STATUS_DEFAULTS))}>lean</button>
          <button type="button" className={all ? "active" : ""} aria-pressed={all} onClick={() => set("statusItems")(ALL_ITEMS)}>everything</button>
        </div>
      </Row>
      {STATUS_ITEMS.map(i => (
        <Row key={i.id} label={i.label} hint={i.hint} keys={i.keys}>
          <Choice label={i.label} value={items.includes(i.id)} options={SHOW_HIDE} onPick={v => set("statusItems")(withItem(items, i.id, v))} />
        </Row>
      ))}
    </Section>
  );
}

// ---- file list ----
const DENSITY_NAMES: Record<Density, string> = { tight: "tight", compact: "compact", default: "default", comfy: "comfy", spacious: "spacious" };

function ListSection({ state, set }: SectionProps) {
  return (
    <Section title="file list">
      <Row label="icons" keys="icon set file type nerd font glyphs">
        <Choice label="icons" value={state.iconSet} options={[["color", "colored"], ["mono", "minimal"], ["nerd", "Nerd Font"], ["glyphs", "text glyphs"]]} onPick={set("iconSet")} />
      </Row>
      <Row label="row height" hint="how much fits on screen" keys="density spacing compact comfortable">
        <Choice<Density> label="row height" value={state.density} options={DENSITIES.map(d => [d, DENSITY_NAMES[d]])} onPick={set("density")} />
      </Row>
      <Row label="striped rows" keys="zebra alternate stripes">
        <Choice label="striped rows" value={state.zebra} options={OFF_ON} onPick={set("zebra")} />
      </Row>
      <Row label="grid lines" hint="in the list views" keys="lines rows columns table">
        <Choice label="grid lines" value={state.gridLines} options={[["none", "none"], ["rows", "rows"], ["both", "rows and columns"]]} onPick={set("gridLines")} />
      </Row>
      <Row label="selection" hint="how selected rows look" keys="highlight selected">
        <Choice label="selection" value={state.selection} options={[["fill", "filled"], ["tint", "tinted"], ["outline", "outlined"], ["bar", "side bar"]]} onPick={set("selection")} />
      </Row>
      <Row label="git badges" hint="changed files, when git gutters show" keys="git status modified">
        <Choice label="git badges" value={state.gitStyle} options={[["both", "dot and letter"], ["dot", "dot"], ["letter", "letter"], ["tint", "colored name"]]} onPick={set("gitStyle")} />
      </Row>
      <Row label="name colors" keys="color colour file type tag">
        <Choice label="name colors" value={state.nameColors} options={[["none", "none"], ["type", "by file type"], ["tag", "by tag"]]} onPick={set("nameColors")} />
      </Row>
    </Section>
  );
}

// ---- effects ----
function EffectsSection({ state, set }: SectionProps) {
  return (
    <Section title="effects">
      <Row label="scanlines" hint="CRT overlay" keys="retro crt">
        <Choice label="scanlines" value={state.scanlines} options={OFF_ON} onPick={set("scanlines")} />
      </Row>
      <Row label="glow" hint="text glows like a CRT" keys="retro bloom">
        <Choice label="glow" value={state.glow} options={OFF_ON} onPick={set("glow")} />
      </Row>
      <Row label="vignette" hint="darker corners" keys="retro">
        <Choice label="vignette" value={state.vignette} options={OFF_ON} onPick={set("vignette")} />
      </Row>
      <Row label="frosted menus" hint="menus and dialogs blur what’s behind" keys="blur glass transparency translucent">
        <Choice label="frosted menus" value={state.frosted} options={OFF_ON} onPick={set("frosted")} />
      </Row>
      <Row label="motion" hint="system: less when your system asks for it" keys="animation transitions reduce reduced">
        <Choice label="motion" value={state.motion} options={[["system", "system"], ["reduced", "reduced"], ["full", "full"]]} onPick={set("motion")} />
      </Row>
    </Section>
  );
}

// ---- files ----
function FilesSection({ state, set }: SectionProps) {
  return (
    <Section title="files">
      <Row label="hidden files" hint="Ctrl+H" keys="dotfiles show">
        <Choice label="hidden files" value={state.hidden} options={SHOW_HIDE} onPick={set("hidden")} />
      </Row>
      <Row label="file extensions">
        <Choice label="file extensions" value={state.showExtensions} options={SHOW_HIDE} onPick={set("showExtensions")} />
      </Row>
      <Row label="folders first" keys="sort order">
        <Choice label="folders first" value={state.foldersFirst} options={OFF_ON} onPick={set("foldersFirst")} />
      </Row>
      <Row label="git gutters" keys="git status">
        <Choice label="git gutters" value={state.showGitGutters} options={SHOW_HIDE} onPick={set("showGitGutters")} />
      </Row>
    </Section>
  );
}

/** Preferences → Integration: glasshouse as the file manager other apps
 *  hand off to (src-tauri/src/commands/integration.rs). Read when the
 *  dialog opens; each switch reports what the desktop does afterwards.
 *  Hidden where there's nothing to set. */
function IntegrationSection({ status, setStatus }: { status: IntegrationStatus; setStatus: (s: IntegrationStatus) => void }) {
  const [busy, setBusy] = useState<IntegrationKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flip = (key: IntegrationKey, on: boolean) => {
    setBusy(key);
    setError(null);
    integrationSet(key, on)
      .then(setStatus, err => setError(errText(err)))
      .finally(() => setBusy(null));
  };
  const row = (key: IntegrationKey, label: string, hint: string, f: IntegrationFeature | null, more?: React.ReactNode) => f && (
    <Row label={label} hint={hint} keys="default file manager handler portal dialog">
      <Choice<boolean>
        label={label}
        value={f.on}
        options={[[false, "off"], [true, "on"]]}
        disabled={busy !== null}
        onPick={on => { if (on !== f.on) flip(key, on); }}
      />
      <p className="prefs-note">{busy === key ? "applying…" : f.detail}</p>
      {f.warning && <p className="prefs-note warn">{f.warning}</p>}
      {more}
    </Row>
  );
  return (
    <Section title="integration">
      {row("folders", "open folders with glasshouse", "folders opened from other apps", status.folders)}
      {row("fileManager", "show files for other apps", "a browser's “show in folder”", status.fileManager)}
      {row("dialogs", "use glasshouse for open and save dialogs", "other apps' open, save as, attach and upload", status.dialogs,
        status.dialogs && <DialogsMore d={status.dialogs} disabled={busy !== null} busyKey={busy} flip={flip} />)}
      {error && <p className="prefs-note error" role="alert">{error}</p>}
      {(status.limits.length > 0 || status.program) && (
        <div className="prefs-foot-note">
          {status.limits.map(l => <p key={l}>{l}</p>)}
          {status.program && <p>Settings start {status.program}.</p>}
        </div>
      )}
    </Section>
  );
}

/** In the "use glasshouse for open and save dialogs" row: when it takes effect,
 *  the root command an old portal needs, and Advanced, the toolkit opt-ins
 *  (integration_portal.rs), each on unless turned off. */
function DialogsMore({ d, disabled, busyKey, flip }: {
  d: IntegrationDialogs;
  disabled: boolean;
  busyKey: IntegrationKey | null;
  flip: (key: IntegrationKey, on: boolean) => void;
}) {
  return (
    <>
      {d.rootCommand && (
        <>
          <p className="prefs-note">Run this once in a terminal, then turn the setting off and on:</p>
          <code className="prefs-code">{d.rootCommand}</code>
        </>
      )}
      <p className="prefs-note">
        Apps that ask the portal on their own (Flatpak and Snap apps, Chromium, Chrome, Electron apps) switch with
        their next dialog.{" "}
        {d.on && d.pendingLogin ? "The toolkit settings below apply at your next login" : "The toolkit settings below apply at login"};
        apps already running keep their old dialog until they're restarted. Turning this on or off restarts
        xdg-desktop-portal, which ends a screen share in progress.
      </p>
      <details className="prefs-advanced">
        <summary>advanced</summary>
        <p className="prefs-note">
          These tell the other apps to ask the portal, from your next login:
        </p>
        {d.toolkits.map(t => (
          <div key={t.key} className="prefs-toolkit">
            <label>
              <input
                type="checkbox"
                checked={t.on}
                disabled={disabled}
                onChange={e => flip(`dialogs.${t.key}`, e.target.checked)}
              />
              {t.label}
              {t.sets && <code>{t.sets}</code>}
              {busyKey === `dialogs.${t.key}` && <span className="prefs-hint"> applying…</span>}
            </label>
            <p className="prefs-note">{t.note}</p>
            {t.warning && <p className="prefs-note warn">{t.warning}</p>}
          </div>
        ))}
      </details>
    </>
  );
}

// ---- building blocks ----
/** The filter's words; a row shows when its words have them all. */
const FilterCtx = createContext<readonly string[]>([]);
const SectionCtx = createContext("");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SectionCtx.Provider value={title}>
      <section className="prefs-section" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </section>
    </SectionCtx.Provider>
  );
}

function Row({ label, hint, keys, children }: { label: string; hint?: string; keys?: string; children: React.ReactNode }) {
  const words = useContext(FilterCtx);
  const section = useContext(SectionCtx);
  if (words.length) {
    const hay = `${section} ${label} ${hint ?? ""} ${keys ?? ""}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) return null;
  }
  return (
    <div className="prefs-row">
      <div className="prefs-label">
        {label}
        {hint && <span className="prefs-hint">{hint}</span>}
      </div>
      <div className="prefs-control">{children}</div>
    </div>
  );
}

/** A row of buttons, one pressed: the setting's value. */
function Choice<T extends string | boolean>({ label, value, options, onPick, disabled }: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, name]) => (
        <button
          key={name}
          type="button"
          className={v === value ? "active" : ""}
          aria-pressed={v === value}
          disabled={disabled}
          onClick={() => onPick(v)}
        >{name}</button>
      ))}
    </div>
  );
}

interface Step { label: string; disabled: boolean; run: () => void }

/** − value + and reset. */
function Stepper({ label, value, down, up, reset, resetDisabled }: {
  label: string;
  value: string;
  down: Step;
  up: Step;
  /** Shown while set; disabled when `resetDisabled`. */
  reset?: () => void;
  resetDisabled?: boolean;
}) {
  return (
    <div className="prefs-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={down.label} disabled={down.disabled} onClick={down.run}>−</button>
      <output className="value">{value}</output>
      <button type="button" aria-label={up.label} disabled={up.disabled} onClick={up.run}>+</button>
      {reset && <button type="button" disabled={resetDisabled} onClick={reset}>reset</button>}
    </div>
  );
}
