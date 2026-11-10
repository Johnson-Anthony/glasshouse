import React, { useState, useEffect, useRef, useMemo } from "react";
import type { FileKind } from "../data";
import { listDir, readHexDump, readImageB64, readText, type FileEntry } from "../api";
import { kindIcon } from "../components";
import type { InspectableFile } from "./Inspector";
import { errText } from "../errors";

// Heuristic: text-like if kind is text/code OR extension matches a plain-text
// family. Used so the preview can attempt to render small config files that
// the backend classifier missed (e.g. .env, .toml, unknown extensions).
const TEXT_EXT_FALLBACK = new Set([
  "txt","md","markdown","rst","log","json","yaml","yml","toml","ini","cfg",
  "conf","env","xml","svg","csv","tsv","html","htm","css","scss","less",
  "ts","tsx","js","jsx","mjs","cjs","py","rs","go","c","h","hpp","cpp","cc",
  "java","kt","swift","rb","php","sh","bash","zsh","fish","ps1","bat","cmd",
  "sql","graphql","gql","lua","r","jl","ex","exs","dart","scala","clj","hs",
  "ml","vim","gitignore","gitattributes","editorconfig","dockerfile",
]);

function looksBinary(s: string): boolean {
  if (!s) return false;
  // Rough heuristic: any NUL byte, or > 2% non-printable characters, is
  // almost certainly binary.
  if (s.indexOf("\0") >= 0) return true;
  let nonPrint = 0;
  const sample = s.slice(0, 2048);
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    // Allow TAB, LF, CR and printable range.
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c === 127) nonPrint++;
  }
  return nonPrint / Math.max(1, sample.length) > 0.02;
}

// Persist the text preview's scroll offset per-path so switching back to a
// file the user already skimmed restores their last position. Module-level
// state survives Inspector unmount; cleared only when the app reloads.
const previewScrollOffsets = new Map<string, number>();

// ============= File preview =============
// Type-aware renderer shared by the inspector card and the Quick Look overlay
// (`large`). Dispatch: folder → mini listing, image → bitmap on checkerboard,
// audio → native player, text/code → highlighted excerpt with a line-number
// gutter, anything else (or text that sniffs binary) → hex dump.

export const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a"]);

// Comment leaders per extension. Highlighting is line-local and preview-grade:
// block comments and comment-markers inside strings will miscolor — accepted
// so the preview stays dependency-free.
const LINE_COMMENTS: Record<string, string[]> = {
  js: ["//"], ts: ["//"], jsx: ["//"], tsx: ["//"], mjs: ["//"], cjs: ["//"],
  rs: ["//"], go: ["//"], c: ["//"], h: ["//"], cpp: ["//"], hpp: ["//"], cc: ["//"],
  java: ["//"], kt: ["//"], swift: ["//"], scala: ["//"], dart: ["//"],
  css: ["//"], scss: ["//"], less: ["//"], php: ["//", "#"],
  py: ["#"], sh: ["#"], bash: ["#"], zsh: ["#"], fish: ["#"], rb: ["#"], r: ["#"],
  yaml: ["#"], yml: ["#"], toml: ["#"], ini: ["#", ";"], cfg: ["#", ";"],
  conf: ["#"], env: ["#"], ps1: ["#"], jl: ["#"], ex: ["#"], exs: ["#"],
  gitignore: ["#"], gitattributes: ["#"], editorconfig: ["#"], dockerfile: ["#"],
  sql: ["--"], lua: ["--"], hs: ["--"],
  json: [], graphql: [], gql: [], html: [], htm: [], xml: [], svg: [],
};

const HL_KEYWORDS = new Set((
  "function const let var return if else elif for while do switch case break continue " +
  "class struct enum interface type extends implements import export from default new delete " +
  "this self super static public private protected readonly abstract async await yield " +
  "try catch except finally throw raise with as pass lambda def None True False null undefined " +
  "true false nil not and or in of is fn pub use mod impl trait dyn match loop move mut ref " +
  "where crate unsafe package func go defer chan map range void int float double char " +
  "bool string str usize isize u32 u64 i32 i64 f32 f64 echo local exit then fi esac done " +
  "declare source union typedef sizeof extern namespace using template typename operator " +
  "virtual override final require include"
).split(/\s+/));

