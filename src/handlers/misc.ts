import type { Handler, HandlerCtx } from "./types";
import { pickNumbered } from "./helpers";
import { dialogs } from "../dialogs/DialogHost";
import { IS_WINDOWS } from "../platform";
import { basename, joinPath, parentPath } from "../paths";
import { getVersion } from "@tauri-apps/api/app";
import { failureDetails, runTransfer, summarize } from "../transfer";
import { asItems, assertFree, namesIn, pushTransferUndo, transferDeps, unlessTaken } from "../transferUi";
import { NameSet, freeNewName, nameProblem, takenProblem } from "../names";
import { openNotices } from "../NoticesScreen";
import { isCancelled, runOp } from "../ops";
import {
  makeDir,
  createTextFile,
  isAlreadyExists,
  writeText,
  readText,
  openUrl,
  createSymlink,
  createHardLink,
  createShortcut,
  shred,
  hashSha256,
  readDir,
} from "../api";
import { errText } from "../errors";
import { markIrreversible, pushUndo } from "../state";
import { contentUndo, createUndo, madeUndo, moveUndo } from "../undoActions";
import { droppingTags, renamePath } from "../tags";
const REPO_URL = "https://github.com/Johnson-Anthony/glasshouse";

async function promptAndCreate(ctx: HandlerCtx, defaultName: string, body = ""): Promise<void> {
  const taken = await namesIn(ctx.cwd);
  const name = await dialogs.showPrompt({
    title: "new file",
    message: "file name:",
    initialValue: freeNewName(defaultName, false, taken.has),
    placeholder: defaultName,
    validate: (v) => nameProblem(v.trim(), taken),
    submit: (v) => unlessTaken(v.trim(), () => createTextFile(joinPath(ctx.cwd, v.trim()), body)),
  });
  if (name == null || name.trim() === "") return;
  const file = name.trim();
  pushUndo(createUndo(`new file ${file}`, joinPath(ctx.cwd, file), { kind: "file", content: body }));
  ctx.refresh();
}

// Built-in templates for File → New → From Template…. Bodies are minimal,
// sane starting points — not scaffolding frameworks.
const TEMPLATES: { name: string; file: string; body: string }[] = [
  {
    name: "README",
    file: "README.md",
    body: "# project\n\n> one-line description\n\n## Usage\n\n```bash\n# how to run it\n```\n",
  },
  {
    name: "gitignore (node)",
    file: ".gitignore",
    body: "node_modules/\ndist/\n*.log\n.env\n.DS_Store\n",
  },
  {
    name: "gitignore (rust)",
    file: ".gitignore",
    body: "target/\n*.log\n.env\n",
  },
  {
    name: "LICENSE (MIT)",
    file: "LICENSE",
    body: `MIT License

Copyright (c) ${new Date().getFullYear()} <copyright holder>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
  {
    name: "HTML page",
    file: "index.html",
    body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>page</title>
</head>
<body>

</body>
</html>
`,
  },
  {
    name: "Makefile",
    file: "Makefile",
    body: ".PHONY: build test clean\n\nbuild:\n\t@echo build\n\ntest:\n\t@echo test\n\nclean:\n\t@echo clean\n",
  },
  {
    name: "editorconfig",
    file: ".editorconfig",
    body: "root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = 2\ntrim_trailing_whitespace = true\n",
  },
  {
    name: "docker-compose",
    file: "docker-compose.yml",
    body: "services:\n  app:\n    image: alpine:latest\n    command: [\"echo\", \"hello\"]\n",
  },
];

async function createFromTemplate(ctx: HandlerCtx): Promise<void> {
  const tpl = await pickNumbered("new from template", TEMPLATES, t => `${t.name} (${t.file})`);
  if (!tpl) return;
  await promptAndCreate(ctx, tpl.file, tpl.body);
}

/** Paste as Symlink, Hard Link or Shortcut: one link per clipboard path in
 *  the current folder, named after its target plus `suffix`. Undo deletes
 *  the links; a hard link only while its original is still there, since
 *  otherwise it may be the last name the data has. */
async function pasteAsLinks(
  ctx: HandlerCtx,
  noun: string,
  suffix: string,
  create: (target: string, linkPath: string) => Promise<void>,
  hard = false,
): Promise<void> {
  const paths = ctx.clipboardPaths?.() ?? [];
  if (paths.length === 0) {
    dialogs.showToast({ message: "clipboard is empty", variant: "info" });
    return;
  }
  const made: Array<{ target: string; link: string }> = [];
  for (const p of paths) {
    const link = joinPath(ctx.cwd, basename(p) + suffix);
    try {
      await create(p, link);
      made.push({ target: p, link });
    } catch (e) {
      console.error(`[misc] ${noun} failed`, p, e);
    }
  }
  if (made.length > 0) {
    const remake = async () => {
      for (const { target, link } of made) await create(target, link);
    };
    pushUndo(madeUndo(`paste ${made.length} ${noun}(s)`, made.map(m => m.link), remake, {
      verb: "created",
      needs: hard ? made.map(m => m.target) : [],
    }));
  }
  dialogs.showToast({ message: `created ${made.length}/${paths.length} ${noun}(s)`, variant: "success" });
  ctx.refresh();
}

