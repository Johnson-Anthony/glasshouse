#!/usr/bin/env node
// audit-wiring.mjs
//
// Commands are routed by label string (see "Commands are identified by their
// display label" in docs/ARCHITECTURE.md). This checks that routing without
// running the app:
//
//   unwired   a label something sends (the menus, palette and context menus
//             in src/data.ts, the Ctrl+G chords, dispatch("…") calls) that no
//             switch handles, so clicking it shows "not yet wired";
//   shadowed  a handler case that never runs, because App.tsx's own switches
//             or an earlier handler in src/handlers/index.ts take the label
//             first;
//   theater   a handled label whose case only logs, alerts, toasts or returns.
//
// Labels that are handled but never sent from a menu, the palette or a
// literal in code are counted as a note. Some are aliases; others are dead.
//
//   node scripts/audit-wiring.mjs          # report; exits 1 on any problem
//   node scripts/audit-wiring.mjs --all    # also list the never-sent labels
//   node scripts/audit-wiring.mjs --json   # all findings as JSON

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import url from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const DATA = path.join(SRC, "data.ts");
const APP = path.join(SRC, "App.tsx");
const HANDLERS_INDEX = path.join(SRC, "handlers", "index.ts");

// Functions in App.tsx that switch on the label before the handler chain runs.
const APP_ROUTERS = ["handleMenuCommand", "doFileOp"];

// ─── source parsing ─────────────────────────────────────────────────────

function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

// `switch (label)` statements directly inside `fn` (not inside a nested
// function). `conditional` is true when an `if` or a loop sits between the
// switch and the function body, so the switch only sees some calls.
function labelSwitches(fn) {
  const out = [];
  const visit = (node, conditional) => {
    if (node !== fn && isFunctionLike(node)) return;
    if (ts.isSwitchStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === "label") {
      out.push({ node, conditional });
    }
    const nested = conditional || ts.isIfStatement(node) || ts.isConditionalExpression(node) ||
      ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node);
    ts.forEachChild(node, (child) => visit(child, nested));
  };
  visit(fn, false);
  return out;
}

// Each `case "X":` of a switch with the statements it runs. Stacked cases
// share the body of the next clause that has statements.
function caseClauses(sw) {
  const clauses = sw.caseBlock.clauses;
  const out = [];
  clauses.forEach((clause, i) => {
    if (!ts.isCaseClause(clause) || !ts.isStringLiteralLike(clause.expression)) return;
    let body = null;
    for (let j = i; j < clauses.length; j++) {
      if (clauses[j].statements.length > 0) { body = clauses[j].statements; break; }
    }
    out.push({ label: clause.expression.text, clause, body: body ?? [] });
  });
  return out;
}

function findFunction(sf, name) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name &&
      node.initializer && isFunctionLike(node.initializer)) found = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// ─── theater detection ──────────────────────────────────────────────────

const NOOP_CALLS = /^(console\.\w+|alert|window\.alert|dialogs\.showToast|dialogs\.showAlert)$/;

function unwrap(expr) {
  while (ts.isVoidExpression(expr) || ts.isAwaitExpression(expr) || ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }
  return expr;
}

// True when a statement does nothing a user would call the command: a
// return, a log, an alert or a toast, or an `if` made only of those.
function isNoop(st, sf) {
  if (ts.isReturnStatement(st) || ts.isBreakStatement(st) || ts.isEmptyStatement(st)) return true;
  if (ts.isBlock(st)) return st.statements.every((s) => isNoop(s, sf));
  if (ts.isIfStatement(st)) {
    return isNoop(st.thenStatement, sf) && (!st.elseStatement || isNoop(st.elseStatement, sf));
  }
  if (ts.isExpressionStatement(st)) {
    const e = unwrap(st.expression);
    return ts.isCallExpression(e) && NOOP_CALLS.test(e.expression.getText(sf));
  }
  return false;
}

function isTheater(body, sf) {
  return body.every((st) => isNoop(st, sf));
}

// ─── senders: src/data.ts ───────────────────────────────────────────────