function buildHlRegex(comments: string[]): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // NUL never appears in the sanitized text we preview, so langs without
  // line comments get a comment alternative that can't match.
  const com = comments.length ? comments.map(esc).join("|") : "\\u0000";
  return new RegExp(
    `((?:${com}).*)` +
    `|("(?:[^"\\\\]|\\\\.)*"?|'(?:[^'\\\\]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\.)*\`?)` +
    `|\\b(0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b` +
    `|\\b([A-Za-z_$][A-Za-z0-9_$]*)\\b`,
    "g",
  );
}

function highlightLine(line: string, re: RegExp): React.ReactNode {
  if (!line) return " ";
  if (line.length > 400) return line; // minified/generated — not worth tokenizing
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const [full, com, str, num, word] = m;
    if (com !== undefined) out.push(<span key={k++} className="tk-com">{com}</span>);
    else if (str !== undefined) out.push(<span key={k++} className="tk-str">{str}</span>);
    else if (num !== undefined) out.push(<span key={k++} className="tk-num">{num}</span>);
    else if (word !== undefined && HL_KEYWORDS.has(word)) out.push(<span key={k++} className="tk-kw">{word}</span>);
    else out.push(full);
    last = m.index + full.length;
    if (full.length === 0) re.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

// Line-level markdown styling (headings, quotes, fenced code, list markers) —
// no inline parsing, just enough to make a README scannable at a glance.
function mdLineClasses(lines: string[]): string[] {
  let inFence = false;
  return lines.map((ln) => {
    const t = ln.trimStart();
    if (t.startsWith("```") || t.startsWith("~~~")) { inFence = !inFence; return "md-fence"; }
    if (inFence) return "md-code";
    if (/^#{1,6}\s/.test(t)) return "md-h";
    if (t.startsWith(">")) return "md-quote";
    if (/^([-*+]\s|\d+[.)]\s)/.test(t)) return "md-li";
    return "";
  });
}

function TextPreview({ path, text, ext, large, wrap, truncated }: {
  path: string; text: string; ext: string; large: boolean; wrap: boolean; truncated: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const maxLines = large ? 4000 : 400;
  const { lines, mdCls, re, dropped } = useMemo(() => {
    const all = text.split(/\r?\n/);
    const lines = all.slice(0, maxLines);
    const extL = ext.toLowerCase();
    const isMd = extL === "md" || extL === "markdown";
    const mdCls = isMd ? mdLineClasses(lines) : null;
    const comments = LINE_COMMENTS[extL];
    const re = !isMd && comments !== undefined ? buildHlRegex(comments) : null;
    return { lines, mdCls, re, dropped: all.length - lines.length };
  }, [text, ext, maxLines]);

  // Card previews restore the user's last scroll position per path; the
  // overlay always opens at the top.
  useEffect(() => {
    if (large) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = previewScrollOffsets.get(path) ?? 0;
  }, [path, text, large]);
  const onScroll = () => {
    if (large) return;
    const el = scrollRef.current;
    if (el) previewScrollOffsets.set(path, el.scrollTop);
  };

  const gutter = `${String(lines.length).length + 2}ch`;
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={"pv-text" + (wrap ? " wrap" : "")}
      style={{ "--pv-gutter": gutter } as React.CSSProperties}
    >
      {lines.map((ln, i) => (
        <div key={i} className={"pv-line" + (mdCls && mdCls[i] ? " " + mdCls[i] : "")}>
          <span className="pv-ln">{i + 1}</span>
          <span className="pv-code">{re ? highlightLine(ln, re) : (ln || " ")}</span>
        </div>
      ))}
      {(truncated || dropped > 0) && (
        <div className="pv-trunc">… truncated{dropped > 0 ? ` — ${dropped} more lines` : ""}</div>
      )}
    </div>
  );
}

function HexPreview({ path, large }: { path: string; large: boolean }) {
  const [dump, setDump] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    setDump("");
    setErr("");
    let cancelled = false;
    void (async () => {
      try {
        const d = await readHexDump(path, 0, large ? 4096 : 512);
        if (!cancelled) setDump(d);
      } catch (e) {
        if (!cancelled) setErr(errText(e));
      }
    })();
    return () => { cancelled = true; };
  }, [path, large]);
  if (err) return <div className="ghost">can't read: {err}</div>;
  if (!dump) return <div className="ghost">reading…</div>;
  const rows = dump.replace(/\n$/, "").split("\n");
  return (
    <div className="pv-hex">
      {rows.map((r, i) => {
        const m = /^([0-9a-f]{8})  (.*?)  \|(.*)\|$/.exec(r);
        if (!m) return <div key={i}>{r}</div>;
        return (
          <div key={i}>
            <span className="off">{m[1]}</span>{"  "}{m[2]}{"  "}
            <span className="asc">{m[3]}</span>
          </div>
        );
      })}
    </div>
  );
}