async function createPythonModule(ctx: HandlerCtx): Promise<void> {
  const taken = await namesIn(ctx.cwd);
  const name = await dialogs.showPrompt({
    title: "new python module",
    message: "module name (creates a folder with __init__.py):",
    placeholder: "my_module",
    validate: (v) => nameProblem(v.trim(), taken),
    submit: (v) => unlessTaken(v.trim(), () => makeModule(joinPath(ctx.cwd, v.trim()))),
  });
  if (name == null || name.trim() === "") return;
  const dir = joinPath(ctx.cwd, name.trim());
  pushUndo(madeUndo(`new python module ${name.trim()}`, [dir], () => makeModule(dir), { verb: "created" }));
  ctx.refresh();
}

async function makeModule(dir: string): Promise<void> {
  await makeDir(dir);
  await createTextFile(joinPath(dir, "__init__.py"), "");
}

/** Export Layout: write `.glasshouserc` in `dir`, asking before replacing
 *  one, and push an undo entry that removes it or puts the old one back. */
async function exportLayout(dir: string, body: string): Promise<boolean> {
  const target = joinPath(dir, ".glasshouserc");
  const named = new NameSet([".glasshouserc"], IS_WINDOWS);
  const old = (await readDir(dir, true)).find(e => named.has(e.name));
  if (!old) {
    await createTextFile(target, body);
    pushUndo(createUndo("export layout", target, { kind: "file", content: body }));
    return true;
  }
  const ok = await dialogs.showConfirm({
    title: "export layout",
    message: `Replace the .glasshouserc in ${dir}?`,
    okLabel: "replace",
  });
  if (!ok) return false;
  const before = await readText(target, 16 * 1024 * 1024);
  await writeText(target, body);
  // Undo puts the old text back, but only text that read back whole: a file
  // that was cut off or wasn't UTF-8 can't be restored from it.
  if (new TextEncoder().encode(before).length === old.size) {
    pushUndo(contentUndo("export layout", target, before, body));
  } else {
    markIrreversible("export layout (the old .glasshouserc couldn't be kept for undo)");
  }
  return true;
}

