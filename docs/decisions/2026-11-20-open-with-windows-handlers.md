# open-with: the app list on Windows comes from the shell

Date: 2026-11-20. Task: `open-with` (survey-2 task 21). Not built on this machine; CI's windows job is its first compile. `win_open_with.rs`, and `open_with.rs` with its Tauri attribute stripped, were type-checked and linted for `x86_64-pc-windows-msvc` through a scratch crate (the recipe in `~/.claude/environment.md`). None of it has run.

## Chosen
- **Listing (`open_with_apps`):** `SHAssocEnumHandlers(".ext", ASSOC_FILTER_RECOMMENDED)`, the API behind Explorer's "Open with" submenu. Each `IAssocHandler` gives `GetUIName` (shown) and `GetName` (the id, usually the program's path). At most 64, deduplicated case-insensitively. A file with no extension lists nothing, leaving Choose a program….
- **Launching (`open_with_app`):** list the handlers for the file's extension again, find the one whose `GetName` matches the id, and call `IAssocHandler::Invoke` with the file's `IDataObject` (`SHCreateItemFromParsingName` → `BindToHandler(BHID_DataObject)`). The shell runs the handler's verb and builds whatever command line it needs, so glasshouse never puts a path on one.
- **Text Editor (.txt):** `ShellExecuteExW` with `SEE_MASK_CLASSNAME` and `lpClass = ".txt"`, which opens any file with whatever opens `.txt` files. `SEE_MASK_FLAG_NO_UI` makes a failure come back as an error the UI shows, not a system dialog. `SEE_MASK_NOASYNC` makes it finish before the thread exits. It needs the `windows` crate's `Win32_System_Registry` feature, now in Cargo.toml (no lockfile change).
- **Default open** stays `tauri_plugin_opener::open_path` (ShellExecuteExW). For a type nothing opens, Windows shows its own "How do you want to open this file?" chooser, which is already a way on. If it returns `ERROR_NO_ASSOCIATION` (1155) instead, that maps to `opened: false` and glasshouse offers its own Choose App….
- **COM:** each call runs on a short-lived thread of its own, with COM initialised as a single-threaded apartment (`COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE`), as the shell's handlers expect. A fresh thread, because Tauri's worker threads may already be in another apartment, or may stay in one for the next command.
- **Choose a program…:** the file dialog filters to `exe`, `com`, `bat` and `cmd`. The program is started directly, with the file as its argument. For a `.bat`/`.cmd`, std goes through cmd.exe and escapes the arguments for cmd, or refuses those it can't escape (the CVE-2024-24576 fix), as `spawn_vscode` and `run_script` already rely on.

## Rejected
- **Reading the registry ourselves,** as the backlog suggested: `HKCR\.ext\OpenWithProgids` and `OpenWithList`, the per-user `FileExts` keys, `SystemFileAssociations` and the perceived type, then a friendly name per ProgID. That's what `SHAssocEnumHandlers` already does, including the user's own choices and Store (AppX) apps, which have no program path to run. Launching would then mean `ShellExecuteExW` with each ProgID as the class, which fails for the `OpenWithList` entries that only App Paths knows. The shell's own list and launch cover all of that.
- **Running a handler's `shell\open\command` ourselves.** That command is a command-line template (`"C:\…\app.exe" "%1"`). Filling it in is exactly the string building the command-security rules forbid.

## Not verified
None of this has run. Things to check on a real Windows machine:
- Explorer's Open with submenu lists the same apps for `.txt`, `.png` and `.pdf`.
- A Store app (Photos) starts.
- Text Editor (.txt) on a `.log` file opens Notepad.
- A `.bat` picked as the program runs with a name containing `&`.
- A type with no app at all shows Windows' chooser on double-click.
