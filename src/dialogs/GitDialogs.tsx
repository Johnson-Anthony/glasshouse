import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { gitBranchList, gitCommitInfo, type CommitInfo, type GitBranch } from "../api";
import { errText } from "../errors";
import { branchChoices, commitArgs, filterChoices, type BranchAction } from "../gitUx";
import { pickMove } from "./DialogHost";
import { useModal } from "./modal";
import { useEscapeClose } from "./useEscapeClose";

// ============= GitDialogHost (branch picker, commit dialog) =============
// The git menu's two dialogs, opened through `gitDialogs` like DialogHost's
// `dialogs`, and mounted once in App.tsx. Each resolves null on cancel.

interface PickBranchOptions {
  cwd: string;
  action: BranchAction;
}

interface CommitOptions {
  cwd: string;
  amend: boolean;
}

interface GitDialogApi {
  /** The branch to send: a picked one, or the typed text when nothing in
   *  the list matches it (a tag, a commit, `-`). */
  pickBranch: (opts: PickBranchOptions) => Promise<string | null>;
  /** The `git commit` arguments for what was typed (`commitArgs`). */
  commit: (opts: CommitOptions) => Promise<string[] | null>;
}

let apiRef: GitDialogApi | null = null;

export const gitDialogs: GitDialogApi = {
  pickBranch: (opts) => (apiRef ? apiRef.pickBranch(opts) : Promise.resolve(null)),
  commit: (opts) => (apiRef ? apiRef.commit(opts) : Promise.resolve(null)),
};

type Open =
  | { kind: "branch"; opts: PickBranchOptions; resolve: (v: string | null) => void }
  | { kind: "commit"; opts: CommitOptions; resolve: (v: string[] | null) => void }
  | null;

export function GitDialogHost() {
  const [open, setOpen] = useState<Open>(null);
  useEffect(() => {
    const api: GitDialogApi = {
      pickBranch: (opts) => new Promise((resolve) => setOpen({ kind: "branch", opts, resolve })),
      commit: (opts) => new Promise((resolve) => setOpen({ kind: "commit", opts, resolve })),
    };
    apiRef = api;
    return () => {
      if (apiRef === api) apiRef = null;
    };
  }, []);

  if (open?.kind === "branch") {
    return <BranchPicker opts={open.opts} onDone={(v) => { open.resolve(v); setOpen(null); }} />;
  }
  if (open?.kind === "commit") {
    return <CommitDialog opts={open.opts} onDone={(v) => { open.resolve(v); setOpen(null); }} />;
  }
  return null;
}

/** The frame both dialogs share. `onKey` gets every key pressed while it's
 *  open, wherever the focus is (a click on the dialog's text leaves it on
 *  the panel). Focus goes back to what had it on close. */
function Frame({ title, sub, onCancel, onKey, children, foot }: {
  title: string;
  sub?: string;
  onCancel: () => void;
  onKey: (e: KeyboardEvent) => void;
  children: ReactNode;
  foot: ReactNode;
}) {
  useModal();
  useEscapeClose(onCancel);
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  return (
    <div className="gitdlg-backdrop" onClick={onCancel}>
      <div
        className="gitdlg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gitdlg-head">
          <span className="gitdlg-title">⎇ {title}</span>
          {sub && <span className="gitdlg-sub">{sub}</span>}
          <button type="button" className="gitdlg-x" onClick={onCancel} aria-label="close">×</button>
        </div>
        <div className="gitdlg-body">{children}</div>
        <div className="gitdlg-foot">{foot}</div>
      </div>
    </div>
  );
}

/** Enter on a focused button (Tab to "cancel") is that button's. */
function enterActivatesButton(): boolean {
  return document.activeElement?.tagName === "BUTTON";
}

const PICK_TITLE: Record<BranchAction, string> = {
  checkout: "git checkout",
  merge: "git merge",
  rebase: "git rebase onto",
};

