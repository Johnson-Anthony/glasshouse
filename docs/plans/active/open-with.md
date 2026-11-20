# open-with

Branch: `claude/keen-banach-9930e8` (worktree `keen-banach-9930e8`), started 2026-11-20 from `main` (`aa1ef62`).
Backlog entry: section 21 of `docs/plans/active/survey-2.md`.

## Problems
1. **Opening fails silently.** Double-click, Enter, the sidebar's Open, File → Open and the Inspector's run chip go through `openWithDefault`, which swallows errors. On Linux it's worse: `open_with_default` only spawns `xdg-open` and never sees its exit status. With no desktop environment detected (niri here), xdg-open's generic path then tries mailcap, mimeopen and a list of web browsers, so a file with no app either opens in a browser or does nothing. The Inspector's VS Code chip uses the non-strict `spawnVscode` the same way.
2. **Custom Command…** sends the whole typed string to `run_script` as one program name, so `grep -n foo` fails, and its placeholder `echo` isn't a program on Windows.
3. **No real chooser.** Open With offers Default App, VS Code, Terminal, "Text Editor (.txt)" (which is Default App again) and Custom Command.

## Approach

### Backend
- **New `commands/xdg_apps.rs`** (Linux and other non-Windows; the parsing is pure, so its tests run everywhere):
  - `XdgDirs` from `XDG_DATA_HOME`/`XDG_DATA_DIRS`/`XDG_CONFIG_HOME`/`XDG_CONFIG_DIRS`/`XDG_CURRENT_DESKTOP` (spec defaults when unset), passed in so tests use a temp tree.
  - **MIME type:** shared-mime-info's `globs2` (or the older `globs`) from every data dir, highest weight then longest pattern wins, case-insensitive unless `cs`, `__NOGLOBS__` honoured; `aliases` and `subclasses`. A folder is `inode/directory`. A name no glob matches is sniffed from its first 4 KiB: ELF → `application/x-executable`, UTF-8 text or empty → `text/plain`, else `application/octet-stream`. No `magic` file parsing.
  - **Desktop entries:** every `*.desktop` under each data dir's `applications/` (recursive; the desktop ID is the relative path with `/` → `-`; the first dir wins). The `[Desktop Entry]` group's `Type`, localized `Name`, `Exec`, `TryExec`, `Path`, `Terminal`, `Hidden`, `MimeType`, `Icon`, with the spec's string escapes. Hidden, non-Application, Exec-less or TryExec-missing entries count as not installed.
  - **Associations** (MIME Applications spec, in GLib's order): the `mimeapps.list` files in precedence order (`$desktop-mimeapps.list` before `mimeapps.list`, config home, config dirs, then the deprecated data-dir locations); `Added Associations`, then entries whose `MimeType=` lists the type, minus `Removed Associations`. **The default** is, for the type and then each parent type in turn (subclasses, and `text/plain` for any `text/*`): the first installed `Default Applications` entry, else the first association.
  - **Exec expansion:** split the (unescaped) Exec value into words as the spec says (double quotes with `\"` `` \` `` `\$` `\\`; single quotes as GLib's parser allows; an unquoted `\` escapes the next character). Field codes are expanded in each word **after** splitting, so a path is always whole argv elements and never re-parsed:
    - `%f`/`%u`: one file (the path, also for `%u`). If the line has no `%F`/`%U` and several files are given, one process per file.
    - `%F`/`%U` as a word of their own: one argument per file; inside a word, the first file.
    - `%i` → `--icon <Icon>` (as its own word), `%c` → the name, `%k` → the entry's path, `%%` → `%`; `%d %D %n %N %v %m` and unknown codes are dropped, and a word left empty by them is dropped.
    - A field code inside a quoted part is refused (the spec leaves it undefined, and `sh -c "cat %f"` would make the name shell code).
    - No file code at all: the files are appended, as xdg-open does.
    - The program (first word) is looked up on `PATH` unless it has a `/`. `Terminal=true` runs it inside a terminal emulator (`linux_terminal_command`). The working folder is `Path=` if set, else the first file's folder. Spawned with `proc_tree::spawn_detached` (own session), stdio null, reaped.
- **Windows (`commands/win_open_with.rs`, not built here):** `SHAssocEnumHandlers(.ext, ASSOC_FILTER_RECOMMENDED)` lists the handlers Explorer's Open with shows (it reads OpenWithProgids and OpenWithList itself, and covers Store apps); `GetUIName` is the name, `GetName` the id. Launching re-enumerates, finds the id and calls `IAssocHandler::Invoke` with the file's `IDataObject` (`SHCreateItemFromParsingName` → `BindToHandler(BHID_DataObject)`), so the shell runs the handler's verb and builds any command line. COM is initialised (STA) on a short-lived thread of its own. A shell-verb launch, not the registry read the backlog suggests: see the decision record.
- **Commands:**
  - `open_with_default(path, as_text?)` now returns `{ opened, file_type }`. Linux: the default app above, launched by its Exec; no default → `opened: false` with the MIME type, so the UI can offer a chooser. If no MIME database is found at all, it falls back to xdg-open as before. `as_text`: open with the default app for `text/plain` (Linux), or through the `.txt` class with `ShellExecuteExW(SEE_MASK_CLASSNAME)` (Windows); that's what "Text Editor (.txt)" now does. Windows otherwise keeps the opener plugin (`ShellExecuteExW`, which shows Windows' own "How do you want to open this?" for an unknown type); `ERROR_NO_ASSOCIATION` maps to `opened: false`.
  - New `open_with_apps(path)` → `[{ id, name, is_default }]` (`files-read`: it only reads config).
  - New `open_with_app(id, paths)` (`launch`): the desktop ID (Linux) or handler id (Windows).
  - New `open_with_program(program, paths)` (`exec`: it runs any program the user picked): spawned directly with the paths as arguments. On Linux a picked `.desktop` file launches as an entry. On Windows std's batch-file escaping applies to `.bat`/`.cmd`.
  - `run_script(script, targets, cwd?)`: a bare program name is resolved on `PATH` with `which` first (so on Windows `code` finds `code.cmd`, and `PATHEXT` applies), relative names against `cwd`; `cwd` (optional) is the working folder.

### Frontend
- **`src/commandLine.ts`** (pure, tested): `splitCommandLine(text, windows)` and `customCommandArgv(text, path, windows)` → `{ program, args }` or an error. Rules (documented in the decision record and the prompt):
  - words split at unquoted spaces and tabs; `'…'` is literal; `"…"` is literal except, on Linux, `\"` and `\\`; on Linux an unquoted `\` escapes the next character; on Windows `\` is always literal (paths);
  - nothing is expanded: no variables, `~`, globs, `$()` or backticks. An unquoted `|`, `||`, `&`, `&&`, `;`, `<`, `>`, `>>`, `2>`… word is refused with a hint (quote it, or run `sh -c '…'`);
  - `{}` unquoted, as a word or inside one (`--in={}`), is replaced by the selected file's path; without one the path is appended; `'{}'` is a literal `{}`. The path is inserted after splitting, so it's always inside one argument.
  - The placeholder is `grep -n TODO {}` on Linux and `findstr /n TODO {}` on Windows. The command runs in the tab's folder.
- **`src/openWith.ts`:** `openFile(path)` (double-click, Enter, Open, sidebar Open, Inspector run chip, Default App): opens with the default app; `opened: false` → "No app is set to open … (type)" with **Choose App…**; a failure → the error with **Choose App…**. `chooseApp(path)`: a pick list of `open_with_apps` (default marked) plus **Choose a program…**, which opens the file dialog (Windows: exe/com/bat/cmd) and runs `open_with_program`. Errors are shown.
- **Open With submenu:** Default App, the apps for the file's type (a new dynamic source, `open-with-apps`, with the file's path as its argument; one click launches, at most 12), **Choose App…**, then after a separator VS Code, Terminal, Text Editor (.txt) and Custom Command…. The palette gets Choose App… through the submenu, as for the others.
- The Inspector's VS Code chip uses `spawnVscodeStrict` and shows its error. The unused `openWithDefault` and `spawnVscode` (safe) wrappers go.
- **Site demo mock:** `open_with_apps` returns two pretend apps; launching one shows the "not in the demo" notice.

### Not done
- Remembering a choice per type (Linux could write `mimeapps.list`, Windows has its own "Always"); recorded as a follow-up.
- Opening several selected files at once: Open With acts on the first selected item, as Open does. The backend takes a list.
- MIME `magic` sniffing; DBus activation (entries are launched by `Exec`); startup notification.

## Tests
- Rust: glob matching and precedence, aliases and parents, desktop entry parsing (localized names, escapes, Hidden, TryExec), mimeapps precedence (desktop-specific, Removed, defaults per parent type), Exec expansion with hostile names (spaces, `"`, `'`, `;`, `$()`, backticks, a leading `-`, `%`), and an end-to-end launch of a fake entry whose program records its argv.
- vitest: the command-line splitter and placeholder with the same hostile names; `openFile` / `chooseApp` flows; routing tests updated.

## Status
- [ ] plan and decision record
- [ ] backend: xdg_apps, commands, Windows module, run_script resolution
- [ ] frontend: commandLine, openWith, menus, call sites, demo mock
- [ ] tests and checks (build, test, check:wiring, clippy, cargo test, Windows type-check, site build and capture check)
