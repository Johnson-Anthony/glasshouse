#!/usr/bin/env node
// audit-wiring.mjs
//
// Extract every interactable label from the original design bundle, compare
// against the live app (src/data.ts menu tree + src/handlers/*.ts case
// strings), and emit a wired/unwired report.
//
// No agents, no LLM — pure programmatic comparison. Run:
//
//   node scripts/audit-wiring.mjs            # writes audit-wiring.{json,md}
//   node scripts/audit-wiring.mjs --stdout   # also dump md to stdout
//
// Exit code is non-zero iff the report finds design labels that are missing
// from the app entirely (so this can be wired into CI).

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import url from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const DESIGN_DATA  = path.join(ROOT, "design/project/src/data.jsx");
const DESIGN_COMPS = path.join(ROOT, "design/project/src/components.jsx");
const APP_DATA     = path.join(ROOT, "src/data.ts");
const HANDLERS_DIR = path.join(ROOT, "src/handlers");
// Files outside handlers/ that also dispatch on label strings via `case "X":`
// (App.tsx has its own big switch + keybind dispatcher).
const EXTRA_DISPATCH_FILES = [
  path.join(ROOT, "src/App.tsx"),
];

// ─── label normalisation ─────────────────────────────────────────────────
// Handlers match on exact strings, but menu labels drift: some end with "…",
// some with " →", some gain a trailing arrow or shortcut. Strip trailing
// ellipsis/arrow/whitespace for the cross-reference; keep the raw form for
// display.
function canon(label) {
  if (typeof label !== "string") return "";
  return label
    .replace(/\s+→\s*$/, "")
    .replace(/\s*…\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ─── walk a menu tree -> flat items ─────────────────────────────────────
// `dynSources` is a Set<string> accumulating dynamic-node source ids found in
// the tree (e.g. "recent", "terminal-profiles"). These represent runtime-
// resolved submenus that cover families of design labels.
function walkMenu(items, source, out, dynSources) {
  if (!Array.isArray(items)) return;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    if (it.kind === "sep" || it.kind === "grouplabel") continue;
    if (it.kind === "dynamic") {
      if (dynSources && typeof it.source === "string") dynSources.add(it.source);
      continue;
    }
    if (typeof it.label === "string") {
      out.push({
        label: it.label,
        kb: it.kb || null,
        source,
        hasChildren: Array.isArray(it.children) && it.children.length > 0,
        kind: it.kind || "item",
      });
    }
    if (Array.isArray(it.children)) walkMenu(it.children, source, out, dynSources);
  }
}

// A design label is "covered by dynamic" if a dynamic source in the app
// supplies that kind of entry at runtime. Coverage map is explicit so the
// audit fails loudly if a new dynamic source is added without updating it.
function isCoveredByDynamic(label, dynSources) {
  if (!dynSources || dynSources.size === 0) return false;
  const l = label.trim();
  const looksLikePath =
    l.startsWith("/") || l.startsWith("~") || /^[A-Za-z]:[\\/]/.test(l);
  const looksLikeSsh = /^SSH:\s/i.test(l);
  const looksLikeShell = /^(bash|zsh|fish|sh|PowerShell|pwsh|WSL[\s·]|Windows Terminal)/i.test(l);
  if (looksLikePath && (dynSources.has("recent") || dynSources.has("bookmarks-pinned"))) return true;
  if (looksLikeSsh   && dynSources.has("ssh-hosts"))        return true;
  if (looksLikeShell && dynSources.has("terminal-profiles")) return true;
  return false;
}

// ─── design/project/src/data.jsx via vm ─────────────────────────────────
function loadDesignData() {
  const src = fs.readFileSync(DESIGN_DATA, "utf8");
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "design/data.jsx" });
  const w = ctx.window;
  const out = [];
  if (w.MENUS) {
    for (const [k, v] of Object.entries(w.MENUS)) {
      walkMenu(v, `design:MENUS.${k}`, out, null);
    }
  }
  if (Array.isArray(w.PALETTE)) {
    for (const p of w.PALETTE) {
      if (p?.label) {
        out.push({
          label: p.label,
          kb: Array.isArray(p.kb) ? p.kb.join("+") : (p.kb || null),
          source: `design:PALETTE.${p.g || ""}`,
          hasChildren: false,
          kind: "palette",
        });
      }
    }
  }
  if (w.CONTEXT_FILE)  walkMenu(w.CONTEXT_FILE,  "design:CONTEXT_FILE",  out);
  if (w.CONTEXT_EMPTY) walkMenu(w.CONTEXT_EMPTY, "design:CONTEXT_EMPTY", out);
  return out;
}

