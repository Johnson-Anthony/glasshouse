// The open or save dialog another app asked for through xdg-desktop-portal
// (src-tauri/src/portal.rs starts this window; chooser.rs answers for it).
// The main window's pieces: Toolbar (back/forward/up, breadcrumbs, the
// filter box, hidden files), Sidebar and FilePane, plus a bottom bar with
// the name or location field, the app's filters and choices, Cancel and the
// accept button. Enter and double-click accept, Esc cancels, a path typed in
// the field goes there, and Enter in the filter box searches subfolders.
// The decisions are in chooserLogic.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilePane, Toolbar } from "../components";
import { Sidebar } from "../Sidebar";
import { useTabState } from "../state";
import { DialogHost, dialogs } from "../dialogs/DialogHost";
import { isModalOpen } from "../dialogs/modal";
import {
  cancelOp,
  chooserFinish,
  chooserPainted,
  chooserReady,
  chooserSearch,
  makeDir,
  pathKind,
  readPins,
  writePins,
  type ChooserView,
  type FileEntry,
} from "../api";
import { loadTags, useTags } from "../tags";
import { pathOps } from "../paths";
import { IS_WINDOWS } from "../platform";
import { entryToRow } from "../rows";
import { errText } from "../errors";
import { isCancelled, newOpId } from "../ops";
import * as L from "./chooserLogic";

const ops = pathOps(IS_WINDOWS);

export interface ChooserSettings {
  hidden: boolean;
  showExtensions: boolean;
  foldersFirst: boolean;
  showSidebar: boolean;
}

interface Props {
  view: ChooserView;
  home: string | null;
  settings: ChooserSettings;
}

