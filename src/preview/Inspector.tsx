import React, { useState, useEffect, useRef } from "react";
import type { FileRow, FileKind } from "../data";
import { fileStatExtended, gitFileInfo, setPermissions, type FileEntry, type FileStatExt, type GitFileInfo } from "../api";
import { basename, parentPath } from "../paths";
import { formatDate, fullName, tagColor } from "../components";
import { dialogs } from "../dialogs/DialogHost";
import { isCancelled } from "../ops";
import { modeOctal, modeString, permBit, toggleBit } from "../octal";
import { IS_WINDOWS } from "../platform";
import { checksumsFor, type Checksums } from "./checksums";
import { AUDIO_EXTS, FilePreview } from "./FilePreview";
import { errText } from "../errors";

// ============= Inspector =============
export interface InspectableFile extends FileRow {
  entry: FileEntry;
}

export interface InspectorProps {
  file: InspectableFile | null;
  onQuickAction?: (action: "run" | "copy-path" | "open-in-code" | "git-blame" | "compress") => void;
  /** Open the Quick Look overlay for the inspected file (expand button). */
  onExpand?: () => void;
}

function mimeGuess(kind: FileKind, ext: string): string {
  if (ext === "pdf") return "application/pdf";
  if (AUDIO_EXTS.has(ext)) {
    if (ext === "mp3") return "audio/mpeg";
    if (ext === "wav") return "audio/wav";
    if (ext === "flac") return "audio/flac";
    if (ext === "m4a") return "audio/mp4";
    return "audio/ogg";
  }
  if (kind === "img") {
    if (ext === "svg") return "image/svg+xml";
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    return "image/*";
  }
  if (kind === "code") {
    if (ext === "rs") return "text/x-rust";
    if (ext === "py") return "text/x-python";
    if (ext === "ts" || ext === "tsx") return "text/typescript";
    if (ext === "js" || ext === "jsx") return "text/javascript";
    return "text/plain";
  }
  if (kind === "archive") return "application/octet-stream";
  if (kind === "exec") return "application/x-executable";
  if (kind === "folder") return "inode/directory";
  return "text/plain";
}

const PERM_ROWS = [
  { label: "read", glyph: "r" },
  { label: "write", glyph: "w" },
  { label: "exec", glyph: "x" },
];
const PERM_COLS = ["owner", "group", "world"];
const LINK = { color: "var(--accent)", cursor: "pointer" } as const;

async function applyPermissions(path: string, mode: number, onChanged: () => void): Promise<void> {
  try {
    await setPermissions(path, mode);
  } catch (e) {
    void dialogs.showAlert({ title: "couldn't change permissions", variant: "error", message: errText(e) });
  } finally {
    // Read the mode back either way, so the Inspector shows what's on disk.
    onChanged();
  }
}

interface PermissionsProps {
  path: string;
  /** How the confirm names the file. */
  name: string;
  /** Called after a change, applied or not, to read the mode again. */
  onChanged: () => void;
}

/** The unix permission grid, showing the file's real mode. "edit" starts a
 *  draft that clicks change; "apply" confirms the old and new mode, then
 *  runs chmod. The Inspector keys it by path, so a draft never carries over
 *  to another file. `mode` is undefined while it loads and null when it
 *  can't be read. */
