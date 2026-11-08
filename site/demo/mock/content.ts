// The demo's starting filesystem: a home folder with a git repo that has
// local changes, pictures for previews, archives, and a few documents.
import type { Seed } from "./vfs";

export const HOME = "/home/demo";
export const REPO = `${HOME}/projects/glasshouse`;
/** 2026-11-06 14:30 UTC: fixed, so captures are repeatable. */
export const BASE_TIME = Date.UTC(2026, 10, 6, 14, 30);

/** Image files are served from the demo's `files/` folder. */
const img = (file: string, size: number, extra: { git?: "M" | "?"; age?: number } = {}) =>
  ({ asset: `files/${file}`, size, ...extra });

const README = `# glasshouse

A desktop file manager for Windows and Linux, with tabs, a built-in terminal
and git status.

## Build

    pnpm install
    pnpm tauri:dev      # run in dev mode
    pnpm tauri:build    # Windows installers

## Layout

- \`src/\`: the React frontend
- \`src-tauri/\`: the Rust backend (Tauri commands)
- \`docs/\`: the project site

## License

MIT
`;

const APP_TSX = `import { useState } from "react";
import { Sidebar, FilePane, Inspector } from "./components";
import { useTabs } from "./tabs";

export function App() {
  const { tabs, active, openTab, closeTab } = useTabs();
  const [showInspector, setShowInspector] = useState(true);

  return (
    <div className="app">
      <Sidebar onOpen={openTab} />
      <FilePane tab={tabs[active]} onClose={() => closeTab(active)} />
      {showInspector && <Inspector tab={tabs[active]} />}
    </div>
  );
}
`;

const MAIN_TSX = `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/themes.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
`;

const FUZZY_TS = `/** Subsequence match: every query character, in order. Lower is better. */
export function fuzzyScore(query: string, name: string): number | null {
  let score = 0;
  let at = 0;
  for (const ch of query.toLowerCase()) {
    const i = name.toLowerCase().indexOf(ch, at);
    if (i < 0) return null;
    score += i - at;
    at = i + 1;
  }
  return score;
}
`;

const THEMES_CSS = `[data-theme="tokyo-night"] {
  --bg-0: #1a1b26;
  --fg-0: #c0caf5;
  --accent: #bb9af7;
}

[data-theme="gruvbox-dark"] {
  --bg-0: #282828;
  --fg-0: #ebdbb2;
  --accent: #d79921;
}
`;

const CARGO_TOML = `[package]
name = "glasshouse"
version = "0.1.0"
description = "Desktop file manager for Windows and Linux"
edition = "2021"

[dependencies]
tauri = "2"
git2 = "0.19"
notify = "7"
portable-pty = "0.9"
serde = { version = "1", features = ["derive"] }
`;

const MAIN_RS = `fn main() {
    glasshouse_lib::run();
}
`;

const COMMANDS_RS = `use std::fs;
use std::path::Path;

#[tauri::command]
pub fn list_dir(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        out.push(FileEntry::from_dir_entry(&entry)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn make_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("{path} already exists"));
    }
    fs::create_dir(&path).map_err(|e| e.to_string())
}
`;

const PTY_RS = `use portable_pty::{native_pty_system, CommandBuilder, PtySize};

pub fn spawn(shell: &str, cwd: &str, cols: u16, rows: u16) -> anyhow::Result<Session> {
    let pair = native_pty_system().openpty(PtySize { rows, cols, ..Default::default() })?;
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    let child = pair.slave.spawn_command(cmd)?;
    Ok(Session::new(pair.master, child))
}
`;

const NOTES_MD = `# notes

- Quick Look: Space on any file, Esc to close
- paste onto an existing name asks: replace, keep both or skip
- try the terminal drawer with Ctrl+\`
`;