export function Chooser({ view, home, settings }: Props) {
  const req = view.request;
  const saving = req.kind === "save";
  const folders = req.directory || req.kind === "saveFiles";
  const start = useMemo(() => L.startFolder(req, L.lastFolder(req.appId), home, ops), [req, home]);
  const tab = useTabState(start, false, true);
  const { state: ts, actions: ta } = tab;

  const [showHidden, setShowHidden] = useState(settings.hidden);
  useEffect(() => { if (ts.showHidden !== showHidden) ta.setShowHidden(showHidden); }, [showHidden, ts.showHidden, ta]);

  const [filterIndex, setFilterIndex] = useState<number | null>(
    req.currentFilter ?? (req.filters.length > 0 ? 0 : null),
  );
  const matches = useMemo(
    () => L.filterMatcher(filterIndex === null ? undefined : view.globs[filterIndex]),
    [filterIndex, view.globs],
  );
  const [name, setName] = useState(() => L.startName(req, ops));
  const [choices, setChoices] = useState(() => L.startChoices(req));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Search in subfolders: the matches replace the folder's rows until the
  // filter box is cleared or the folder changes.
  const [results, setResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchOp = useRef<string | null>(null);
  const stopSearch = useCallback(() => {
    if (searchOp.current) void cancelOp(searchOp.current);
    searchOp.current = null;
    setSearching(false);
  }, []);
  useEffect(() => { stopSearch(); setResults(null); }, [ts.path, stopSearch]);
  useEffect(() => { if (!ts.searchQuery.trim()) { stopSearch(); setResults(null); } }, [ts.searchQuery, stopSearch]);
  const searchSubfolders = () => {
    const q = ts.searchQuery.trim();
    if (!q) return;
    stopSearch();
    const op = newOpId();
    searchOp.current = op;
    setSearching(true);
    chooserSearch(ts.path, q, showHidden, op)
      .then(found => {
        if (searchOp.current !== op) return;
        const base = ts.path;
        // Shown by their path under the folder searched.
        setResults(found.map(e => ({ ...e, name: relativeTo(base, e.path) })));
      })
      .catch(e => { if (!isCancelled(e)) setProblem(`search: ${errText(e)}`); })
      .finally(() => { if (searchOp.current === op) { searchOp.current = null; setSearching(false); } });
  };

  const tags = useTags();
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => { void readPins().then(setPins); void loadTags(); }, []);

  // The rows: every folder, and the files the filter passes. The selection
  // is the dialog's own, by index into these rows.
  const entries = useMemo(
    () => L.shownEntries(results ?? ts.entries, folders, matches),
    [results, ts.entries, folders, matches],
  );
  const rows = useMemo(() => entries.map(e => entryToRow(e, tags)), [entries, tags]);
  const [selected, setSelected] = useState<number[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [paneFocused, setPaneFocused] = useState(!saving);
  useEffect(() => { setSelected([]); setFocusIndex(0); setAnchorIndex(0); }, [entries]);
  const picked = selected.map(i => entries[i]).filter((e): e is FileEntry => !!e);

  // Picking one file while saving takes its name, as other dialogs do.
  const pickedKey = picked.map(e => e.path).join("\n");
  useEffect(() => {
    if (!saving || picked.length !== 1 || picked[0].kind === "folder") return;
    setName(picked[0].name);
    setProblem(null);
    // Only when the pick changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey]);

  // ---------- answering ----------

  const finished = useRef(false);
  const finish = async (response: number, paths: string[] = [], folder?: string) => {
    if (finished.current) return;
    finished.current = true;
    if (response === 0 && folder) L.rememberFolder(req.appId, folder);
    try {
      await chooserFinish({
        response,
        paths,
        choices: Object.entries(choices),
        currentFilter: filterIndex,
      });
    } catch (e) {
      finished.current = false;
      setProblem(errText(e));
    }
  };
  const cancel = () => { void finish(1); };

  /** Asks before replacing `existing` (paths that are files). */
  const confirmReplace = async (existing: string[]): Promise<boolean> => {
    if (existing.length === 0) return true;
    const names = existing.map(p => ops.basename(p));
    const message = existing.length === 1
      ? `“${names[0]}” already exists in “${ops.parentPath(existing[0])}”. Replacing it overwrites what's in it.`
      : `${existing.length} of these files already exist: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}. Replacing them overwrites what's in them.`;
    return dialogs.showConfirm({
      title: existing.length === 1 ? "replace the file?" : "replace the files?",
      message,
      okLabel: "replace",
      danger: true,
    });
  };

  /** A typed path that names a folder: go there. True when it did. */
  const goIfFolder = async (path: string): Promise<boolean> => {
    if ((await pathKind(path)) !== "folder") return false;
    ta.goTo(path);
    setName("");
    return true;
  };

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      if (req.kind === "save") await acceptSave();
      else if (req.kind === "saveFiles") await acceptSaveFiles();
      else await acceptOpen();
    } finally {
      setBusy(false);
    }
  };

  const acceptOpen = async () => {
    const typed = L.readTypedName(name, ts.path, home, IS_WINDOWS);
    if (typed.kind === "error") return setProblem(typed.message);
    if (typed.kind !== "empty") {
      const path = typed.kind === "path" ? typed.path : ops.joinPath(ts.path, typed.name);
      const kind = await pathKind(path);
      if (kind === null) return setProblem(`nothing is at ${path}`);
      if (kind === "folder" && !req.directory) { ta.goTo(path); setName(""); return; }
      if (kind === "folder" && typed.kind === "path" && typed.folderOnly) { ta.goTo(path); setName(""); return; }
      if (kind !== "folder" && req.directory) return setProblem(`${ops.basename(path)} isn't a folder`);
      return finish(0, [path], ops.parentPath(path));
    }
    const pick = L.openPick(picked, ts.path, req.directory, req.multiple);
    if (pick.kind === "enter") { ta.goTo(pick.path); return; }
    if (pick.kind === "none") return setProblem(req.directory ? "pick a folder" : "pick a file");
    return finish(0, pick.paths, ts.path);
  };

  const acceptSave = async () => {
    const typed = L.readTypedName(name, ts.path, home, IS_WINDOWS);
    if (typed.kind === "error") return setProblem(typed.message);
    if (typed.kind === "empty") return setProblem("type a name");
    let target: string;
    if (typed.kind === "path") {
      if (await goIfFolder(typed.path)) return;
      if (typed.folderOnly) return setProblem(`no folder at ${typed.path}`);
      const folder = ops.parentPath(typed.path);
      if ((await pathKind(folder)) !== "folder") return setProblem(`no folder at ${folder}`);
      target = typed.path;
    } else {
      const bad = L.badSaveName(typed.name);
      if (bad) return setProblem(bad);
      target = ops.joinPath(ts.path, typed.name);
    }
    const kind = await pathKind(target);
    if (kind === "folder") { ta.goTo(target); setName(""); return; }
    if (kind !== null && !(await confirmReplace([target]))) return;
    return finish(0, [target], ops.parentPath(target));
  };

  const acceptSaveFiles = async () => {
    let folder = ts.path;
    const typed = L.readTypedName(name, ts.path, home, IS_WINDOWS);
    if (typed.kind === "error") return setProblem(typed.message);
    if (typed.kind !== "empty") {
      const path = typed.kind === "path" ? typed.path : ops.joinPath(ts.path, typed.name);
      if ((await pathKind(path)) !== "folder") return setProblem(`no folder at ${path}`);
      folder = path;
    } else {
      const pickedFolders = picked.filter(e => e.kind === "folder");
      if (pickedFolders.length === 1) folder = pickedFolders[0].path;
    }
    const targets = L.saveFilesTargets(folder, req.files, ops);
    const kinds = await Promise.all(targets.map(t => pathKind(t)));
    const blocked = targets.filter((_, i) => kinds[i] === "folder");
    if (blocked.length > 0) return setProblem(`a folder has that name: ${blocked.map(b => ops.basename(b)).join(", ")}`);
    if (!(await confirmReplace(targets.filter((_, i) => kinds[i] !== null)))) return;
    return finish(0, targets, folder);
  };

  /** Enter or double-click on a row: a folder opens, a file is the pick. */
  const activate = (i: number) => {
    const e = entries[i];
    if (!e) return;
    if (e.kind === "folder") { ta.goTo(e.path); return; }
    if (folders) return;
    if (saving) {
      setName(e.name);
      void (async () => {
        if (await confirmReplace([e.path])) void finish(0, [e.path], ops.parentPath(e.path));
      })();
      return;
    }
    const inPick = selected.includes(i) && req.multiple;
    const paths = inPick ? picked.filter(p => p.kind !== "folder").map(p => p.path) : [e.path];
    void finish(0, paths, ops.parentPath(e.path));
  };

  const newFolder = async () => {
    const made = await dialogs.showPrompt({
      title: "new folder",
      message: `in ${ts.path}`,
      okLabel: "create",
      validate: v => L.badSaveName(v),
    });
    if (!made) return;
    const path = ops.joinPath(ts.path, made);
    try {
      await makeDir(path);
      ta.goTo(path);
    } catch (e) {
      setProblem(errText(e));
    }
  };

  const changeFilter = (next: number | null) => {
    if (saving) {
      setName(n => L.swapExtension(n, matches, next === null ? undefined : view.globs[next]));
    }
    setFilterIndex(next);
  };

  // ---------- keys, focus, showing the window ----------

  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isModalOpen()) return;
    const target = e.target as HTMLElement | null;
    const inField = !!target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === "Enter" && target === searchRef.current) {
      e.preventDefault();
      searchSubfolders();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "l") {
      e.preventDefault();
      nameRef.current?.focus();
      nameRef.current?.select();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "h") {
      e.preventDefault();
      setShowHidden(v => !v);
      return;
    }
    if (inField) return;
    if ((ctrl && e.key.toLowerCase() === "f") || e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); ta.back(); return; }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); ta.forward(); return; }
    if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); ta.up(); return; }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Shown once rendered; the time to the first frame with the folder listed
  // is logged by the backend.
  useEffect(() => {
    void chooserReady();
    if (saving) {
      const el = nameRef.current;
      if (el) {
        el.focus();
        const dot = el.value.lastIndexOf(".");
        el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
      }
    }
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const painted = useRef(false);
  useEffect(() => {
    if (painted.current || ts.loading) return;
    painted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { void chooserPainted(); }));
  }, [ts.loading]);

  // ---------- the window ----------

  const label = L.acceptLabel(req);
  const fieldLabel = saving ? "name" : "location";
  const hint = saving ? "a name, or a path to save at"
    : req.kind === "saveFiles" ? "a folder to save in (or pick one)"
    : "a path to open, or pick below";
  const shownFilter = filterIndex === null ? null : req.filters[filterIndex];

  return (
    <div className={"chooser" + (settings.showSidebar ? "" : " no-sidebar")}>
      <Toolbar
        path={ts.path}
        gitInfo={null}
        canBack={ts.historyBack.length > 0}
        canForward={ts.historyForward.length > 0}
        onBack={() => ta.back()}
        onForward={() => ta.forward()}
        onUp={() => ta.up()}
        onRefresh={() => ta.refresh()}
        onGoTo={p => ta.goTo(p)}
        searchQuery={ts.searchQuery}
        onSearchChange={q => ta.setSearchQuery(q)}
        searchInputRef={searchRef}
        showHidden={showHidden}
        onToggleHidden={() => setShowHidden(v => !v)}
        showInspector={false}
      />
      {(results || searching || ts.searchQuery.trim()) && (
        <div className="chooser-strip" role="status">
          {searching ? <>searching subfolders of {ts.path}… <button type="button" onClick={stopSearch}>stop</button></>
            : results ? <>{results.length === 0 ? "nothing" : results.length} found under {ts.path}{shownFilter ? ` (${shownFilter.name})` : ""} <button type="button" onClick={() => { setResults(null); }}>back to the folder</button></>
            : <>filtering this folder · <button type="button" onClick={searchSubfolders}>search subfolders</button> (Enter)</>}
        </div>
      )}
      <div className="chooser-body">
        {settings.showSidebar && (
          <Sidebar
            activePath={ts.path}
            onGoTo={p => ta.goTo(p)}
            onOpenFile={p => {
              if (folders) { ta.goTo(ops.parentPath(p)); return; }
              if (saving) { ta.goTo(ops.parentPath(p)); setName(ops.basename(p)); return; }
              void finish(0, [p], ops.parentPath(p));
            }}
            pins={pins}
            onAddPin={() => {
              if (!ts.path || pins.includes(ts.path)) return;
              const next = [...pins, ts.path];
              setPins(next);
              void writePins(next).catch(e => setProblem(errText(e)));
            }}
            tags={tags}
            savedRemotes={[]}
            onOpenConnectDialog={() => dialogs.showToast({ message: "remote servers are set up in the glasshouse window", variant: "info" })}
            onRemoteClick={() => {}}
            onActivate={() => setPaneFocused(false)}
          />
        )}
        <FilePane
          files={rows}
          selected={selected}
          setSelected={sel => setSelected(req.multiple || saving || sel.length <= 1 ? sel : sel.slice(-1))}
          focusIndex={focusIndex}
          setFocusIndex={setFocusIndex}
          anchorIndex={anchorIndex}
          setAnchorIndex={setAnchorIndex}
          paneFocused={paneFocused}
          setPaneFocused={setPaneFocused}
          sortKey={ts.sortKey}
          sortDir={ts.sortDir}
          onSortChange={k => {
            if (ts.sortKey === k) ta.setSortDir(ts.sortDir === "asc" ? "desc" : "asc");
            else { ta.setSortKey(k); ta.setSortDir("asc"); }
          }}
          foldersFirst={settings.foldersFirst}
          showExtensions={settings.showExtensions}
          showGitGutters={false}
          onContext={() => {}}
          onOpen={activate}
          onUp={() => ta.up()}
          searchQuery={results ? "" : ts.searchQuery}
          tagStore={tags}
          error={results ? null : ts.error}
          loading={!results && ts.loading}
          onActivate={() => setPaneFocused(true)}
        />
      </div>
      <form
        className="chooser-bar"
        onSubmit={e => { e.preventDefault(); void accept(); }}
      >
        <div className="chooser-row">
          <label className="chooser-field">
            <span>{fieldLabel}</span>
            <input
              ref={nameRef}
              value={name}
              placeholder={hint}
              spellCheck={false}
              aria-label={fieldLabel}
              onChange={e => { setName(e.target.value); setProblem(null); }}
              onFocus={() => setPaneFocused(false)}
            />
          </label>
          {req.kind === "saveFiles" && (
            <span className="chooser-files" title={req.files.join("\n")}>
              saving {req.files.length === 1 ? req.files[0] : `${req.files.length} files: ${req.files.slice(0, 3).join(", ")}${req.files.length > 3 ? "…" : ""}`}
            </span>
          )}
        </div>
        <div className="chooser-row">
          {req.filters.length > 0 && (
            <label className="chooser-choice">
              <span>type</span>
              <select
                value={filterIndex ?? ""}
                aria-label="file type"
                onChange={e => changeFilter(e.target.value === "" ? null : Number(e.target.value))}
              >
                {req.filters.map((f, i) => <option key={i} value={i}>{f.name}</option>)}
              </select>
            </label>
          )}
          {req.choices.map(c => c.options.length === 0 ? (
            <label key={c.id} className="chooser-choice">
              <input
                type="checkbox"
                checked={choices[c.id] === "true"}
                onChange={e => setChoices(v => ({ ...v, [c.id]: e.target.checked ? "true" : "false" }))}
              />
              <span>{L.plainLabel(c.label)}</span>
            </label>
          ) : (
            <label key={c.id} className="chooser-choice">
              <span>{L.plainLabel(c.label)}</span>
              <select
                value={choices[c.id]}
                aria-label={L.plainLabel(c.label)}
                onChange={e => setChoices(v => ({ ...v, [c.id]: e.target.value }))}
              >
                {c.options.map(([id, text]) => <option key={id} value={id}>{L.plainLabel(text)}</option>)}
              </select>
            </label>
          ))}
          {(saving || folders) && <button type="button" onClick={() => void newFolder()}>new folder</button>}
          <span className="chooser-problem" role="alert">{problem}</span>
          <button type="button" onClick={cancel}>cancel</button>
          <button type="submit" className="primary" disabled={busy}>{label}</button>
        </div>
      </form>
      <DialogHost />
    </div>
  );
}

/** `path` as it reads under `base` (search results). */
function relativeTo(base: string, path: string): string {
  const root = base.replace(/[\\/]+$/, "");
  const sep = IS_WINDOWS ? /^[\\/]/ : /^\//;
  const same = IS_WINDOWS ? path.toLowerCase().startsWith(root.toLowerCase()) : path.startsWith(root);
  return same && sep.test(path.slice(root.length)) ? path.slice(root.length + 1) : path;
}
