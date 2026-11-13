import React, { useEffect, useRef } from "react";
import type { TweakDensity, TweakState } from "../components";
import { THEMES } from "../data";
import { KEYMAP, matches } from "../keymap";
import { stepZoom, ZOOM_DEFAULT, ZOOM_STEPS, zoomLabel } from "../zoom";
import { useEscapeClose } from "./useEscapeClose";
import { useModal } from "./modal";

// ============= PreferencesDialog =============
// Edit → Preferences… (Ctrl+,). Each change applies at once and is saved with
// the other settings (App's TweakState, localStorage["glasshouse.tweaks"]);
// the View menu toggles several of the same ones. There's no native <select>
// here: WebKitGTK draws a select's open list with GTK, which CSS can't theme.

/** The font families on offer. Iosevka and Berkeley Mono aren't bundled:
 *  they apply only when installed (offline.test.ts checks the rest). */
export const FONTS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "JetBrainsMono Nerd Font", value: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace' },
  { label: "Iosevka", value: '"Iosevka", ui-monospace, monospace' },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", ui-monospace, monospace' },
  { label: "Fira Code", value: '"Fira Code", ui-monospace, monospace' },
  { label: "Berkeley Mono", value: '"Berkeley Mono", ui-monospace, monospace' },
];

/** The binding that opens Preferences… also closes it (App's keymap is off
 *  while a modal is open). */
const PREFS_KEYS = KEYMAP.filter(b => b.send === "Preferences…");

export interface PreferencesDialogProps {
  open: boolean;
  state: TweakState;
  setState: React.Dispatch<React.SetStateAction<TweakState>>;
  onClose: () => void;
}

export function PreferencesDialog({ open, state, setState, onClose }: PreferencesDialogProps) {
  useEscapeClose(onClose, open);
  useModal(open);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const h = (e: KeyboardEvent) => {
      if (PREFS_KEYS.some(b => matches(b, e))) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof TweakState>(key: K) => (value: TweakState[K]) =>
    setState(prev => ({ ...prev, [key]: value }));
  const zoomBy = (dir: 1 | -1) => setState(prev => ({ ...prev, zoom: stepZoom(prev.zoom, dir) }));
  const showHide: Array<[boolean, string]> = [[false, "hide"], [true, "show"]];
  const offOn: Array<[boolean, string]> = [[false, "off"], [true, "on"]];

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
          <span className="prefs-sub">changes apply at once · esc to close</span>
          <button type="button" className="prefs-x" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="prefs-body">
          <Section title="appearance">
            <Row label="theme">
              <div className="prefs-themes" role="group" aria-label="theme">
                {THEMES.map(t => (
                  <button
                    key={t}
                    type="button"
                    data-theme={t}
                    className={"prefs-theme" + (t === state.theme ? " active" : "")}
                    aria-pressed={t === state.theme}
                    onClick={() => set("theme")(t)}
                  >
                    <span className="name">{t}</span>
                    <span className="dots" aria-hidden="true">
                      {["--accent", "--accent-2", "--green", "--yellow", "--red"].map(v => (
                        <i key={v} style={{ background: `var(${v})` }} />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </Row>
            <Row label="font family">
              <div className="prefs-list" role="group" aria-label="font family">
                {FONTS.map(f => (
                  <button
                    key={f.value}
                    type="button"
                    className={f.value === state.font ? "active" : ""}
                    aria-pressed={f.value === state.font}
                    style={{ fontFamily: f.value }}
                    onClick={() => set("font")(f.value)}
                  >{f.label}</button>
                ))}
              </div>
            </Row>
            <Row label="density" hint="row height and text size">
              <Choice<TweakDensity>
                label="density"
                value={state.density}
                options={[["compact", "compact"], ["default", "default"], ["comfy", "comfy"]]}
                onPick={set("density")}
              />
            </Row>
            <Row label="scanlines" hint="CRT overlay">
              <Choice label="scanlines" value={state.scanlines} options={offOn} onPick={set("scanlines")} />
            </Row>
            <Row label="zoom" hint="Ctrl+= · Ctrl+- · Ctrl+0">
              <div className="prefs-zoom" role="group" aria-label="zoom">
                <button type="button" aria-label="zoom out" disabled={state.zoom <= ZOOM_STEPS[0]} onClick={() => zoomBy(-1)}>−</button>
                <output className="value">{zoomLabel(state.zoom)}</output>
                <button type="button" aria-label="zoom in" disabled={state.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => zoomBy(1)}>+</button>
                <button type="button" disabled={state.zoom === ZOOM_DEFAULT} onClick={() => set("zoom")(ZOOM_DEFAULT)}>reset</button>
              </div>
            </Row>
          </Section>
          <Section title="files">
            <Row label="hidden files" hint="Ctrl+H">
              <Choice label="hidden files" value={state.hidden} options={showHide} onPick={set("hidden")} />
            </Row>
            <Row label="file extensions">
              <Choice label="file extensions" value={state.showExtensions} options={showHide} onPick={set("showExtensions")} />
            </Row>
            <Row label="folders first">
              <Choice label="folders first" value={state.foldersFirst} options={offOn} onPick={set("foldersFirst")} />
            </Row>
            <Row label="git gutters">
              <Choice label="git gutters" value={state.showGitGutters} options={showHide} onPick={set("showGitGutters")} />
            </Row>
          </Section>
          <Section title="terminal">
            <Row label="follow folder" hint="cd to the active tab's folder">
              <Choice label="follow folder" value={state.termFollow} options={offOn} onPick={set("termFollow")} />
            </Row>
          </Section>
        </div>
        <div className="prefs-foot">
          <button type="button" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="prefs-section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
function Choice<T extends string | boolean>({ label, value, options, onPick }: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onPick: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, name]) => (
        <button
          key={name}
          type="button"
          className={v === value ? "active" : ""}
          aria-pressed={v === value}
          onClick={() => onPick(v)}
        >{name}</button>
      ))}
    </div>
  );
}
