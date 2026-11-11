# terminal-cd

Branch: `claude/youthful-shtern-2ac1c5` (worktree `youthful-shtern-2ac1c5`). Second survey, task 4 (`docs/plans/active/survey-2.md`). Frontend only.

## Problem
1. **Follow-folder `cd` runs commands.** `makeCdCommand` (`src/shellCd.ts`) wraps the path in double quotes. Browsing into a folder named `$(touch PWNED)` runs that command in bash, zsh and fish, and in PowerShell, which also expands `$(…)` inside double quotes.
2. **The `cd` is typed into whatever is running.** `TermPane` sends it whenever the active tab's folder changes: with the drawer closed, into vim or a REPL, at a sudo prompt, and after a half-typed command. That last case is the worst one: `rm -r ` plus a typed `cd '/x'` plus Enter runs `rm -r cd /x`.
3. **Copy as Command** (`handlers/target.ts`) builds `cd ${JSON.stringify(path)}`, which has the same double-quote problem. On Windows it also doubles every backslash.
4. **Ctrl+Shift+` opens two terminal tabs while the drawer is open.** `keymap.ts` sends "New Terminal Tab", and `Terminal.tsx` also has its own capture-phase listener. xterm has no binding for Ctrl+Shift+`, so it passes the key on, and both handlers fire.

## Approach
1. **Quote per shell** in `shellCd.ts`. `cdCommand(flavor, path)` returns `null` when the path can't be typed safely.
   - **POSIX shells and fish:** `cd 'run'\''run'`. Text goes in single quotes, and each `'` and `\` is written unquoted as `\'` or `\\`. That one form is correct in bash, zsh, dash and fish (fish treats `\` inside single quotes as an escape), so the quoting doesn't depend on which shell is running inside WSL.
   - **PowerShell:** `Set-Location -LiteralPath '…'`, doubling `'` and the Unicode single quotes ‘ ’ ‚ ‛, which PowerShell also accepts as quotes.
   - **cmd:** `cd /d "…"`. It returns `null` for a path containing `%`, `!` or `"`, because cmd expands `%VAR%` even inside quotes and an interactive line has no way to escape it.
   - **Every shell:** it returns `null` for a path containing control characters (C0, DEL, C1). Typed into a line editor, those act as editing keys: readline's Ctrl+X Ctrl+E, for one, runs the line in `$EDITOR`.
   - **Unknown shells** (a nu, xonsh or tcsh login shell, and ssh) get no follow `cd` rather than a guess.
2. **Copy as Command** uses the same builder: PowerShell syntax on Windows and POSIX elsewhere. A path it can't quote gets a toast instead of a copy.
3. **Only send the `cd` when the shell is waiting at an empty prompt.** A pure `followAllowed(state)` in `shellCd.ts` decides; `TermPane` tracks the inputs it needs. All of these must hold:
   - the drawer is open and the pane is the visible tab;
   - the new Follow Folder setting is on;
   - the alternate screen isn't active (that rules out vim, less, htop and nano);
   - nothing has been typed on the current line;
   - if the shell has announced its line editor (bracketed paste mode, `CSI ? 2004 h`, which bash 5.1+, zsh and fish switch on only while reading a line), that mode is on now. That rules out sudo prompts, `cat` and long-running commands.
   - A skipped `cd` is not replayed later, the same as for hidden tabs today.
4. **What counts as typed:** any user input since the last Enter, Ctrl+C or new prompt (`2004h`). Terminal reports xterm sends by itself (focus in and out, DA, cursor position, mouse, OSC replies) don't count. The rule is a pure function, `lineDirtyAfter`, with tests.
5. **Follow Folder setting:** `TweakState.termFollow`, on by default. It appears as a Tweaks panel row and as a checked "Follow Folder" item in the Terminal menu (`data.ts` item, `menus.tsx` check, `handlers/view.ts` toggle).
6. **Ctrl+Shift+`:** drop `Terminal.tsx`'s own listener. The keymap binding already covers the open drawer, the closed drawer and a focused xterm.
7. **Tests:**
   - `shellCd.test.ts`: every quoting rule against hostile names (`$(…)`, backticks, `'`, `"`, `;`, `&`, `|`, `%VAR%`, `!`, newline, ESC, Unicode quotes, a trailing `\`). The POSIX output is also run through real `sh`, `bash`, `zsh` and `fish` where they're installed, checking the shell receives the exact name and runs nothing;
   - `followAllowed`, `lineDirtyAfter` and the report filter;
   - `keymap.test.ts`, plus a source check that `Terminal.tsx` registers no keydown listener of its own.

## Not in scope
- **Knowing the foreground process for certain** (ssh or a REPL started inside a local shell keeps bracketed paste on). That needs the backend: `tcgetpgrp` on the pty master against the shell's pid. I'll suggest it to the lead as a follow-up.
- **Git Bash on Windows** gets `/mnt/c/…` paths from `winPathToWsl`, which is the WSL form; Git Bash wants `/c/…`. This is pre-existing; I'll suggest it as a follow-up.

## Status
**Done 2026-11-11.** Ready to merge.
- [x] Quoting and `cd` builder (`shellCd.ts`), with tests. The real-shell tests run sh, dash and bash here; zsh, fish and pwsh aren't installed, so those skip. GitHub's Ubuntu runner has pwsh, so CI runs the PowerShell check.
- [x] Follow gating in `TermPane` (`PromptTracker`, `followDecision`, xterm parser hooks for `CSI ? 2004 h/l`), with tests.
- [x] Follow Folder setting: a Tweaks row, and Terminal → Follow Folder (checked).
- [x] Ctrl+Shift+`: `Terminal.tsx`'s own listener removed; a source test guards against it coming back.
- [x] Copy as Command uses `cdCommand`, with routing tests.
- [x] The demo's fake shell reads `\'` and `\\` outside quotes, like a real shell; the demo is rebuilt.
- [x] Checks:
  - `pnpm build` passes;
  - `pnpm test`: 308 tests, 305 passed and 3 skipped (zsh, fish and pwsh aren't installed);
  - `pnpm check:wiring`: 0 problems;
  - `pnpm site:build` passes;
  - `pnpm site:capture check`: 18/18 pass.
- [x] Tried in the demo (real UI, fake shell):
  - the shell follows with `cd '/home/demo'`;
  - a half-typed `rm -r ` blocks the `cd`, and following resumes after Enter;
  - one Ctrl+Shift+` press adds one tab;
  - with Follow Folder off, nothing is sent.
- **Not tried:** the real app (no `tauri:dev` this pass). That leaves bracketed-paste detection with a real bash, zsh or fish, the PowerShell `cd`, and everything on Windows. Decisions: `docs/decisions/2026-11-11-terminal-cd-quoting.md` and `docs/decisions/2026-11-11-terminal-cd-when-to-send.md`.
