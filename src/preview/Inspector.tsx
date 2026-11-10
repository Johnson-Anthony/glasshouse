import React, { useState, useEffect } from "react";
import type { FileRow, FileKind } from "../data";
import { fileStatExtended, gitFileInfo, hashCrc32, hashMd5, hashSha256, setPermissions, type FileEntry, type FileStatExt, type GitFileInfo } from "../api";
import { parentPath } from "../paths";
import { tagColor } from "../components";
import { dialogs } from "../dialogs/DialogHost";
import { isCancelled, runOp } from "../ops";
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

function PermissionsGrid({ path }: { path?: string }) {
  // 3 rows (read/write/exec) × 3 cols (owner/group/world). Clicks persist via
  // set_permissions backend when `path` is present; on Windows only the
  // owner-write bit is meaningful (toggles read-only), so other cells still
  // flip visually but won't round-trip.
  const [perms, setPerms] = useState<boolean[][]>([
    [true, true, false],
    [true, false, false],
    [true, false, false],
  ]);
  const rows: Array<{ label: string; glyph: string }> = [
    { label: "read",  glyph: "r" },
    { label: "write", glyph: "w" },
    { label: "exec",  glyph: "x" },
  ];
  const cols = ["owner", "group", "world"];
  const toggle = (r: number, c: number) => {
    setPerms(prev => {
      const next = prev.map((row, ri) =>
        ri === r ? row.map((v, ci) => (ci === c ? !v : v)) : row
      );
      if (path) {
        const mode = [0, 1, 2].reduce((acc, col) =>
          acc + ((next[0][col] ? 4 : 0) + (next[1][col] ? 2 : 0) + (next[2][col] ? 1 : 0)) * (col === 0 ? 64 : col === 1 ? 8 : 1),
        0);
        void setPermissions(path, mode).catch((e: unknown) => {
          console.log(`[inspector] chmod failed for ${path}:`, e);
        });
      } else {
        console.log(`[inspector] perm toggle ${rows[r].label}-${cols[c]} — no active path`);
      }
      return next;
    });
  };
  const octalFixed = cols
    .map((_, c) => (perms[0][c] ? 4 : 0) + (perms[1][c] ? 2 : 0) + (perms[2][c] ? 1 : 0))
    .join("");
  const rwxStr = cols
    .map((_, c) => (perms[0][c] ? "r" : "-") + (perms[1][c] ? "w" : "-") + (perms[2][c] ? "x" : "-"))
    .join("");
  return (
    <div className="insp-section">
      <h4>PERMISSIONS <span style={{color:"var(--accent)", cursor:"pointer"}}>edit</span></h4>
      <div style={{fontFamily:"var(--font-mono)", color:"var(--fg-0)", marginBottom:6}}>
        <span>{rwxStr}</span> <span style={{color:"var(--fg-3)"}}>0{octalFixed}</span>
      </div>
      <div className="perm-grid">
        <div></div><div className="h">owner</div><div className="h">group</div><div className="h">world</div>
        {rows.map((row, ri) => (
          <React.Fragment key={row.label}>
            <div className="h" style={{textAlign:"right"}}>{row.label}</div>
            {cols.map((col, ci) => {
              const on = perms[ri][ci];
              return (
                <div
                  key={col}
                  className={"perm-cell" + (on ? "" : " off")}
                  style={{cursor:"pointer", userSelect:"none"}}
                  onClick={() => toggle(ri, ci)}
                  title={`${row.label} ${col} — click to toggle`}
                >{on ? row.glyph : "—"}</div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function Inspector({ file, onQuickAction, onExpand }: InspectorProps) {
  const [sha256, setSha256] = useState<string | null>(null);
  const [md5, setMd5] = useState<string | null>(null);
  const [crc32, setCrc32] = useState<string | null>(null);
  const [hashing, setHashing] = useState<boolean>(false);
  const [statExt, setStatExt] = useState<FileStatExt | null>(null);
  const [gitFile, setGitFile] = useState<GitFileInfo | null>(null);

  // Reset cached hash whenever the inspected path changes — stale digests for
  // a different file would be worse than showing "—".
  useEffect(() => {
    setSha256(null);
    setMd5(null);
    setCrc32(null);
    setHashing(false);
  }, [file?.entry.path]);

  // Debounce both backend fetches so rapid arrow/click navigation doesn't
  // queue up one IPC + subprocess per row. 150ms is imperceptible when you
  // land on a file but discards intermediate selections during a flurry.
  useEffect(() => {
    setStatExt(null);
    if (!file) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const s = await fileStatExtended(file.entry.path);
        if (!cancelled) setStatExt(s);
      })();
    }, 150);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [file?.entry.path]);

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
    setHashing(true);
    void (async () => {
      try {
        const p = file.entry.path;
        // Three reads of the same file: one row in the tray, one Cancel.
        const [shaHex, md5Hex, crcHex] = await runOp(`hashing ${file.entry.name}`, track =>
          Promise.all([hashSha256(p, track()), hashMd5(p, track()), hashCrc32(p, track())]));
        setSha256(shaHex);
        setMd5(md5Hex);
        setCrc32(crcHex);
      } catch (err) {
        if (isCancelled(err)) return;
        const msg = errText(err);
        console.error("hash compute:", msg);
        void dialogs.showAlert({ title: "hash failed", variant: "error", message: msg });
      } finally {
        setHashing(false);
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
  const displayName = f.ext && f.kind !== "folder" ? `${f.name}.${f.ext}` : f.name;
  const mime = mimeGuess(f.kind, f.ext);
  const fmtMs = (ms: number | null | undefined): string => {
    if (!ms) return "—";
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const createdStr = fmtMs(statExt?.created_ms ?? null);
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

      <PermissionsGrid path={file?.entry.path} />

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