export function PermissionsGrid({ path, name, mode, onChanged }: PermissionsProps & { mode: number | null | undefined }) {
  const [draft, setDraft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft ?? mode ?? null;
  const editing = draft !== null;

  const apply = async () => {
    if (draft === null || mode == null || busy) return;
    if (draft === mode) { setDraft(null); return; }
    const ok = await dialogs.showConfirm({
      title: "change permissions",
      message:
        `Change the permissions of ${name}?\n\n` +
        `now  ${modeString(mode)}  ${modeOctal(mode)}\nnew  ${modeString(draft)}  ${modeOctal(draft)}`,
      okLabel: "apply",
    });
    if (!ok) return;
    setBusy(true);
    await applyPermissions(path, draft, onChanged);
    setBusy(false);
    setDraft(null);
  };

  return (
    <div className="insp-section">
      <h4>PERMISSIONS{" "}
        {mode != null && !editing && <span role="button" style={LINK} onClick={() => setDraft(mode)}>edit</span>}
        {editing && (
          <span style={{display:"inline-flex", gap:10}}>
            <span role="button" style={LINK} onClick={() => void apply()}>{busy ? "applying…" : "apply"}</span>
            <span role="button" style={{ ...LINK, color: "var(--fg-3)" }} onClick={() => setDraft(null)}>cancel</span>
          </span>
        )}
      </h4>
      <div style={{fontFamily:"var(--font-mono)", color:"var(--fg-0)", marginBottom:6}}>
        {shown === null
          ? <span style={{color:"var(--fg-3)"}}>{mode === undefined ? "…" : "—"}</span>
          : <>
              <span>{modeString(shown)}</span> <span style={{color:"var(--fg-3)"}}>{modeOctal(shown)}</span>
              {editing && mode != null && draft !== mode && (
                <span style={{color:"var(--fg-3)"}}> · now {modeOctal(mode)}</span>
              )}
            </>}
      </div>
      {shown !== null && (
        <div className="perm-grid">
          <div></div><div className="h">owner</div><div className="h">group</div><div className="h">world</div>
          {PERM_ROWS.map((row, ri) => (
            <React.Fragment key={row.label}>
              <div className="h" style={{textAlign:"right"}}>{row.label}</div>
              {PERM_COLS.map((col, ci) => {
                const on = (shown & permBit(ci, ri)) !== 0;
                return (
                  <div
                    key={col}
                    className={"perm-cell" + (on ? "" : " off")}
                    style={{cursor: editing ? "pointer" : "default", userSelect:"none"}}
                    onClick={editing ? () => setDraft(d => (d === null ? d : toggleBit(d, ci, ri))) : undefined}
                    title={editing ? `${row.label} for ${col}: click to toggle` : `${row.label} for ${col}`}
                  >{on ? row.glyph : "—"}</div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Windows has no mode bits to show, only the read-only attribute.
 *  `readonly` is undefined while it loads and null when it can't be read. */
export function ReadOnlyLine({ path, name, readonly, onChanged }: PermissionsProps & { readonly: boolean | null | undefined }) {
  const toggle = async () => {
    if (readonly == null) return;
    const action = readonly ? "make writable" : "make read-only";
    const ok = await dialogs.showConfirm({
      title: "change permissions",
      message: readonly ? `Make ${name} writable?` : `Make ${name} read-only?`,
      okLabel: action,
    });
    // set_permissions reads only the owner-write bit on Windows.
    if (ok) await applyPermissions(path, readonly ? 0o200 : 0, onChanged);
  };
  return (
    <div className="insp-section">
      <h4>PERMISSIONS{" "}
        {readonly != null && (
          <span role="button" style={LINK} onClick={() => void toggle()}>{readonly ? "make writable" : "make read-only"}</span>
        )}
      </h4>
      <dl className="kv">
        <dt>read-only</dt><dd>{readonly === undefined ? "…" : readonly === null ? "—" : readonly ? "yes" : "no"}</dd>
      </dl>
    </div>
  );
}

export function Inspector({ file, onQuickAction, onExpand }: InspectorProps) {
  // Each result remembers its file and shows only while that file is the
  // inspected one, so nothing lands on the next file.
  const [sums, setSums] = useState<Checksums | null>(null);
  const [hashingPath, setHashingPath] = useState<string | null>(null);
  const [stat, setStat] = useState<{ path: string; ext: FileStatExt | null } | null>(null);
  const [statTick, setStatTick] = useState(0);
  const [gitFile, setGitFile] = useState<GitFileInfo | null>(null);
  const inspected = useRef<string | undefined>(undefined);
  useEffect(() => { inspected.current = file?.entry.path; }, [file?.entry.path]);

  // Debounce both backend fetches so rapid arrow/click navigation doesn't
  // queue up one IPC + subprocess per row. 150ms is imperceptible when you
  // land on a file but discards intermediate selections during a flurry.
  // `statTick` reads the stat again after a permission change.
  useEffect(() => {
    setStat(null);
    if (!file) return;
    const p = file.entry.path;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const s = await fileStatExtended(p);
        if (!cancelled) setStat({ path: p, ext: s });
      })();
    }, 150);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [file?.entry.path, statTick]);

  useEffect(() => {
    setGitFile(null);
    if (!file) return;
    const parent = parentPath(file.entry.path);
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const g = await gitFileInfo(parent, file.entry.path);
        if (!cancelled) setGitFile(g);
      })();
    }, 150);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [file?.entry.path]);

  const computeHash = () => {
    if (!file) return;
    if (file.kind === "folder") return;
    const p = file.entry.path;
    if (hashingPath === p) return;
    setHashingPath(p);
    void (async () => {
      try {
        const got = await checksumsFor(p, () => inspected.current);
        if (got) setSums(got);
      } catch (err) {
        if (isCancelled(err)) return;
        const msg = errText(err);
        console.error("hash compute:", msg);
        void dialogs.showAlert({ title: "hash failed", variant: "error", message: `${basename(p)}: ${msg}` });
      } finally {
        setHashingPath(cur => (cur === p ? null : cur));
      }
    })();
  };

  if (!file) {
    return (
      <aside className="inspector">
        <div className="insp-hero">
          <div className="insp-preview"><div className="ghost">no selection</div></div>
          <div className="insp-title">—</div>
          <div className="insp-path">—</div>
        </div>
      </aside>
    );
  }

  const f = file;
  const displayName = fullName(f);
  const statLoaded = stat?.path === f.entry.path;
  const statExt = statLoaded ? stat.ext : null;
  const restat = () => setStatTick(t => t + 1);
  const shownSums = sums?.path === f.entry.path ? sums : null;
  const sha256 = shownSums?.sha256 ?? null;
  const md5 = shownSums?.md5 ?? null;
  const crc32 = shownSums?.crc32 ?? null;
  const hashing = hashingPath === f.entry.path;
  const mime = mimeGuess(f.kind, f.ext);
  const createdStr = formatDate(statExt?.created_ms ?? null);
  const ownerStr = statExt?.owner ?? "—";
  const inodeStr = statExt?.file_index != null ? String(statExt.file_index) : "—";
  const diffStr =
    gitFile && (gitFile.added > 0 || gitFile.removed > 0)
      ? `+${gitFile.added} −${gitFile.removed}`
      : gitFile && gitFile.sha
        ? "clean"
        : "—";

  return (
    <aside className="inspector">
      <div className="insp-hero">
        <div className="insp-preview">
          <FilePreview file={f} onExpand={onExpand} />
        </div>
        <div className="insp-title">{displayName}</div>
        <div className="insp-path">{f.entry.path}</div>
        <div>
          {f.tag && <span className="chip"><span className="dot" style={{background: tagColor(f.tag)}}></span>{f.tag}</span>}
          <span className="chip">{f.kind}</span>
          {f.git && <span className="chip" style={{color: f.git === "M" ? "var(--yellow)" : f.git === "A" ? "var(--green)" : f.git === "D" || f.git === "U" ? "var(--red)" : "var(--fg-2)"}}>
            git: {f.git}
          </span>}
        </div>
      </div>

      <div className="insp-section">
        <h4>METADATA</h4>
        <dl className="kv">
          <dt>size</dt><dd>{f.size}</dd>
          <dt>modified</dt><dd>{f.date}</dd>
          <dt>created</dt><dd>{createdStr}</dd>
          <dt>owner</dt><dd title={ownerStr}>{ownerStr}</dd>
          <dt>inode</dt><dd className="mono">{inodeStr}</dd>
          <dt>mime</dt><dd className="mono">{mime}</dd>
          {statExt?.is_symlink && statExt.symlink_target && (
            <>
              <dt>→ target</dt>
              <dd className="mono" style={{fontSize:10, wordBreak:"break-all"}} title={statExt.symlink_target}>
                {statExt.symlink_target}
              </dd>
            </>
          )}
        </dl>
      </div>

      {IS_WINDOWS ? (
        <ReadOnlyLine
          key={f.entry.path}
          path={f.entry.path}
          name={displayName}
          readonly={statLoaded ? (statExt?.readonly ?? null) : undefined}
          onChanged={restat}
        />
      ) : (
        <PermissionsGrid
          key={f.entry.path}
          path={f.entry.path}
          name={statExt?.is_symlink ? `the file the link ${displayName} points to` : displayName}
          mode={statLoaded ? (statExt?.mode ?? null) : undefined}
          onChanged={restat}
        />
      )}

      <div className="insp-section">
        <h4>CHECKSUMS {sha256 && (
          <span
            style={{color:"var(--accent)", cursor:"pointer"}}
            onClick={() => { try { void navigator.clipboard.writeText(sha256); } catch { /* clipboard unavailable */ } }}
          >copy</span>
        )}</h4>
        <dl className="kv">
          <dt>sha256</dt>
          <dd
            className="mono"
            style={{fontSize:10, wordBreak:"break-all"}}
            title={sha256 ?? undefined}
          >
            {hashing ? "…" : (sha256 ?? "—")}
          </dd>
          <dt>md5</dt>
          <dd className="mono" style={{fontSize:10, wordBreak:"break-all"}} title={md5 ?? undefined}>
            {hashing ? "…" : (md5 ?? "—")}
          </dd>
          <dt>crc32</dt>
          <dd className="mono" title={crc32 ?? undefined}>
            {hashing ? "…" : (crc32 ?? "—")}
          </dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>GIT {f.git ? <span style={{color:"var(--orange)"}}>{f.git}</span> : <span style={{color:"var(--fg-3)"}}>—</span>}</h4>
        <dl className="kv">
          <dt>last commit</dt><dd>{gitFile?.last_commit_ago ?? "—"}</dd>
          <dt>author</dt><dd>{gitFile?.author ?? "—"}</dd>
          <dt>sha</dt><dd className="mono">{gitFile?.sha ?? "—"}</dd>
          <dt>diff</dt><dd>{diffStr}</dd>
        </dl>
      </div>

      <div className="insp-section">
        <h4>QUICK ACTIONS</h4>
        <div style={{display:"flex", flexWrap:"wrap", gap:4}}>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("run")}>▶ run</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("open-in-code")}>⌨ open in code</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("git-blame")}>⎇ git blame</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("copy-path")}>⌘ copy path</span>
          <span className="chip" style={{cursor:"pointer"}} onClick={() => onQuickAction?.("compress")}>◫ compress</span>
          <span
            className="chip"
            style={{cursor: hashing ? "progress" : "pointer", opacity: hashing ? 0.6 : 1}}
            onClick={computeHash}
          ># hash</span>
        </div>
      </div>
    </aside>
  );
}