// Run data.ts in a sandbox with IS_WINDOWS on, so the Windows-only items it
// strips on other platforms are audited too.
function loadData() {
  const { outputText } = ts.transpileModule(fs.readFileSync(DATA, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  const stubs = { "./platform": { IS_WINDOWS: true } };
  const ctx = { module: mod, exports: mod.exports, require: (id) => stubs[id] ?? {}, console };
  vm.createContext(ctx);
  new vm.Script(outputText, { filename: rel(DATA) }).runInContext(ctx);
  return mod.exports;
}

function isMenuTree(v) {
  return Array.isArray(v) && v.length > 0 && v.every((it) => it && typeof it === "object" && "kind" in it);
}

function dataSenders(data) {
  const sent = [];
  const submenus = new Set();
  const walk = (items, where) => {
    for (const it of items) {
      if (it.kind === "item") sent.push({ label: it.action ?? it.label, where });
      else if (it.kind === "sub") { submenus.add(it.label); walk(it.children, where); }
    }
  };
  for (const [name, value] of Object.entries(data)) {
    if (name === "MENUS") {
      for (const [menu, items] of Object.entries(value)) walk(items, `data.ts MENUS.${menu}`);
    } else if (name === "PALETTE") {
      for (const p of value) sent.push({ label: p.label, where: "data.ts PALETTE" });
    } else if (name === "GIT_CHORDS") {
      for (const label of Object.values(value)) sent.push({ label, where: "data.ts GIT_CHORDS" });
    } else if (isMenuTree(value)) {
      walk(value, `data.ts ${name}`);
    }
  }
  return { sent, submenus };
}

// ─── senders: string literals passed to the router from code ────────────

const SEND_CALLEES = /(^|\.)(dispatch|handleMenuCommand|onCommand)$|^handleMenuCommandRef\.current$/;

function sourceFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name) && !ent.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

// The labels an argument can evaluate to: string literals, both arms of a
// `?:`, and `list[i]` where `list` is an array literal declared in the file.
// Anything else (template strings, variables) is skipped.
function literalsIn(expr, arrays) {
  expr = unwrap(expr);
  if (ts.isStringLiteralLike(expr)) return [expr.text];
  if (ts.isConditionalExpression(expr)) return [...literalsIn(expr.whenTrue, arrays), ...literalsIn(expr.whenFalse, arrays)];
  if (ts.isElementAccessExpression(expr) && ts.isIdentifier(expr.expression)) return arrays.get(expr.expression.text) ?? [];
  return [];
}

function codeSenders() {
  const sent = [];
  for (const file of sourceFiles(SRC)) {
    const sf = parse(file);
    const arrays = new Map();
    const collectArrays = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)) {
        arrays.set(node.name.text, node.initializer.elements.filter(ts.isStringLiteralLike).map((e) => e.text));
      }
      ts.forEachChild(node, collectArrays);
    };
    collectArrays(sf);
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression.getText(sf).replace(/\?\.?/g, ".").replace(/\.\./g, ".");
        if (SEND_CALLEES.test(callee)) {
          for (const label of literalsIn(node.arguments[0], arrays)) {
            sent.push({ label, where: `${rel(file)}:${lineOf(sf, node)}` });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sent;
}

// ─── receivers: App.tsx and the handler chain ───────────────────────────

function appReceivers() {
  const sf = parse(APP);
  const out = [];
  for (const name of APP_ROUTERS) {
    const fn = findFunction(sf, name);
    if (!fn) throw new Error(`${rel(APP)}: can't find ${name}()`);
    for (const { node, conditional } of labelSwitches(fn)) {
      for (const c of caseClauses(node)) {
        out.push({
          label: c.label,
          where: `${rel(APP)}:${lineOf(sf, c.clause)}`,
          owner: `App.tsx ${name}`,
          conditional,
          theater: isTheater(c.body, sf),
        });
      }
    }
  }
  return out;
}

// HANDLERS in index.ts, in order, resolved to [exportName, file].
function handlerChain() {
  const sf = parse(HANDLERS_INDEX);
  const imports = new Map();
  let order = null;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const from = node.moduleSpecifier.text;
      for (const el of node.importClause.namedBindings.elements) imports.set(el.name.text, from);
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === "HANDLERS" &&
      node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      order = node.initializer.elements.map((e) => e.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!order) throw new Error(`${rel(HANDLERS_INDEX)}: can't find the HANDLERS array`);
  return order.map((name) => {
    const from = imports.get(name);
    if (!from) throw new Error(`${rel(HANDLERS_INDEX)}: ${name} isn't imported`);
    return [name, path.join(path.dirname(HANDLERS_INDEX), from + ".ts")];
  });
}

function handlerReceivers() {
  const out = [];
  let pathFallback = false;
  for (const [name, file] of handlerChain()) {
    const sf = parse(file);
    const fn = findFunction(sf, name);
    if (!fn) throw new Error(`${rel(file)}: can't find ${name}`);
    for (const { node, conditional } of labelSwitches(fn)) {
      for (const c of caseClauses(node)) {
        out.push({
          label: c.label,
          where: `${rel(file)}:${lineOf(sf, c.clause)}`,
          owner: name,
          conditional,
          theater: isTheater(c.body, sf),
        });
      }
    }
    // navHandler's default case opens labels that look like paths.
    if (/looksLikePath/.test(fn.getText(sf))) pathFallback = true;
  }
  return { receivers: out, pathFallback };
}

const looksLikePath = (l) => l.startsWith("/") || l.startsWith("~") || /^[A-Za-z]:[\\/]/.test(l);

// ─── checks ─────────────────────────────────────────────────────────────

function audit() {
  const data = loadData();
  const { sent: menuSent, submenus } = dataSenders(data);
  const sent = [...menuSent, ...codeSenders()];
  const app = appReceivers();
  const { receivers: handlers, pathFallback } = handlerReceivers();
  const receivers = [...app, ...handlers];
  const handled = new Set(receivers.map((r) => r.label));

  const unwired = [];
  const seenUnwired = new Set();
  for (const s of sent) {
    if (handled.has(s.label) || seenUnwired.has(s.label)) continue;
    if (pathFallback && looksLikePath(s.label)) continue;
    seenUnwired.add(s.label);
    unwired.push(s);
  }

  // `receivers` is in route order: handleMenuCommand's switches, doFileOp's,
  // then each handler in chain order. A case is shadowed when an earlier
  // unconditional case has the same label. Conditional switches (the
  // right-click target ones) only see some calls, so they shadow nothing.
  const shadowed = [];
  const firstOwner = new Map();
  for (const r of receivers) {
    const prev = firstOwner.get(r.label);
    if (prev) shadowed.push({ ...r, by: prev.where });
    else if (!r.conditional) firstOwner.set(r.label, r);
  }

  const sentLabels = new Set(sent.map((s) => s.label));
  const shadowedSet = new Set(shadowed.map((s) => s.where));
  const theater = receivers.filter((r) => r.theater && sentLabels.has(r.label) && !submenus.has(r.label) &&
    !shadowedSet.has(r.where));
  const neverSent = [...new Map(receivers
    .filter((r) => !sentLabels.has(r.label))
    .map((r) => [r.label, r])).values()];

  return { counts: { sent: sent.length, receivers: receivers.length }, unwired, shadowed, theater, neverSent };
}

// ─── report ─────────────────────────────────────────────────────────────

function main() {
  const r = audit();
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    const lines = [];
    const section = (title, rows, fmt) => {
      lines.push(`${title}: ${rows.length}`);
      for (const row of rows) lines.push(`  ${fmt(row)}`);
    };
    lines.push(`wiring audit: ${r.counts.sent} sent labels, ${r.counts.receivers} switch cases`);
    section("unwired (sent, but no case handles it)", r.unwired, (s) => `"${s.label}"  sent from ${s.where}`);
    section("shadowed (case never runs)", r.shadowed, (s) => `"${s.label}"  ${s.where}  taken first by ${s.by}`);
    section("theater (case only logs, alerts or returns)", r.theater, (t) => `"${t.label}"  ${t.where}`);
    if (process.argv.includes("--all")) {
      section("note: handled but never sent", r.neverSent, (n) => `"${n.label}"  ${n.where}`);
    } else {
      lines.push(`note: ${r.neverSent.length} handled labels are never sent (list them with --all)`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  }
  const problems = r.unwired.length + r.shadowed.length + r.theater.length;
  process.exit(problems > 0 ? 1 : 0);
}

main();
