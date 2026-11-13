import React, { useState, useEffect, useRef } from "react";
import { errText } from "../errors";
import { useModal } from "./modal";

// ============= DialogHost (themed prompt / alert / confirm + toast) =============
// Replaces window.prompt / window.alert / window.confirm at key callsites.
// DialogHost is mounted once in App.tsx; callers use the singleton imperative
// API exposed via `dialogs`.

export type DialogVariant = "info" | "success" | "warning" | "error";

interface PromptOptions {
  title?: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  okLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
  /** Runs on OK once `validate` passes, with the prompt still open: the
   *  write itself, so a refusal shows inline instead of after the prompt
   *  closes. Resolve null to close (showPrompt resolves with the value), or
   *  an error string to stay open with it; a rejection's message shows the
   *  same way. The prompt can't be cancelled while it runs. */
  submit?: (value: string) => Promise<string | null>;
}

interface AlertOptions {
  title?: string;
  message: string;
  variant?: DialogVariant;
  okLabel?: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  danger?: boolean;
  okLabel?: string;
  cancelLabel?: string;
}

interface ChoiceOptions {
  title?: string;
  message: string;
  /** Buttons after "cancel", left to right. Enter picks the primary one;
   *  cancel, Esc and × resolve null. */
  choices: Array<{ id: string; label: string; primary?: boolean }>;
  cancelLabel?: string;
}

interface PickOptions {
  title?: string;
  message?: string;
  /** One row each. ↑/↓ (and Page, Home, End) move, Enter or a click picks;
   *  it resolves with the row's index, or null for cancel, Esc and ×. */
  items: string[];
  okLabel?: string;
  cancelLabel?: string;
}

interface ToastOptions {
  message: string;
  variant?: DialogVariant;
  timeout?: number;
}

interface DialogApi {
  showPrompt: (opts: PromptOptions) => Promise<string | null>;
  showAlert: (opts: AlertOptions) => Promise<void>;
  showConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  showChoice: (opts: ChoiceOptions) => Promise<string | null>;
  showPick: (opts: PickOptions) => Promise<number | null>;
  showToast: (opts: ToastOptions) => void;
}

// Singleton ref. DialogHost registers itself on mount; the `dialogs` helper
// returns a no-op / default if called before mount.
let dialogApiRef: DialogApi | null = null;

export const dialogs: DialogApi = {
  showPrompt: (opts) => {
    if (!dialogApiRef) return Promise.resolve<string | null>(null);
    return dialogApiRef.showPrompt(opts);
  },
  showAlert: (opts) => {
    if (!dialogApiRef) return Promise.resolve();
    return dialogApiRef.showAlert(opts);
  },
  showConfirm: (opts) => {
    if (!dialogApiRef) return Promise.resolve(false);
    return dialogApiRef.showConfirm(opts);
  },
  showChoice: (opts) => {
    if (!dialogApiRef) return Promise.resolve<string | null>(null);
    return dialogApiRef.showChoice(opts);
  },
  showPick: (opts) => {
    if (!dialogApiRef) return Promise.resolve<number | null>(null);
    return dialogApiRef.showPick(opts);
  },
  showToast: (opts) => {
    if (!dialogApiRef) return;
    dialogApiRef.showToast(opts);
  },
};

type DialogState =
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "choice"; opts: ChoiceOptions; resolve: (v: string | null) => void }
  | { kind: "pick"; opts: PickOptions; resolve: (v: number | null) => void }
  | null;

interface ToastState {
  id: number;
  message: string;
  variant: DialogVariant;
}

/** The pick list's row after `key` from row `at` of `count`, or null for a
 *  key that doesn't move it. */
export function pickMove(key: string, at: number, count: number): number | null {
  const page = 10;
  const to = key === "ArrowDown" ? at + 1
    : key === "ArrowUp" ? at - 1
    : key === "PageDown" ? at + page
    : key === "PageUp" ? at - page
    : key === "Home" ? 0
    : key === "End" ? count - 1
    : null;
  return to === null ? null : Math.max(0, Math.min(count - 1, to));
}

/** Enter on a button inside the dialog activates that button (Tab to
 *  "cancel", Enter cancels); anywhere else it's the dialog's primary action. */