export const SEED: Seed = {
  home: {
    demo: {
      ".bashrc": `export EDITOR=nvim\nalias ll='ls -la'\nPS1='\\u@\\h:\\w$ '\n`,
      ".gitconfig": `[user]\n\tname = Demo User\n\temail = demo@example.com\n`,
      ".glasshouse": {
        "remotes.json": JSON.stringify([{ label: "homelab", host: "homelab", path: "/srv" }]),
      },
      ".local": { share: { Trash: { "files/": {} } } },
      projects: {
        glasshouse: {
          ".git": { HEAD: "ref: refs/heads/main\n", config: "[core]\n\tbare = false\n" },
          ".gitignore": "node_modules/\ndist/\n/src-tauri/target/\n",
          "README.md": { text: README, git: "M", age: 12 },
          "CHANGELOG.md": "# changelog\n\n## 0.1.0\n\n- first release\n",
          LICENSE: "MIT License\n\nCopyright (c) 2026\n",
          "package.json": { text: `{\n  "name": "glasshouse",\n  "version": "0.1.0",\n  "private": true\n}\n`, git: "M", age: 40 },
          "vite.config.ts": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });\n`,
          "notes.md": { text: NOTES_MD, git: "?", age: 5 },
          src: {
            "App.tsx": { text: APP_TSX, git: "M", age: 8 },
            "main.tsx": MAIN_TSX,
            "fuzzy.ts": { text: FUZZY_TS, git: "A", age: 25 },
            styles: { "themes.css": { text: THEMES_CSS, git: "M", age: 18 } },
          },
          "src-tauri": {
            "Cargo.toml": CARGO_TOML,
            src: {
              "main.rs": MAIN_RS,
              "commands.rs": { text: COMMANDS_RS, git: "M", age: 30 },
              "pty.rs": PTY_RS,
            },
          },
          docs: { "index.html": "<!doctype html>\n<title>glasshouse</title>\n" },
        },
        website: {
          "index.html": "<!doctype html>\n<html lang=\"en\">\n<title>my site</title>\n<h1>hello</h1>\n",
          "style.css": "body { font-family: system-ui; margin: 2rem; }\n",
          assets: { "logo.png": img("logo.png", 4097) },
        },
        dotfiles: {
          "init.lua": "vim.opt.number = true\nvim.opt.expandtab = true\nvim.opt.shiftwidth = 2\n",
          "config.kdl": "input {\n    keyboard { xkb { layout \"us\"; } }\n}\n",
          "install.sh": "#!/bin/sh\nset -e\nln -sf \"$PWD/init.lua\" ~/.config/nvim/init.lua\n",
        },
      },
      Documents: {
        "meeting-notes.md": "# planning, 2026-11-04\n\n- ship the paste-conflict dialog\n- record the site demo\n",
        "todo.txt": "[x] back up photos\n[ ] renew domain\n[ ] sort Downloads\n",
        "budget-2026.ods": { size: 18_432 },
        recipes: {
          "pancakes.md": "# pancakes\n\n- 200 g flour\n- 2 eggs\n- 300 ml milk\n- pinch of salt\n",
          "bread.md": "# bread\n\n- 500 g flour\n- 350 ml water\n- 10 g salt\n- 5 g yeast\n",
        },
      },
      Downloads: {
        // Same name as the wallpaper, different photo: the paste-conflict scene.
        "aurora.jpg": img("aurora-alaska.jpg", 94354, { age: 3 }),
        "photos-2026-10.zip": { size: 48_201_334 },
        "dataset.tar.gz": { size: 7_340_032 },
        "fonts.7z": { size: 3_145_728 },
        "glasshouse_0.1.0_amd64.AppImage": { size: 86_507_520 },
        "invoice-0423.pdf": { size: 52_118 },
      },
      Pictures: {
        wallpapers: {
          "aurora.jpg": img("aurora.jpg", 78695),
          "crete-coast.jpg": img("crete-coast.jpg", 188508),
          "dunes.jpg": img("dunes.jpg", 27769),
          "forest-mist.jpg": img("forest-mist.jpg", 285531),
          "matterhorn.jpg": img("matterhorn.jpg", 154166),
          "moraine-lake.jpg": img("moraine-lake.jpg", 236786),
        },
        travel: {
          "quebec-night.jpg": img("quebec-night.jpg", 269250),
        },
        screenshots: {
          "glasshouse-2026-07-13.png": img("screenshot.png", 232983),
        },
      },
      Music: {
        "playlist.m3u": "#EXTM3U\nambient/01-intro.flac\nambient/02-drift.flac\n",
      },
    },
  },
  etc: {
    hostname: "demo\n",
    "os-release": "NAME=\"Linux\"\nPRETTY_NAME=\"Linux (demo)\"\n",
    fstab: "UUID=demo-root / ext4 defaults 0 1\n",
  },
  mnt: {
    data: {
      backups: { "2026-11-01.tar.zst": { size: 1_288_490_188 } },
      isos: { "debian-13.iso": { size: 4_000_000_000 } },
    },
  },
  boot: { efi: { EFI: { BOOT: { "BOOTX64.EFI": { size: 950_272 } } } } },
  tmp: {},
  usr: { bin: { bash: { size: 1_446_024 }, git: { size: 3_571_240 } } },
};

export const PINS = [REPO, `${HOME}/Downloads`, `${HOME}/Pictures/wallpapers`];

export const TAGS: Record<string, string[]> = {
  [`${REPO}/README.md`]: ["review"],
  [`${HOME}/Documents/todo.txt`]: ["project"],
  [`${HOME}/Documents/budget-2026.ods`]: ["secret"],
  [`${HOME}/Pictures/wallpapers/aurora.jpg`]: ["archive"],
};

export const RECENT = [REPO, `${HOME}/Documents`, `${HOME}/Pictures/wallpapers`];