function FolderPreview({ path, large }: { path: string; large: boolean }) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  useEffect(() => {
    setEntries(null);
    let cancelled = false;
    void (async () => {
      const es = await listDir(path, true);
      if (cancelled) return;
      const sorted = [...es].sort((a, b) =>
        (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || a.name.localeCompare(b.name),
      );
      setEntries(sorted);
    })();
    return () => { cancelled = true; };
  }, [path]);
  if (!entries) return <div className="ghost">reading…</div>;
  if (entries.length === 0) return <div className="ghost">empty folder</div>;
  const hidden = entries.filter((e) => e.hidden).length;
  const max = large ? 400 : 12;
  const shown = entries.slice(0, max);
  return (
    <div className="pv-folder">
      <div className="sum">
        {entries.length} item{entries.length === 1 ? "" : "s"}{hidden > 0 ? ` · ${hidden} hidden` : ""}
      </div>
      {shown.map((e) => {
        const ki = kindIcon(e.kind as FileKind);
        return (
          <div key={e.path} className="ent">
            <span className={"ic " + ki.cls}>{ki.ic}</span>
            <span className="nm">{e.name}</span>
          </div>
        );
      })}
      {entries.length > max && <div className="more">+{entries.length - max} more</div>}
    </div>
  );
}

// Lazy pdf.js loader — the library is ~1.4 MB, so it only loads (as its own
// Vite chunk) the first time a PDF is actually previewed.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // pdf.js 6 uses Promise.withResolvers (Safari 17.4+); polyfill for older
      // WebKitGTK so a missing builtin degrades to a working preview, not a throw.
      const P = Promise as PromiseConstructor & {
        withResolvers?: <T>() => {
          promise: Promise<T>;
          resolve: (v: T | PromiseLike<T>) => void;
          reject: (e?: unknown) => void;
        };
      };
      if (!P.withResolvers) {
        P.withResolvers = <T,>() => {
          let resolve!: (v: T | PromiseLike<T>) => void;
          let reject!: (e?: unknown) => void;
          const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
          return { promise, resolve, reject };
        };
      }
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

const PDF_CAP = 32 * 1024 * 1024;

function PdfPreview({ file, large }: { file: InspectableFile; large: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const tooBig = file.entry.size > PDF_CAP;

  useEffect(() => {
    if (tooBig) return;
    let cancelled = false;
    // Destroying the loading task tears down the document and its worker
    // resources — both on unmount and when the path changes mid-render.
    let task: { destroy(): Promise<unknown> } | null = null;
    setErr("");
    setLoading(true);
    setPageCount(0);
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const dataUrl = await readImageB64(file.entry.path, PDF_CAP);
        const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const loadingTask = pdfjs.getDocument({ data: bytes });
        task = loadingTask;
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(loaded.numPages);
        const holder = holderRef.current;
        if (!holder) return;
        holder.replaceChildren();
        const maxPages = Math.min(loaded.numPages, large ? 10 : 1);
        // Fit the page to the holder's width; render at devicePixelRatio so
        // text stays crisp on hidpi.
        const cssWidth = Math.max(120, holder.clientWidth - (large ? 48 : 18));
        const ratio = window.devicePixelRatio || 1;
        for (let n = 1; n <= maxPages; n++) {
          if (cancelled) return;
          const page = await loaded.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (cssWidth / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = `${Math.floor(vp.width / ratio)}px`;
          canvas.style.height = `${Math.floor(vp.height / ratio)}px`;
          await page.render({ canvas, viewport: vp }).promise;
          if (cancelled) return;
          holder.appendChild(canvas);
        }
        if (!cancelled && loaded.numPages > maxPages) {
          const more = document.createElement("div");
          more.className = "more";
          more.textContent = `+${loaded.numPages - maxPages} more page${loaded.numPages - maxPages === 1 ? "" : "s"}`;
          holder.appendChild(more);
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setLoading(false);
          setErr(errText(e));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (task) void task.destroy().catch(() => undefined);
    };
  }, [file.entry.path, large, tooBig]);

  if (tooBig) return <div className="ghost">pdf too large to preview ({file.size})</div>;
  if (err) return <div className="ghost" style={{ fontSize: 10 }}>pdf: {err}</div>;
  return (
    <>
      {loading && <div className="ghost" style={{ position: "absolute", zIndex: 1 }}>rendering pdf…</div>}
      <div ref={holderRef} className="pv-pdf" />
      {pageCount > 0 && !loading && (
        <div className="pv-badge">{pageCount} page{pageCount === 1 ? "" : "s"} · pdf</div>
      )}
    </>
  );
}

const AUDIO_CAP = 16 * 1024 * 1024;

function AudioPreview({ file }: { file: InspectableFile }) {
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  const tooBig = file.entry.size > AUDIO_CAP;
  useEffect(() => {
    setSrc("");
    setErr("");
    if (tooBig) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = await readImageB64(file.entry.path, AUDIO_CAP);
        if (!cancelled) setSrc(url);
      } catch (e) {
        if (!cancelled) setErr(errText(e));
      }
    })();
    return () => { cancelled = true; };
  }, [file.entry.path, tooBig]);
  if (tooBig) return <div className="ghost">audio too large to preview ({file.size})</div>;
  if (err) return <div className="ghost">audio: {err}</div>;
  if (!src) return <div className="ghost">loading audio…</div>;
  return (
    <div className="pv-audio">
      <div className="pv-audio-ic">♫</div>
      <audio controls src={src} />
    </div>
  );
}