function BranchPicker({ opts, onDone }: { opts: PickBranchOptions; onDone: (v: string | null) => void }) {
  const [branches, setBranches] = useState<GitBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    gitBranchList(opts.cwd, true).then(
      (b) => { if (live) setBranches(b); },
      (e: unknown) => { if (live) setError(errText(e) || "couldn't list the branches"); },
    );
    return () => { live = false; };
  }, [opts.cwd]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const all = useMemo(() => branchChoices(branches ?? [], opts.action), [branches, opts.action]);
  const shown = useMemo(() => filterChoices(all, query), [all, query]);
  const current = branches?.find((b) => b.current && !b.remote)?.name;
  const typed = query.trim();
  // Nothing in the list matches: Enter sends the text as typed.
  const useTyped = branches !== null && shown.length === 0 && typed !== "";
  const chosen = useTyped ? typed : shown[Math.min(at, shown.length - 1)]?.value;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-pick="${at}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [at, shown]);

  const onKey = (e: KeyboardEvent) => {
    // Home and End stay with the text field.
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      const to = pickMove(e.key, at, shown.length);
      if (to !== null) setAt(to);
    } else if (e.key === "Enter" && !enterActivatesButton()) {
      e.preventDefault();
      if (chosen) onDone(chosen);
    }
  };

  return (
    <Frame
      title={PICK_TITLE[opts.action]}
      sub={current ? `on ${current}` : undefined}
      onCancel={() => onDone(null)}
      onKey={onKey}
      foot={
        <>
          <span className="gitdlg-keys">↑↓ move · enter picks · esc cancels</span>
          <button type="button" onClick={() => onDone(null)}>cancel</button>
          <button type="button" className="primary" disabled={!chosen} onClick={() => chosen && onDone(chosen)}>
            {opts.action === "checkout" ? "check out" : opts.action}
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        className="gitdlg-input"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setAt(0); }}
        placeholder="filter branches, or type a tag or commit"
        aria-label="branch"
        aria-controls="gitdlg-branches"
        aria-activedescendant={!useTyped && shown.length ? `gitdlg-branch-${at}` : undefined}
        spellCheck={false}
      />
      {error ? (
        <div className="gitdlg-error">{error}</div>
      ) : branches === null ? (
        <div className="gitdlg-note">listing branches…</div>
      ) : (
        <div ref={listRef} id="gitdlg-branches" className="gitdlg-list" role="listbox" aria-label="branches">
          {shown.map((c, i) => (
            <div
              key={c.label}
              id={`gitdlg-branch-${i}`}
              data-pick={i}
              role="option"
              aria-selected={i === at}
              className={"gitdlg-row" + (i === at ? " active" : "")}
              onMouseEnter={() => setAt(i)}
              onClick={() => onDone(c.value)}
            >
              <span className={c.remote ? "gitdlg-remote" : undefined}>{c.label}</span>
              {c.hint && <span className="gitdlg-hint">{c.hint}</span>}
            </div>
          ))}
          {shown.length === 0 && (
            <div className="gitdlg-note">
              {typed ? <>no branch matches: enter uses <b>{typed}</b> as typed</> : "no other branches"}
            </div>
          )}
        </div>
      )}
    </Frame>
  );
}

const CODE_WORD: Record<string, string> = { A: "added", M: "modified", D: "deleted", R: "renamed", T: "type changed" };

function CommitDialog({ opts, onDone }: { opts: CommitOptions; onDone: (v: string[] | null) => void }) {
  const [info, setInfo] = useState<CommitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    gitCommitInfo(opts.cwd).then(
      (i) => {
        if (!live) return;
        setInfo(i);
        if (opts.amend) setMessage((i.head_message ?? "").trimEnd());
      },
      (e: unknown) => { if (live) setError(errText(e) || "couldn't read the repository"); },
    );
    return () => { live = false; };
  }, [opts.cwd, opts.amend]);
  useEffect(() => { if (info) textRef.current?.focus(); }, [info]);

  const noHead = info !== null && info.head_message === null;
  const args = info === null || (opts.amend ? noHead : info.staged_total === 0)
    ? null
    : commitArgs(message, opts.amend, info.head_message);
  const submit = () => { if (args) onDone(args); };
  // Enter alone is a new line in the message.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !enterActivatesButton()) {
      e.preventDefault();
      submit();
    }
  };

  let note: string | null = null;
  if (info && opts.amend && noHead) note = "nothing to amend: this branch has no commits yet";
  else if (info && info.staged_total === 0) {
    note = opts.amend
      ? "nothing new is staged: the amend changes only the message"
      : "nothing is staged: stage files first (Git → Stage Selected)";
  }
  const more = info ? info.staged_total - info.staged.length : 0;

  return (
    <Frame
      title={opts.amend ? "git commit --amend" : "git commit"}
      sub={info ? `on ${info.branch}` : undefined}
      onCancel={() => onDone(null)}
      onKey={onKey}
      foot={
        <>
          <span className="gitdlg-keys">ctrl+enter commits · esc cancels</span>
          <button type="button" onClick={() => onDone(null)}>cancel</button>
          <button type="button" className="primary" disabled={!args} onClick={submit}>
            {opts.amend ? "amend" : "commit"}
          </button>
        </>
      }
    >
      {error ? (
        <div className="gitdlg-error">{error}</div>
      ) : info === null ? (
        <div className="gitdlg-note">reading the repository…</div>
      ) : (
        <>
          <div className="gitdlg-label">staged ({info.staged_total})</div>
          {info.staged.length > 0 && (
            <ul className="gitdlg-list gitdlg-staged" aria-label="staged files">
              {info.staged.map((f) => (
                <li key={f.path} className="gitdlg-row">
                  <span className={`gitdlg-code git-${f.code}`} title={CODE_WORD[f.code] ?? f.code}>{f.code}</span>
                  <span className="gitdlg-path">
                    {f.old_path ? `${f.old_path} → ${f.path}` : f.path}
                  </span>
                </li>
              ))}
              {more > 0 && <li className="gitdlg-note">…and {more} more</li>}
            </ul>
          )}
          {note && <div className="gitdlg-note">{note}</div>}
          {info.unstaged > 0 && (
            <div className="gitdlg-note">
              {info.unstaged} change{info.unstaged === 1 ? "" : "s"} not staged won't be in the commit
            </div>
          )}
          <textarea
            ref={textRef}
            className="gitdlg-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={opts.amend ? "empty keeps the current message" : "summary line\n\nmore detail (optional)"}
            aria-label="commit message"
            rows={6}
            spellCheck={false}
          />
        </>
      )}
    </Frame>
  );
}
