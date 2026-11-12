# Quoting the terminal's `cd`, per shell

Date: 2026-11-11 · Task: `terminal-cd` (second survey, task 4)

The follow-folder `cd` and Copy as Command used to wrap the path in double quotes. A folder named `$(touch PWNED)` ran that command in bash, zsh, fish and PowerShell; I confirmed it with bash. Both now go through `cdCommand(flavor, path)` in `src/shellCd.ts`.

## Decision
- **POSIX shells and fish share one form.** Text goes in single quotes, and each `'` and `\` is written *outside* the quotes as `\'` or `\\`: `it's` becomes `'it'\''s'`, and `trailing\` becomes `'trailing'\\`.
  - **Why not plain `'\''` escaping:** fish, unlike POSIX shells, reads `\'` and `\\` as escapes inside single quotes. A trailing `\` would then swallow the closing quote. Keeping both characters out of the quotes gives a string that means the same in sh, dash, bash, zsh (with or without `RC_QUOTES`, since the output never has `''` inside a quoted run) and fish.
  - **One form instead of detecting fish:** a WSL profile runs whatever login shell the distro has, which the app can't see.
- **PowerShell** gets `Set-Location -LiteralPath '…'`, doubling `'` and also ‘ ’ ‚ ‛, which PowerShell accepts as single quotes. `-LiteralPath` keeps `[`, `]`, `*` and `?` from being read as wildcards.
- **cmd** gets `cd /d "…"`. A path containing `%`, `!` or `"` gets no command at all: cmd expands `%VAR%` (and, with delayed expansion, `!VAR!`) inside quotes, and an interactive line can't escape it. No profile spawns cmd today; the rule is there for when one does.
- **Control characters (C0, DEL, C1) get no command in any shell.** Typed into a line editor they're keys, not text. Readline's Ctrl+X Ctrl+E alone runs the line through `$EDITOR`, and no quoting changes that. Copy as Command shows a toast instead of copying.
- **Shells we don't know get no follow `cd`:** a nu, xonsh, tcsh or elvish login shell, and ssh profiles. Guessing their quoting could run part of a folder name.
- **Copy as Command** uses PowerShell syntax on Windows (the default shell in Windows Terminal), and POSIX syntax elsewhere. Pasted into cmd, the PowerShell form fails harmlessly.

## Tests
`src/shellCd.test.ts`:
- Unit tests for every rule.
- 27 hostile folder names (`$(…)`, backticks, `${IFS}`, `'`, `"`, `;`, `&`, `|`, `>`, `%PATH%`, `!!`, `\`, `~`, `*`, globs, Unicode quotes…). Each is created on disk, then the generated `cd` is run in sh, dash, bash, zsh, fish and pwsh. Every shell must land in exactly that folder, and no `PWNED` file may appear. A shell that isn't installed is skipped: this machine has sh, dash and bash; GitHub's Ubuntu runner adds pwsh.
- Interactive bash with history expansion on, to check `!` stays literal.