export interface FilePreviewProps {
  file: InspectableFile;
  large?: boolean;
  onExpand?: () => void;
}

export function FilePreview({ file: f, large = false, onExpand }: FilePreviewProps) {
  const extL = f.ext?.toLowerCase() ?? "";
  const isFolder = f.kind === "folder";
  const isImg = f.kind === "img";
  const isAudio = !isFolder && !isImg && AUDIO_EXTS.has(extL);
  const isPdf = !isFolder && !isImg && extL === "pdf";
  const isTextLike =
    !isFolder && !isImg && !isAudio && !isPdf &&
    (f.kind === "text" || f.kind === "code" || TEXT_EXT_FALLBACK.has(extL));

  const [text, setText] = useState("");
  const [textLoading, setTextLoading] = useState(false);
  const [textErr, setTextErr] = useState("");
  const [sniffedBinary, setSniffedBinary] = useState(false);
  const [imgSrc, setImgSrc] = useState("");
  const [imgErr, setImgErr] = useState("");
  const [imgLoading, setImgLoading] = useState(false);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [wrap, setWrap] = useState(() => localStorage.getItem("glasshouse.previewWrap") === "1");
  const [copied, setCopied] = useState(false);

  const TEXT_CAP = large ? 256 * 1024 : 64 * 1024;
  const imgSizeWarn = isImg && f.entry.size > 10 * 1024 * 1024;

  useEffect(() => {
    setText("");
    setSniffedBinary(false);
    setTextErr("");
    if (!isTextLike) {
      setTextLoading(false);
      return;
    }
    let cancelled = false;
    setTextLoading(true);
    void (async () => {
      try {
        const t = await readText(f.entry.path, TEXT_CAP);
        if (cancelled) return;
        if (looksBinary(t)) setSniffedBinary(true);
        else setText(t);
      } catch (err) {
        if (!cancelled) setTextErr(errText(err));
      } finally {
        if (!cancelled) setTextLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [f.entry.path, isTextLike, TEXT_CAP]);

  useEffect(() => {
    setImgSrc("");
    setImgErr("");
    setImgDims(null);
    if (!isImg || imgSizeWarn) {
      setImgLoading(false);
      return;
    }
    let cancelled = false;
    setImgLoading(true);
    void (async () => {
      try {
        const dataUrl = await readImageB64(f.entry.path, 8 * 1024 * 1024);
        if (!cancelled) setImgSrc(dataUrl);
      } catch (err) {
        if (!cancelled) setImgErr(errText(err));
      } finally {
        if (!cancelled) setImgLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [f.entry.path, isImg, imgSizeWarn]);

  const loadLargeImage = () => {
    if (!isImg) return;
    setImgLoading(true);
    setImgErr("");
    void (async () => {
      try {
        const dataUrl = await readImageB64(f.entry.path, 64 * 1024 * 1024);
        setImgSrc(dataUrl);
      } catch (err) {
        setImgErr(errText(err));
      } finally {
        setImgLoading(false);
      }
    })();
  };

  const toggleWrap = () => {
    setWrap((w) => {
      localStorage.setItem("glasshouse.previewWrap", w ? "0" : "1");
      return !w;
    });
  };
  const copyText = () => {
    try {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };

  let body: React.ReactNode;
  let badge: React.ReactNode = null;
  if (isFolder) {
    body = <FolderPreview path={f.entry.path} large={large} />;
  } else if (isImg) {
    if (imgSizeWarn && !imgSrc && !imgLoading && !imgErr) {
      body = (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 10 }}>
          <div className="ghost" style={{ fontSize: 10 }}>large image ({f.size})</div>
          <button
            onClick={loadLargeImage}
            style={{
              background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
              padding: "3px 10px", cursor: "pointer", borderRadius: 3, fontSize: 10,
              fontFamily: "inherit",
            }}
          >render anyway</button>
        </div>
      );
    } else if (imgLoading) {
      body = <div className="ghost">loading image…</div>;
    } else if (imgErr) {
      body = <div className="ghost" style={{ fontSize: 10 }}>image: {imgErr}</div>;
    } else if (imgSrc) {
      body = (
        <img
          src={imgSrc}
          alt={f.name}
          onLoad={(e) => {
            const img = e.currentTarget;
            setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          onError={() => setImgErr("failed to decode image data")}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
      );
      if (imgDims) badge = <>{imgDims.w}×{imgDims.h}{extL ? ` · ${extL}` : ""}</>;
    }
  } else if (isAudio) {
    body = <AudioPreview file={f} />;
  } else if (isPdf) {
    body = <PdfPreview file={f} large={large} />;
  } else if (isTextLike && !sniffedBinary) {
    if (textLoading) body = <div className="ghost">reading…</div>;
    else if (textErr) body = <div className="ghost" style={{ fontSize: 10, color: "var(--red, #f7768e)" }}>can't preview: {textErr}</div>;
    else if (!text) body = <div className="ghost" style={{ fontSize: 10 }}>empty file</div>;
    else {
      body = (
        <TextPreview
          path={f.entry.path}
          text={text}
          ext={extL}
          large={large}
          wrap={wrap}
          truncated={text.length >= TEXT_CAP}
        />
      );
    }
  } else {
    body = <HexPreview path={f.entry.path} large={large} />;
    badge = <>binary · first {large ? "4 KB" : "512 B"}</>;
  }

  const showTextTools = isTextLike && !sniffedBinary && !!text;
  return (
    <div className={"file-preview" + (large ? " pv-large" : "") + (isImg ? " is-img" : "")}>
      {body}
      {badge && <div className="pv-badge">{badge}</div>}
      <div className="pv-tools">
        {showTextTools && (
          <button className={wrap ? "on" : ""} title="toggle line wrap" onClick={toggleWrap}>↩</button>
        )}
        {showTextTools && (
          <button title="copy preview text" onClick={copyText}>{copied ? "✓" : "⧉"}</button>
        )}
        {onExpand && <button title="quick look (Space)" onClick={onExpand}>⛶</button>}
      </div>
    </div>
  );
}

// Full-window preview overlay ("quick look") — Space or the expand button
// opens it for the selected file; Esc, Space or a backdrop click closes.
export function QuickLook({ file, onClose }: { file: InspectableFile; onClose: () => void }) {
  const displayName = file.ext && file.kind !== "folder" ? `${file.name}.${file.ext}` : file.name;
  const ki = kindIcon(file.kind);
  return (
    <div className="ql-overlay" onMouseDown={onClose}>
      <div className="ql-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ql-head">
          <span className={"ql-ic " + ki.cls}>{ki.ic}</span>
          <span className="ql-name" title={file.entry.path}>{displayName}</span>
          <span className="ql-meta">{file.size}{file.date ? ` · ${file.date}` : ""}</span>
          <button className="ql-close" title="close (Esc)" onClick={onClose}>✕</button>
        </div>
        <div className="ql-body">
          <FilePreview file={file} large />
        </div>
      </div>
    </div>
  );
}