// ─── src/data.ts via ts.transpileModule + vm ────────────────────────────
function loadAppData() {
  const tsSrc = fs.readFileSync(APP_DATA, "utf8");
  const { outputText } = ts.transpileModule(tsSrc, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const ctx = {
    module: mod,
    exports: mod.exports,
    require: () => ({}),
    console,
  };
  vm.createContext(ctx);
  new vm.Script(outputText, { filename: "app/data.ts.js" }).runInContext(ctx);
  const w = mod.exports;
  const out = [];
  const dynSources = new Set();
  if (w.MENUS) {
    for (const [k, v] of Object.entries(w.MENUS)) {
      walkMenu(v, `app:MENUS.${k}`, out, dynSources);
    }
  }
  if (Array.isArray(w.PALETTE)) {
    for (const p of w.PALETTE) {
      if (p?.label) {
        out.push({
          label: p.label,
          kb: Array.isArray(p.kb) ? p.kb.join("+") : (p.kb || null),
          source: `app:PALETTE.${p.g || ""}`,
          hasChildren: false,
          kind: "palette",
        });
      }
    }
  }
  for (const name of [
    "CONTEXT_FILE",
    "CONTEXT_EMPTY",
    "CONTEXT_SIDEBAR",
    "CONTEXT_SIDEBAR_PINNED",
    "CONTEXT_TAB",
    "CONTEXT_BREADCRUMB",
  ]) {
    if (w[name]) walkMenu(w[name], `app:${name}`, out, dynSources);
  }
  return { labels: out, dynSources };
}

// ─── src/handlers/*.ts -> set of case "..." strings ─────────────────────
// Heuristic: classify a case body as "theater" if the only thing it does is
// log/alert/return, with no real api.ts call, no backend command, no state
// mutation. Read the bytes between `case "X":` and the next `case`/`default`
// and inspect.
function classifyCaseBody(src, startIdx) {
  // Find the effective body: skip past stacked `case "..":` / `default:`
  // labels so we read the SHARED body of a stacked-case group, then cut at
  // the next sibling case/default outside that group.
  let cursor = startIdx;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rest = src.slice(cursor, cursor + 400);
    const m = rest.match(/^\s*(?:case\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:|default\s*:)/);
    if (!m) break;
    cursor += m[0].length;
  }
  const chunk = src.slice(cursor, cursor + 3000);
  const endRe = /\n\s*(?:case\s+["']|default\s*:)/;
  const endMatch = chunk.match(endRe);
  const body = endMatch ? chunk.slice(0, endMatch.index) : chunk;
  const cleaned = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // Check theater first — strong indicators of "label lies about what this does".
  //   1) "intent:" string (git stubs)
  //   2) "not implemented" / "not yet" / "not supported yet" / "not tracked"
  //   3) "MVP no-op"/"MVP selects" pragma strings
  //   4) Deep theater: opens a terminal but doesn't run the promised command.
  if (/console\.log\([^)]*intent:/i.test(cleaned)) return "theater";
  if (/not implemented|not yet|not supported yet|not tracked|MVP (no-op|selects)/i.test(cleaned)) return "theater";

  // Strong real-work signals: any API call, await, state action, dispatch,
  // or imported command invocation.
  const REAL = [
    /\bawait\s+(?!spawnTerminal\b)/,
    /\bctx\.(activeHandle|setActiveTab|newTab|moveTab|refresh|setTweaks|pinPath|dispatch|openTweaks|openPalette|runProfile|openPath|toggleSidebar|undo|redo)/,
    /\bset[A-Z]\w+\(/,
    /\bnavigator\.clipboard\.(readText|writeText)/,
    /\binvoke\(/,
    /\bwindow\.open\(/,
    /\blocalStorage\.setItem/,
    /\bdocument\.documentElement\.classList\./,
    /\bdocument\.documentElement\.style\./,
  ];
  for (const re of REAL) if (re.test(cleaned)) return "real";

  // Body that only opens a terminal with no command is theater for labels
  // promising a specific action.
  if (/spawnTerminal\([^)]*\)/.test(cleaned) && !/\bconsole\.log\([^)]*intent:/i.test(cleaned)) {
    // allow labels like "Open in Terminal" / "cd Here" — real purpose *is*
    // to open a terminal. Everything else that only spawns a terminal is
    // theater in disguise.
    return "opens-terminal";
  }

  // Body is nothing but console.log / window.alert / no-op.
  const theaterOnly = /^[\s\{]*(?:(?:console\.log|window\.alert|alert)\([^)]*\)\s*;?\s*)+return\s+true\s*;?\s*\}?\s*$/s;
  if (theaterOnly.test(cleaned.trim())) return "theater";

  return "real";
}

function loadHandlerLabels() {
  const out = [];
  const re = /case\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*:/g;
  const scan = (file, displayName) => {
    if (!fs.existsSync(file)) return;
    const src = fs.readFileSync(file, "utf8");
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const lbl = m[1] ?? m[2];
      const kind = classifyCaseBody(src, m.index + m[0].length);
      out.push({ label: lbl, file: displayName, kind });
    }
  };
  for (const f of fs.readdirSync(HANDLERS_DIR)) {
    if (!f.endsWith(".ts")) continue;
    scan(path.join(HANDLERS_DIR, f), f);
  }
  for (const f of EXTRA_DISPATCH_FILES) {
    scan(f, path.relative(ROOT, f));
  }
  // Also pick up direct dispatch calls: dispatch("X"), ctx.dispatch("X")
  const dispatchRe = /\bdispatch\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*[,)]/g;
  const scanDispatch = (file, displayName) => {
    if (!fs.existsSync(file)) return;
    const src = fs.readFileSync(file, "utf8");
    dispatchRe.lastIndex = 0;
    let m;
    while ((m = dispatchRe.exec(src))) {
      const lbl = m[1] ?? m[2];
      out.push({ label: lbl, file: displayName + " (dispatch)" });
    }
  };
  for (const f of fs.readdirSync(HANDLERS_DIR)) {
    if (!f.endsWith(".ts")) continue;
    scanDispatch(path.join(HANDLERS_DIR, f), f);
  }
  for (const f of EXTRA_DISPATCH_FILES) {
    scanDispatch(f, path.relative(ROOT, f));
  }
  return out;
}

// ─── extra interactable surfaces from components.jsx ────────────────────
// Toolbar buttons, titlebar traffic lights, inspector chips, terminal drawer
// split/zoom icons, status bar clickables. Menu/palette items are covered
// upstream; this pass catches the raw <button>/<span onClick> elements.
function extractComponentButtons() {
  const src = fs.readFileSync(DESIGN_COMPS, "utf8");
  const out = [];

  // <button ... title="…" …>
  for (const m of src.matchAll(/<button[^>]*\btitle="([^"]+)"/g)) {
    out.push({ label: m[1], kind: "button[title]" });
  }
  // <span title="…"> (terminal drawer icons, etc.)
  for (const m of src.matchAll(/<span[^>]*\btitle="([^"]+)"[^>]*>/g)) {
    out.push({ label: m[1], kind: "span[title]" });
  }
  // Chips with onClick or cursor:"pointer" → quick-action chips
  const chipRe = /<span[^>]*className="chip"[^>]*(?:onClick|cursor:\s*"pointer")[^>]*>([^<]+)<\/span>/g;
  for (const m of src.matchAll(chipRe)) {
    out.push({ label: m[1].trim(), kind: "chip[clickable]" });
  }
  // Status-bar segments with onClick
  const statusRe = /<div[^>]*className="sb-seg"[^>]*onClick[^>]*>([\s\S]*?)<\/div>/g;
  for (const m of src.matchAll(statusRe)) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) out.push({ label: text, kind: "status-seg[click]" });
  }
  // tab-btn (new tab, tab menu) — button with class tab-btn
  for (const m of src.matchAll(/<button\s+className="tab-btn"[^>]*\btitle="([^"]+)"/g)) {
    out.push({ label: m[1], kind: "tab-btn" });
  }
  return out;
}

