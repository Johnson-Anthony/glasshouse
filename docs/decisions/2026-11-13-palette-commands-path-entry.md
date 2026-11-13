# Palette: path entry works, the other promises go

Task: palette-commands (survey-2 §15), 2026-11-13.

## Context
The palette's placeholder said "type a command, path, or :mode", and its footer offered Tab autocomplete, Ctrl+` to run in the terminal, and `:go`, `/find`, `?help` and `!shell` prefixes; with no match it said "try :help". None of it existed: the palette only fuzzy-matched its 19 entries, and Enter on no match closed it.

The router already had the other half of path entry: `navHandler`'s default case opens any label that looks like a path (`/…`, `~…`, `C:\…`), expanding `~`. Its comment said it was there for palette dispatches, but the palette never sent one.

## Decision
- **Path entry works.** A query that looks like a path gets a first row, "Go to <path>", which sends the typed path through `handleMenuCommand` like any other row; `navHandler` opens it. The test is one function, `looksLikePath` in `paths.ts`, used by both, so the palette never offers a path the router won't take.
- **Everything else goes:** the `:mode`, `:go`, `/find`, `?help` and `!shell` prefixes, Tab autocomplete, Ctrl+` and "try :help". The placeholder now reads "type a command, or a path (/…, ~/…)" (`C:\…, ~\…` on Windows), and the footer lists only ↵, Esc and "a typed path opens that folder". Tab no longer moves focus out of the box.

## Why
- Path entry is almost free (the router's half was written and tested only by the audit), and it's what a file manager's palette is most often asked for after commands. Ctrl+L / Go to Path… does the same, but needs a second dialog.
- The prefixes would each be a small feature with its own UI (`:mode` and `?help` overlap with what plain search now finds; `!shell` needs a decision about where output goes, and Run Script on Selection… exists). Find in Files and Find File by Name are palette rows. Path completion on Tab would need a directory listing per keystroke; it can come later.

## Limits
- What `goTo` does with the path is unchanged: a file's path gives "can't read this folder", and `~` is expanded only here. Task 17 (paths-and-search) makes `goTo` open a file's folder with the file selected, and the palette gets that for free.
- A relative path (`src/app`) and a UNC path (`\\server\share`) aren't recognised, as before.