export const miscHandler: Handler = async (label, ctx) => {
  switch (label) {
    // ─── Help / About ──────────────────────────────────────────────────────
    case "About":
      if (ctx.openAbout) {
        ctx.openAbout();
      } else {
        await dialogs.showAlert({ title: "about", message: "Glasshouse — Tauri file manager" });
      }
      return true;

    case "Third-party Notices":
      openNotices();
      return true;

    case "Documentation":
      await openUrl(`${REPO_URL}#readme`);
      return true;

    case "Release Notes":
      await openUrl(`${REPO_URL}/releases`);
      return true;

    case "Check for Updates": {
      const version = await getVersion().catch(() => "unknown");
      await dialogs.showAlert({ title: "check for updates", message: `Current version: ${version}. Opening releases page…`, variant: "info" });
      await openUrl(`${REPO_URL}/releases`);
      return true;
    }

    case "Report Bug…":
      await openUrl(`${REPO_URL}/issues/new`);
      return true;

    case "Export Layout (.glasshouserc)": {
      // Snapshot every persisted UI preference (tweaks, display mode, layout,
      // zoom, sidebar/tree prefs — all live under this prefix).
      const settings: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("glasshouse.")) {
          const v = localStorage.getItem(k);
          if (v != null) settings[k] = v;
        }
      }
      const body = JSON.stringify({ version: 2, settings }, null, 2);
      if (!(await exportLayout(ctx.cwd, body))) return true;
      dialogs.showToast({
        message: `exported ${Object.keys(settings).length} setting(s) → ${joinPath(ctx.cwd, ".glasshouserc")}`,
        variant: "success",
      });
      ctx.refresh();
      return true;
    }

    case "Import Layout (.glasshouserc)": {
      const sel = ctx.firstPath;
      const source = sel && basename(sel).toLowerCase() === ".glasshouserc"
        ? sel
        : joinPath(ctx.cwd, ".glasshouserc");
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readText(source, 1_000_000));
      } catch (e) {
        const msg = errText(e);
        await dialogs.showAlert({
          title: "import layout",
          message: `could not read ${source}\n\n${msg}`,
          variant: "error",
        });
        return true;
      }
      const settings = (parsed as { settings?: unknown } | null)?.settings;
      const entries = settings && typeof settings === "object"
        ? Object.entries(settings as Record<string, unknown>).filter(
            ([k, v]) =>
              k.startsWith("glasshouse.") && typeof v === "string",
          )
        : [];
      if (entries.length === 0) {
        await dialogs.showAlert({
          title: "import layout",
          message: `${source} has no importable settings (expected a v2 .glasshouserc export)`,
          variant: "error",
        });
        return true;
      }
      const ok = await dialogs.showConfirm({
        title: "import layout",
        message: `Apply ${entries.length} setting(s) from ${source}?\n\nThe app reloads to pick them up.`,
      });
      if (!ok) return true;
      for (const [k, v] of entries) {
        try { localStorage.setItem(k, v as string); } catch { /* quota */ }
      }
      location.reload();
      return true;
    }

    // ─── Destructive / special file ops ────────────────────────────────────
    case "Shred (srm)": {
      const target = ctx.firstPath;
      if (!target) {
        console.log("[misc] shred: nothing selected");
        return true;
      }
      const confirmed = await dialogs.showConfirm({
        title: "shred file",
        message: `Shred ${target}?\n\nThis is irreversible — the file will be overwritten with random bytes and deleted.`,
        danger: true,
      });
      if (!confirmed) return true;
      try {
        await droppingTags(shred)(target, 3);
      } finally {
        // Even a failed shred may have overwritten part of the file.
        markIrreversible(`shred ${basename(target)}`);
      }
      dialogs.showToast({ message: `shredded ${target}`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Create Symlink…": {
      const target = await dialogs.showPrompt({
        title: "create symlink",
        message: "target file or folder:",
        placeholder: IS_WINDOWS ? "C:\\path\\to\\target" : "/path/to/target",
        validate: (v) => v.trim() ? null : "target required",
      });
      if (target == null || target.trim() === "") return true;
      const defLink = joinPath(ctx.cwd, basename(target.trim()));
      const linkPath = await dialogs.showPrompt({
        title: "create symlink",
        message: "link path:",
        initialValue: defLink,
        placeholder: defLink,
        validate: (v) => v.trim() ? null : "link path required",
      });
      if (linkPath == null || linkPath.trim() === "") return true;
      const [to, link] = [target.trim(), linkPath.trim()];
      await createSymlink(to, link);
      pushUndo(madeUndo(`symlink ${basename(link)}`, [link], () => createSymlink(to, link), { verb: "created" }));
      dialogs.showToast({ message: `symlink → ${target.trim()}`, variant: "success" });
      ctx.refresh();
      return true;
    }

    // ─── Clipboard special paste ──────────────────────────────────────────
    case "Paste as Symlink":
    case "Paste as Link (symlink)":
      await pasteAsLinks(ctx, "symlink", "", createSymlink);
      return true;

    case "Paste as Hard Link":
      await pasteAsLinks(ctx, "hard link", "", createHardLink, true);
      return true;

    case "Paste as Shortcut":
      await pasteAsLinks(ctx, "shortcut", ".lnk", createShortcut);
      return true;

    case "Paste as Copy (verify SHA256)": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      const res = await runTransfer(asItems(paths), ctx.cwd, "copy", transferDeps);
      if (!res) return true;
      pushTransferUndo(res, "copy", `paste copy ${res.done.length} item(s)`);
      let verified = 0;
      const verifyCancelled = await runOp(`verifying ${res.done.length} cop${res.done.length === 1 ? "y" : "ies"}`, async track => {
        for (const { src, dst } of res.done) {
          try {
            const [ha, hb] = await Promise.all([hashSha256(src, track()), hashSha256(dst, track())]);
            if (ha && hb && ha === hb) verified++;
          } catch (e) {
            if (isCancelled(e)) return true;
            console.error("[misc] hash verify failed", src, e);
          }
        }
        return false;
      });
      const sum = summarize(res, "copy", IS_WINDOWS);
      dialogs.showToast({
        message: `${sum.message}, ${verified} verified via SHA256${verifyCancelled ? " (verifying cancelled)" : ""}`,
        variant: verified < res.done.length ? "warning" : sum.variant,
      });
      const details = failureDetails(res, IS_WINDOWS);
      if (details) void dialogs.showAlert({ title: "copy failed", variant: "error", message: details });
      ctx.refresh();
      return true;
    }

    case "Paste Text into Filename": {
      const target = ctx.firstPath;
      if (!target) {
        dialogs.showToast({ message: "no selection to rename", variant: "info" });
        return true;
      }
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch (e) {
        await dialogs.showAlert({
          title: "clipboard read failed",
          message: errText(e),
          variant: "error",
        });
        return true;
      }
      const name = text.trim();
      if (!name) {
        dialogs.showToast({ message: "clipboard text is empty", variant: "info" });
        return true;
      }
      const self = basename(target);
      if (name === self) return true;
      const dest = joinPath(parentPath(target), name);
      try {
        await assertFree(parentPath(target), name, self);
        await renamePath(target, dest);
        pushUndo(moveUndo(`rename ${self} → ${name}`, [{ src: target, dst: dest }], "rename"));
      } catch (e) {
        await dialogs.showAlert({
          title: "can't rename",
          message: isAlreadyExists(e) ? takenProblem(name) : errText(e),
          variant: "error",
        });
        return true;
      }
      ctx.refresh();
      return true;
    }

    // ─── File → New submenu ───────────────────────────────────────────────
    case "Python Module":
      await createPythonModule(ctx);
      return true;

    case "From Template…":
      await createFromTemplate(ctx);
      return true;

    // ─── Undo / Redo ──────────────────────────────────────────────────────
    case "Undo":
      ctx.undo?.();
      return true;
    case "Redo":
      ctx.redo?.();
      return true;

    default:
      return false;
  }
};