// ─── diff ────────────────────────────────────────────────────────────────
function indexBy(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = canon(x[key]);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function diff(design, app, handlers, extras, dynSources) {
  const designByLabel   = indexBy(design,   "label");
  const appByLabel      = indexBy(app,      "label");
  const handlersByLabel = indexBy(handlers, "label");
  const extrasByLabel   = indexBy(extras,   "label");

  // every canonical label that matters
  const universe = new Set([
    ...designByLabel.keys(),
    ...appByLabel.keys(),
    ...handlersByLabel.keys(),
    ...extrasByLabel.keys(),
  ]);

  const rows = [];
  for (const k of universe) {
    const d  = designByLabel.get(k)   || [];
    const a  = appByLabel.get(k)      || [];
    const h  = handlersByLabel.get(k) || [];
    const ex = extrasByLabel.get(k)   || [];

    // a "parent" item is a submenu trigger (hasChildren) — expected to be a
    // no-op in handlers, so don't flag those as unwired.
    const isParent =
      d.some(x => x.hasChildren) || a.some(x => x.hasChildren);

    const displayLabel =
      (d[0]?.label) || (a[0]?.label) || (h[0]?.label) || (ex[0]?.label) || k;

    const coveredByDynamic = isCoveredByDynamic(displayLabel, dynSources);

    const hasRealHandler = h.some(x => x.kind === "real");
    // "opens-terminal" is theater only if the label promises something
    // besides opening a terminal. "Open in Terminal", "cd Here",
    // "Send Path to Shell" legitimately just open/prep a shell.
    const legitimatelyTerminal = /^(Open in Terminal|cd Here|Send Path to Shell|Open in New Window|Toggle Drawer|Terminal Drawer)$/.test(displayLabel);
    const hasTheaterOnly =
      h.length > 0 &&
      h.every(x =>
        x.kind === "theater" ||
        (x.kind === "opens-terminal" && !legitimatelyTerminal),
      );

    rows.push({
      label: displayLabel,
      canon: k,
      inDesign:   d.length > 0,
      inApp:      a.length > 0,
      inHandlers: h.length > 0,
      inExtras:   ex.length > 0,
      isParent,
      coveredByDynamic,
      hasRealHandler,
      hasTheaterOnly,
      designSources:   [...new Set(d.map(x => x.source))],
      appSources:      [...new Set(a.map(x => x.source))],
      handlerFiles:    [...new Set(h.map(x => x.file))],
      handlerKinds:    [...new Set(h.map(x => x.kind))],
      extraKinds:      [...new Set(ex.map(x => x.kind))],
      kb: d[0]?.kb || a[0]?.kb || null,
    });
  }

  // buckets — dynamic coverage suppresses "missing"/"designOnly" since the
  // app resolves those labels at runtime, not from static data.ts.
  const missing    = rows.filter(r => r.inDesign && !r.inApp && !r.inHandlers && !r.isParent && !r.coveredByDynamic);
  const unwired    = rows.filter(r => r.inApp && !r.inHandlers && !r.isParent);
  const orphaned   = rows.filter(r => r.inHandlers && !r.inApp && !r.inDesign && !r.inExtras);
  const designOnly = rows.filter(r => r.inDesign && !r.inApp && !r.isParent && !r.coveredByDynamic);
  const extrasUnwired = rows.filter(r => r.inExtras && !r.inHandlers && !r.inApp && !r.isParent);
  const dynamicallyCovered = rows.filter(r => r.coveredByDynamic && r.inDesign);
  const theater = rows.filter(r => r.hasTheaterOnly && !r.isParent);

  return { rows, missing, unwired, orphaned, designOnly, extrasUnwired, dynamicallyCovered, theater };
}

// ─── render ──────────────────────────────────────────────────────────────
function renderMarkdown(d) {
  const lines = [];
  lines.push("# Wiring Audit — Glasshouse\n");
  lines.push(`_Generated: ${new Date().toISOString()}_\n`);
  lines.push("Source: `design/project/src/data.jsx` + `components.jsx` vs `src/data.ts` + `src/handlers/*.ts`\n");

  const total = d.rows.length;
  lines.push("## Summary\n");
  lines.push(`- total distinct labels: **${total}**`);
  lines.push(`- design-only (never exposed in app): **${d.designOnly.length}**`);
  lines.push(`- app menu items with no handler case (stubs): **${d.unwired.length}**`);
  lines.push(`- design labels missing everywhere (unrouted): **${d.missing.length}**`);
  lines.push(`- handler cases with no menu entry (orphan): **${d.orphaned.length}**`);
  lines.push(`- theater handlers (returns true but no real work): **${d.theater.length}**`);
  lines.push(`- raw UI elements (buttons/chips) not wired: **${d.extrasUnwired.length}**`);
  lines.push("");

  const section = (title, rows, extraCols = []) => {
    lines.push(`## ${title} (${rows.length})\n`);
    if (rows.length === 0) { lines.push("_none_\n"); return; }
    const headers = ["label", "kb", "design", "app", "handler", ...extraCols];
    lines.push("| " + headers.join(" | ") + " |");
    lines.push("|" + headers.map(() => "---").join("|") + "|");
    for (const r of rows.sort((a,b) => a.label.localeCompare(b.label))) {
      const row = [
        "`" + r.label.replace(/\|/g, "\\|") + "`",
        r.kb || "",
        r.designSources.join(", "),
        r.appSources.join(", "),
        r.handlerFiles.join(", ") || (r.extraKinds.join(", ") || ""),
      ];
      lines.push("| " + row.join(" | ") + " |");
    }
    lines.push("");
  };

  section("Missing everywhere (design says this exists; we don't route it)", d.missing);
  section("Unwired stubs (menu item in app, no handler case)", d.unwired);
  section("Theater (handler returns true but body is only console.log / alert / no-op)", d.theater);
  section("Design-only (present in design, absent in current menu tree)", d.designOnly);
  section("Dynamically covered (design label supplied by a runtime-resolved submenu)", d.dynamicallyCovered);
  section("Raw UI (buttons / chips / status clicks not wired)", d.extrasUnwired);
  section("Orphan handlers (case string matches nothing in design or menu)", d.orphaned);

  return lines.join("\n");
}

// ─── main ────────────────────────────────────────────────────────────────
function main() {
  const toStdout = process.argv.includes("--stdout");

  const design      = loadDesignData();
  const appResult   = loadAppData();
  const app         = appResult.labels;
  const dynSources  = appResult.dynSources;
  const handlers    = loadHandlerLabels();
  const extras      = extractComponentButtons();
  const d           = diff(design, app, handlers, extras, dynSources);

  const jsonOut = {
    generated: new Date().toISOString(),
    dynamicSources: [...dynSources],
    counts: {
      designLabels:       design.length,
      appLabels:          app.length,
      handlerCases:       handlers.length,
      uiExtras:           extras.length,
      missing:            d.missing.length,
      unwired:            d.unwired.length,
      orphaned:           d.orphaned.length,
      designOnly:         d.designOnly.length,
      extrasUnwired:      d.extrasUnwired.length,
      dynamicallyCovered: d.dynamicallyCovered.length,
      theater:            d.theater.length,
    },
    design, app, handlers, extras,
    missing:            d.missing,
    unwired:            d.unwired,
    orphaned:           d.orphaned,
    designOnly:         d.designOnly,
    extrasUnwired:      d.extrasUnwired,
    dynamicallyCovered: d.dynamicallyCovered,
    theater:            d.theater,
    all:                d.rows,
  };

  fs.writeFileSync(path.join(ROOT, "audit-wiring.json"), JSON.stringify(jsonOut, null, 2));
  const md = renderMarkdown(d);
  fs.writeFileSync(path.join(ROOT, "audit-wiring.md"), md);

  if (toStdout) process.stdout.write(md);

  // concise console summary
  console.error(`[audit] design=${design.length} app=${app.length} handlers=${handlers.length} extras=${extras.length} dynSources=${[...dynSources].join(",") || "none"}`);
  console.error(`[audit] missing=${d.missing.length} unwired=${d.unwired.length} theater=${d.theater.length} designOnly=${d.designOnly.length} extrasUnwired=${d.extrasUnwired.length} orphaned=${d.orphaned.length} dynamicallyCovered=${d.dynamicallyCovered.length}`);
  console.error(`[audit] wrote audit-wiring.json + audit-wiring.md`);

  // non-zero exit if unrouted labels exist (CI hook)
  process.exit(d.missing.length > 0 ? 1 : 0);
}

main();
