import type { Handler, HandlerCtx } from "./types";
import { dialogs } from "../components";
import { IS_WINDOWS } from "../platform";
import { basename, joinPath, parentPath } from "../paths";
import { getVersion } from "@tauri-apps/api/app";
import { failureDetails, runTransfer, summarize } from "../transfer";
import { asItems, assertFree, namesIn, pushTransferUndo, transferDeps, unlessTaken } from "../transferUi";
import { freeNewName, nameProblem, takenProblem } from "../names";
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
  renameEntry,
  hashSha256,
} from "../api";
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
  const listing = TEMPLATES.map((t, i) => `${i + 1}. ${t.name} (${t.file})`).join("\n");
  const picked = await dialogs.showPrompt({
    title: "new from template",
    message: listing,
    placeholder: "1",
    validate: (v) => {
      const n = parseInt(v.trim(), 10);
      return (Number.isFinite(n) && n >= 1 && n <= TEMPLATES.length)
        ? null
        : `enter 1..${TEMPLATES.length}`;
    },
  });
  if (picked == null) return;
  const tpl = TEMPLATES[parseInt(picked.trim(), 10) - 1];
  if (!tpl) return;
  await promptAndCreate(ctx, tpl.file, tpl.body);
}

async function createPythonModule(ctx: HandlerCtx): Promise<void> {
  const taken = await namesIn(ctx.cwd);
  const name = await dialogs.showPrompt({
    title: "new python module",
    message: "module name (creates a folder with __init__.py):",
    placeholder: "my_module",
    validate: (v) => nameProblem(v.trim(), taken),
    submit: (v) => unlessTaken(v.trim(), async () => {
      const dir = joinPath(ctx.cwd, v.trim());
      await makeDir(dir);
      await createTextFile(joinPath(dir, "__init__.py"), "");
    }),
  });
  if (name == null || name.trim() === "") return;
  ctx.refresh();
}

export const miscHandler: Handler = async (label, ctx) => {
  switch (label) {
    // ─── Help / About ──────────────────────────────────────────────────────
    case "About":
    case "About Glasshouse":
      if (ctx.openAbout) {
        ctx.openAbout();
      } else {
        await dialogs.showAlert({ title: "about", message: "Glasshouse — Tauri file manager" });
      }
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

    case "Report Bug":
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
      const target = joinPath(ctx.cwd, ".glasshouserc");
      const body = JSON.stringify({ version: 2, settings }, null, 2);
      await writeText(target, body);
      dialogs.showToast({
        message: `exported ${Object.keys(settings).length} setting(s) → ${target}`,
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
        const msg = e instanceof Error ? e.message : String(e);
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
    case "Shred":
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
      await shred(target, 3);
      dialogs.showToast({ message: `shredded ${target}`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Create Symlink":
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
      await createSymlink(target.trim(), linkPath.trim());
      dialogs.showToast({ message: `symlink → ${target.trim()}`, variant: "success" });
      ctx.refresh();
      return true;
    }

    // ─── Clipboard special paste ──────────────────────────────────────────
    case "Paste as Symlink":
    case "Paste as Link (symlink)": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      let ok = 0;
      for (const p of paths) {
        try {
          await createSymlink(p, joinPath(ctx.cwd, basename(p)));
          ok++;
        } catch (e) {
          console.error("[misc] symlink failed", p, e);
        }
      }
      dialogs.showToast({ message: `created ${ok}/${paths.length} symlink(s)`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Paste as Hard Link": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      let ok = 0;
      for (const p of paths) {
        try {
          await createHardLink(p, joinPath(ctx.cwd, basename(p)));
          ok++;
        } catch (e) {
          console.error("[misc] hard link failed", p, e);
        }
      }
      dialogs.showToast({ message: `created ${ok}/${paths.length} hard link(s)`, variant: "success" });
      ctx.refresh();
      return true;
    }

    case "Paste as Shortcut": {
      const paths = ctx.clipboardPaths?.() ?? [];
      if (paths.length === 0) {
        dialogs.showToast({ message: "clipboard is empty", variant: "info" });
        return true;
      }
      let ok = 0;
      for (const p of paths) {
        try {
          await createShortcut(p, joinPath(ctx.cwd, basename(p) + ".lnk"));
          ok++;
        } catch (e) {
          console.error("[misc] shortcut failed", p, e);
        }
      }
      dialogs.showToast({ message: `created ${ok}/${paths.length} shortcut(s)`, variant: "success" });
      ctx.refresh();
      return true;
    }

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
      for (const { src, dst } of res.done) {
        try {
          const [ha, hb] = await Promise.all([hashSha256(src), hashSha256(dst)]);
          if (ha && hb && ha === hb) verified++;
        } catch (e) {
          console.error("[misc] hash verify failed", src, e);
        }
      }
      const sum = summarize(res, "copy", IS_WINDOWS);
      dialogs.showToast({
        message: `${sum.message}, ${verified} verified via SHA256`,
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
          message: e instanceof Error ? e.message : String(e),
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
        await renameEntry(target, dest);
      } catch (e) {
        await dialogs.showAlert({
          title: "can't rename",
          message: isAlreadyExists(e) ? takenProblem(name) : e instanceof Error ? e.message : String(e),
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
    case "From Template":
      await createFromTemplate(ctx);
      return true;

    // ─── Undo / Redo ──────────────────────────────────────────────────────
    case "Undo":
      ctx.undo?.();
      return true;
    case "Redo":
      ctx.redo?.();
      return true;

    // ─── Submenu parents (no-ops, already marked consumed) ────────────────
    case "New":
    case "New →":
    case "Open With":
    case "Template":
    case "Template →":
    case "Profile":
    case "Profile →":
      return true;

    default:
      return false;
  }
};