export function enterActivatesFocused(el: Element | null, panel: Element | null): boolean {
  return !!el && !!panel && el.tagName === "BUTTON" && panel.contains(el);
}

function variantColor(v: DialogVariant | undefined): string {
  switch (v) {
    case "success": return "var(--green, #9ece6a)";
    case "warning": return "var(--yellow, #e0af68)";
    case "error": return "var(--red, #f7768e)";
    default: return "var(--accent)";
  }
}

export function DialogHost() {
  const [state, setState] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [pickAt, setPickAt] = useState(0);
  const promptBusy = useRef(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const open = state !== null;
  useModal(open);

  // Focus goes back to what had it (usually the file pane) on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    return () => { if (prev?.isConnected) prev.focus(); };
  }, [open]);

  useEffect(() => {
    const api: DialogApi = {
      showPrompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setPromptValue(opts.initialValue ?? "");
          setPromptError(null);
          setState({ kind: "prompt", opts, resolve });
        }),
      showAlert: (opts) =>
        new Promise<void>((resolve) => {
          setState({ kind: "alert", opts, resolve });
        }),
      showConfirm: (opts) =>
        new Promise<boolean>((resolve) => {
          setState({ kind: "confirm", opts, resolve });
        }),
      showChoice: (opts) =>
        new Promise<string | null>((resolve) => {
          setState({ kind: "choice", opts, resolve });
        }),
      showPick: (opts) =>
        new Promise<number | null>((resolve) => {
          setPickAt(0);
          setState({ kind: "pick", opts, resolve });
        }),
      showToast: (opts) => {
        const id = ++toastIdRef.current;
        const t: ToastState = {
          id,
          message: opts.message,
          variant: opts.variant ?? "info",
        };
        setToasts((prev) => [...prev, t]);
        const ms = opts.timeout ?? 2600;
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== id));
        }, ms);
      },
    };
    dialogApiRef = api;
    return () => {
      if (dialogApiRef === api) dialogApiRef = null;
    };
  }, []);

  useEffect(() => {
    if (state?.kind === "prompt") {
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
    if (state) {
      // Off the file pane, so its keys don't act behind the dialog.
      const id = window.setTimeout(() => (state.kind === "pick" ? listRef.current : primaryRef.current)?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [state]);

  useEffect(() => {
    if (state?.kind !== "pick") return;
    listRef.current?.querySelector<HTMLElement>(`[data-pick="${pickAt}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [state, pickAt]);

  const close = () => {
    if (!state || promptBusy.current) return;
    if (state.kind === "prompt") state.resolve(null);
    else if (state.kind === "alert") state.resolve();
    else if (state.kind === "choice" || state.kind === "pick") state.resolve(null);
    else state.resolve(false);
    setState(null);
  };

  const submitPrompt = () => {
    if (state?.kind !== "prompt" || promptBusy.current) return;
    const v = promptValue;
    if (state.opts.validate) {
      const err = state.opts.validate(v);
      if (err) {
        setPromptError(err);
        return;
      }
    }
    const { submit } = state.opts;
    if (!submit) {
      state.resolve(v);
      setState(null);
      return;
    }
    const current = state;
    promptBusy.current = true;
    submit(v)
      .catch((err: unknown) => errText(err) || "failed")
      .then((err) => {
        promptBusy.current = false;
        if (err) {
          setPromptError(err);
          return;
        }
        current.resolve(v);
        setState((s) => (s === current ? null : s));
      });
  };

  const confirmOk = () => {
    if (state?.kind !== "confirm") return;
    state.resolve(true);
    setState(null);
  };

  const alertOk = () => {
    if (state?.kind !== "alert") return;
    state.resolve();
    setState(null);
  };

  const choose = (id: string | undefined) => {
    if (state?.kind !== "choice" || id === undefined) return;
    state.resolve(id);
    setState(null);
  };

  const pick = (i: number) => {
    if (state?.kind !== "pick" || i < 0 || i >= state.opts.items.length) return;
    state.resolve(i);
    setState(null);
  };

  useEffect(() => {
    if (!state) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (state.kind === "pick") {
        const to = pickMove(e.key, pickAt, state.opts.items.length);
        if (to !== null) { e.preventDefault(); setPickAt(to); return; }
      }
      if (e.key === "Enter") {
        if (e.shiftKey) return;
        if (enterActivatesFocused(document.activeElement, panelRef.current)) return;
        e.preventDefault();
        if (state.kind === "prompt") submitPrompt();
        else if (state.kind === "confirm") confirmOk();
        else if (state.kind === "choice") choose(state.opts.choices.find(c => c.primary)?.id);
        else if (state.kind === "pick") pick(pickAt);
        else alertOk();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, promptValue, pickAt]);

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
    zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center",
    paddingTop: "15vh",
  };
  const panel: React.CSSProperties = {
    width: "56ch", maxWidth: "95vw",
    background: "var(--bg-2, #16161e)",
    border: "1px solid var(--accent)",
    borderRadius: 6,
    fontFamily: "var(--font-mono)",
    color: "var(--fg-1)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    overflow: "hidden",
  };
  const header: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 12px", borderBottom: "1px solid var(--border, var(--fg-3))",
    background: "var(--bg-1, #1a1b26)",
  };
  const body: React.CSSProperties = {
    padding: "14px 16px",
    fontSize: 13,
  };
  const footer: React.CSSProperties = {
    padding: "8px 12px", borderTop: "1px solid var(--border, var(--fg-3))",
    display: "flex", justifyContent: "flex-end", gap: 6,
    background: "var(--bg-1, #1a1b26)",
  };
  const btn = (primary = false, danger = false): React.CSSProperties => ({
    background: primary
      ? (danger ? "var(--red, #f7768e)" : "var(--accent)")
      : "transparent",
    border: `1px solid ${primary ? (danger ? "var(--red, #f7768e)" : "var(--accent)") : "var(--fg-3)"}`,
    color: primary ? "var(--bg-0, #0f0f14)" : "var(--fg-1)",
    padding: "4px 14px",
    cursor: "pointer",
    borderRadius: 3,
    fontFamily: "inherit",
    fontSize: 12,
  });
  const closeBtn: React.CSSProperties = {
    background: "transparent", border: "1px solid var(--fg-3)", color: "var(--fg-1)",
    padding: "2px 8px", cursor: "pointer", borderRadius: 2,
  };

  return (
    <>
      {state?.kind === "prompt" && (
        <div onClick={close} style={overlay}>
          <div ref={panelRef} onClick={(e) => e.stopPropagation()} style={panel}>
            <div style={header}>
              <span style={{ color: "var(--accent)" }}>{state.opts.title ?? "input"}</span>
              <button onClick={close} style={closeBtn}>×</button>
            </div>
            <div style={body}>
              {state.opts.message && (
                <div style={{ marginBottom: 8, color: "var(--fg-2, var(--fg-1))" }}>{state.opts.message}</div>
              )}
              <input
                ref={inputRef}
                value={promptValue}
                onChange={(e) => { setPromptValue(e.target.value); if (promptError) setPromptError(null); }}
                placeholder={state.opts.placeholder}
                style={{
                  width: "100%",
                  background: "var(--bg-0, #0f0f14)", color: "var(--fg-0, var(--fg-1))",
                  border: `1px solid ${promptError ? "var(--red, #f7768e)" : "var(--fg-3)"}`,
                  borderRadius: 3, padding: "6px 9px",
                  fontFamily: "var(--font-mono)", fontSize: 13,
                  outline: "none", boxSizing: "border-box",
                }}
              />
              {promptError && (
                <div style={{ marginTop: 6, color: "var(--red, #f7768e)", fontSize: 11 }}>{promptError}</div>
              )}
            </div>
            <div style={footer}>
              <button onClick={close} style={btn(false)}>{state.opts.cancelLabel ?? "cancel"}</button>
              <button onClick={submitPrompt} style={btn(true)}>{state.opts.okLabel ?? "ok"}</button>
            </div>
          </div>
        </div>
      )}

      {state?.kind === "alert" && (
        <div onClick={alertOk} style={overlay}>
          <div ref={panelRef} onClick={(e) => e.stopPropagation()} style={{ ...panel, borderColor: variantColor(state.opts.variant) }}>
            <div style={header}>
              <span style={{ color: variantColor(state.opts.variant) }}>
                {state.opts.title ?? (state.opts.variant === "error" ? "error" : state.opts.variant === "warning" ? "warning" : "info")}
              </span>
              <button onClick={alertOk} style={closeBtn}>×</button>
            </div>
            <div style={{ ...body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {state.opts.message}
            </div>
            <div style={footer}>
              <button ref={primaryRef} onClick={alertOk} style={btn(true)}>{state.opts.okLabel ?? "ok"}</button>
            </div>
          </div>
        </div>
      )}

      {state?.kind === "confirm" && (
        <div onClick={close} style={overlay}>
          <div ref={panelRef} onClick={(e) => e.stopPropagation()} style={{ ...panel, borderColor: state.opts.danger ? "var(--red, #f7768e)" : "var(--accent)" }}>
            <div style={header}>
              <span style={{ color: state.opts.danger ? "var(--red, #f7768e)" : "var(--accent)" }}>
                {state.opts.title ?? "confirm"}
              </span>
              <button onClick={close} style={closeBtn}>×</button>
            </div>
            <div style={{ ...body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {state.opts.message}
            </div>
            <div style={footer}>
              <button onClick={close} style={btn(false)}>{state.opts.cancelLabel ?? "cancel"}</button>
              <button ref={primaryRef} onClick={confirmOk} style={btn(true, !!state.opts.danger)}>
                {state.opts.okLabel ?? (state.opts.danger ? "delete" : "ok")}
              </button>
            </div>
          </div>
        </div>
      )}

      {state?.kind === "choice" && (
        <div onClick={close} style={overlay}>
          <div ref={panelRef} onClick={(e) => e.stopPropagation()} style={panel}>
            <div style={header}>
              <span style={{ color: "var(--accent)" }}>{state.opts.title ?? "choose"}</span>
              <button onClick={close} style={closeBtn}>×</button>
            </div>
            <div style={{ ...body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {state.opts.message}
            </div>
            <div style={footer}>
              <button onClick={close} style={btn(false)}>{state.opts.cancelLabel ?? "cancel"}</button>
              {state.opts.choices.map(c => (
                <button key={c.id} ref={c.primary ? primaryRef : undefined} onClick={() => choose(c.id)} style={btn(!!c.primary)}>{c.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {state?.kind === "pick" && (
        <div onClick={close} style={overlay}>
          <div ref={panelRef} onClick={(e) => e.stopPropagation()} style={{ ...panel, width: "80ch" }}>
            <div style={header}>
              <span style={{ color: "var(--accent)" }}>{state.opts.title ?? "pick"}</span>
              <button onClick={close} style={closeBtn}>×</button>
            </div>
            {state.opts.message && (
              <div style={{ ...body, paddingBottom: 8, color: "var(--fg-2, var(--fg-1))", wordBreak: "break-word" }}>{state.opts.message}</div>
            )}
            <div
              ref={listRef}
              role="listbox"
              tabIndex={0}
              aria-activedescendant={`dialog-pick-${pickAt}`}
              style={{ maxHeight: "50vh", overflow: "auto", padding: "0 0 8px", fontSize: 12, outline: "none" }}
            >
              {state.opts.items.map((item, i) => (
                <div
                  key={i}
                  id={`dialog-pick-${i}`}
                  data-pick={i}
                  role="option"
                  aria-selected={i === pickAt}
                  onMouseEnter={() => setPickAt(i)}
                  onClick={() => pick(i)}
                  style={{
                    padding: "2px 16px", cursor: "pointer", whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis",
                    background: i === pickAt ? "var(--bg-sel)" : "transparent",
                    color: i === pickAt ? "var(--fg-0)" : "var(--fg-1)",
                  }}
                >{item}</div>
              ))}
            </div>
            <div style={footer}>
              <button onClick={close} style={btn(false)}>{state.opts.cancelLabel ?? "cancel"}</button>
              <button ref={primaryRef} onClick={() => pick(pickAt)} style={btn(true)}>{state.opts.okLabel ?? "ok"}</button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div style={{
          position: "fixed",
          right: 16, bottom: 44,
          zIndex: 350,
          display: "flex", flexDirection: "column", gap: 6,
          pointerEvents: "none",
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              background: "var(--bg-2, #16161e)",
              border: `1px solid ${variantColor(t.variant)}`,
              borderRadius: 4,
              padding: "6px 12px",
              color: "var(--fg-1)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              maxWidth: "60ch",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}>
              <span style={{ color: variantColor(t.variant), marginRight: 6 }}>●</span>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
