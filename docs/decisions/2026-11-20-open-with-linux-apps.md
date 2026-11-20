# open-with: finding and starting apps on Linux

Date: 2026-11-20. Task: `open-with` (survey-2 task 21). Keeps the rules of `docs/decisions/2026-11-08-command-security-design.md`.

## The problem
`open_with_default` spawned `xdg-open <path>` and returned as soon as it started, so its exit status was lost and the UI's `openWithDefault` swallowed what little error there was. With no desktop environment detected (niri here), xdg-open takes its generic path. That path has three problems:
- it runs the app in the foreground;
- for a type with no app it falls through to `run-mailcap`, `mimeopen` and a list of web browsers, so an unknown file either opens in a browser or nothing happens;
- glasshouse can't tell either way.

Open With also had nothing to choose from.

## Chosen: read the XDG files ourselves (`commands/xdg_apps.rs`)
No new dependency. Each part follows its spec, in GLib's reading where the spec leaves room. GLib is what GNOME, and most apps that open files, use.

### The file's type
- shared-mime-info's `globs2` in every data dir, most important first: `XDG_DATA_HOME`, then `XDG_DATA_DIRS`. The older `globs` format is read where there's no `globs2`; this machine's `~/.local/share/mime` has only that one.
- The best glob wins: highest weight, then longest pattern, then a case-sensitive pattern over one that isn't. Patterns match case-insensitively unless flagged `cs`.
- `__NOGLOBS__` drops a type's globs from less important dirs.
- `aliases` map names onto the canonical type. Every type the code compares (globs, `MimeType=`, `mimeapps.list` keys) is unaliased.
- Folders are `inode/directory`; FIFOs, sockets and devices are `inode/…`, and they're never opened.
- A name no glob matches is sniffed: the first 4 KiB through `open_regular`. ELF is `application/x-executable`; valid UTF-8 with no NUL (or an empty file) is `text/plain`; anything else is `application/octet-stream`.
- The `magic` file isn't read. Most files are typed by name, and magic matters mainly for names that have no extension.

### The apps for a type
- **Desktop entries:** every `*.desktop` under each data dir's `applications/`, recursively (three levels at most, so a link loop can't run away). The desktop ID is the relative path with `/` → `-`. The first dir to have an ID wins, so a `Hidden=true` copy in `~/.local/share/applications` removes a system entry.
- **Installed** means: `Type=Application`, not `Hidden`, a non-empty `Exec`, and a `TryExec` (if any) found on `PATH` or present as an executable file.
- **`mimeapps.list`:** every one the spec names, most important first. Each folder's `<desktop>-mimeapps.list` (from `XDG_CURRENT_DESKTOP`, lowercased) comes before its plain `mimeapps.list`. The folders are `XDG_CONFIG_HOME`, `XDG_CONFIG_DIRS`, then the deprecated `applications/` folders in the data dirs.
- **Associations for one type:** each list's `Added Associations` in order, minus the `Removed Associations` of that list and more important ones; then the entries whose `MimeType=` has the type.
- **The type chain:** the type, its parents from `subclasses` breadth first, and `text/plain` for any `text/*`. `application/octet-stream` is only there when the database names it as a parent.
- **The default**, as `g_app_info_get_default_for_type` picks it: for each type in the chain in turn, its first installed `Default Applications` entry, else its first association. So a `.py` file opens in an app that claims Python before falling back to the text/plain default. GNOME does the same.
- **The list** Open With shows: the default first, then each type's associations, nearest type first. `NoDisplay=true` entries are left out unless one is the default, as GTK's app chooser does; on this machine that hides helpers like `caja-folder-handler` and `codium-url-handler`.
- Everything is read again on each call, with no cache. Indexing this machine's ~800 entries takes about 130 ms in a debug build. It happens once per context menu, chooser or default open, so a cache isn't worth getting stale.

### Starting an entry
`Exec` goes through two rounds of unescaping, as the spec says: first the string escapes (`\s \n \t \r \\`), then its own quoting. Then:
- **Words come first.** A word ends at an unquoted space, tab or newline. In `"…"`, `\"` `` \` `` `\$` `\\` are the characters; other backslashes stay. `'…'` is literal: the spec reserves `'`, and GLib's parser reads it so. An unquoted `\` escapes the next character.
- **Field codes are expanded inside those words**, so a file name is only ever whole argv elements, never parsed again. Spaces, quotes, `;`, `$()` or backticks in a name stay part of it. GLib expands before splitting and shell-quotes each name instead.
  - `%f` and `%u` are a file, the path itself for both. The spec allows a path for `%u`, and paths avoid encoding questions. With several files and no `%F`/`%U`, each file gets its own process.
  - `%F` and `%U` as a word of their own are one argument per file; inside a longer word, the first file.
  - `%i` as its own word is `--icon <Icon>`, `%c` is the name, `%k` is the entry's path, and `%%` is `%`.
  - The deprecated `%d %D %n %N %v %m` and unknown codes are dropped. An unquoted word made only of them goes too.
  - With no file code at all, the files are appended, as xdg-open does.
- **Refused:**
  - a field code inside quotes: the spec leaves it undefined, and `sh -c "cat %f"` would make a file name part of a shell script. None of this machine's ~800 entries does it;
  - a program word that is a field code (`Exec=%f` would run the file).
- **Paths must be absolute** (`open_with_app` and `launch_entry` check), so a name starting with `-` can never be the start of an option.
- **The program** is the first word: looked up on `PATH` unless it contains `/`, and a missing one is an error that names it. `Terminal=true` runs it inside a terminal emulator through `linux_terminal_command`, as terminal profiles are.
- **The working folder** is `Path=` if it exists, else the first file's folder; xdg-open left the app in glasshouse's own.
- **Spawned** through `proc_tree::spawn_detached`: its own session, so closing the terminal that ran `pnpm tauri:dev` doesn't hang it up. stdio is null, and a thread reaps it when it exits.

### Default open
`open_with_default` now finds the default the same way and starts it as above. It reports `opened: false` with the MIME type when no app is set, and the UI then says so and offers Choose App…. A start that fails (the program is missing, say) is an error the UI shows. If no MIME database is found at all, it falls back to xdg-open as before.

## Rejected
- **Keep xdg-open and wait for its exit status.** On niri it runs the app in the foreground, so the status only arrives when the app quits. It still falls back to a browser for unknown types.
- **`gio open` / `gio mime`.** Not installed everywhere (it's part of GLib's tools), its output is meant for people to read, and it would still need parsing.
- **Crates** (`xdg-mime`, `freedesktop-desktop-entry`, `mime_guess`). Each is a new dependency to vet and list in the notices. `mime_guess` only knows extensions, not the user's database. None of them gives the split-then-expand `Exec` handling above, which is the part that matters for safety.
- **DBus activation** (`DBusActivatable=true`). Every such entry on this machine also has an `Exec`, which works. Startup notification isn't sent either.

## Not done
- Remembering a choice per type. Writing `mimeapps.list` would change the default for every app on the desktop, which is more than a "remember" box should do. A follow-up could offer "Set as default" explicitly.
- Opening several selected files at once. Open With acts on the first selected item, as Open does; the backend already takes a list.
