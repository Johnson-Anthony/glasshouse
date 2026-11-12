# find-replace-safety

Task 7 of `docs/plans/active/survey-2.md`. Rust and frontend. Branch `claude/bold-leavitt-81abd0`.

## Goal
Find & Replace in Files never damages a file: it changes only valid UTF-8 text, writes each file atomically, matches the same way when it counts and when it replaces, shows what it will do before it does it, says when it stopped early, and can be undone.

## Backend: `commands/replace.rs`
- **`replace_preview(root, query, replacement, case_insensitive, op_id)`** walks `root` as Find in Files does (gitignore and hidden filters, links not followed), in name order so a capped run is repeatable. A file with a match is either planned (`path`, `matches`, `bytes`, `new_bytes`) or skipped with a reason:
  - not valid UTF-8, or binary (has a NUL byte);
  - larger than the size limit;
  - read-only, or (unix) has other hard links, since a rename would split them;
  - can't be opened.
  It stops after 500 files with matches and says so (`capped`).
- **`replace_apply(root, query, replacement, case_insensitive, paths, keep_content, op_id)`** changes only the previewed paths. Each must still be a regular file inside `root` (canonical parent under the canonical root, not a link). It re-reads the file, replaces with the same matcher, and writes through a temp file in the same folder: permissions copied, fsync, a check that the file didn't change meanwhile, rename, folder fsync. It returns each changed file's match count, plus its before/after text when `keep_content` is set and the total stays under the undo budget. A cancel stops between files and still returns what was changed.
- **`rewrite_text(path, content)`** replaces an existing file's text the same atomic way. Undo and redo use it.
- One matcher (`regex`, escaped literal, `(?i)` when asked) for counting and replacing. The handler asks for exact case.
- New commands go in `permissions/app.toml`: preview in files-read, apply and rewrite in files-write.

## Frontend
- `api.ts`: `replacePreview`, `replaceApply`, `rewriteText`.
- `handlers/tools.ts`:
  - prompt for the needle and the replacement;
  - preview as an op;
  - a confirm listing files with match counts (the first 20), the skipped files with reasons, the cap, and whether undo is possible;
  - apply as an op, then report what happened. A toast when everything went through; otherwise an alert covering skipped and failed files, the cap and a cancel.
  - The message builders and the undo entry are in `src/findReplace.ts`, so they can be tested.
- `undoActions.ts`: `contentsUndo(label, changes)`. It checks every file before writing any, and rolls back on a failed write. Writes go through `rewriteText`. When any changed file's text wasn't kept, `markIrreversible`.
- The site demo's mock backend gets the three commands, so the demo's Find & Replace keeps working.

## Tests
- Rust: non-UTF-8 and binary files are skipped and reported; the file is replaced atomically with its mode kept; one case rule for count and replace; the cap; paths outside the root and links are refused; FIFOs are refused without blocking; a cancel returns partial results; `rewrite_text` refuses links and missing files.
- vitest: the handler round trip (preview → confirm → apply → undo → redo) against the mocked API, the irreversible path, cap and skip reporting, and `contentsUndo` refusing when one file changed.

## Status
- [x] Backend commands and 15 Rust tests.
- [x] Frontend handler, `contentsUndo`, the message builders and the demo mock, with tests (20 new vitest).
- [x] Decision record: `docs/decisions/2026-11-12-find-replace-safety-design.md`.
- [x] Windows `swap_in` (ReplaceFileW) type-checked with clippy for `x86_64-pc-windows-msvc` in a scratch crate. The rest of the module's Windows paths are plain std and were not built for Windows.
- [ ] Checks on the merged tree, then handoff.
