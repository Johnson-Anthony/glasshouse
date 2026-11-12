# When the terminal may type a follow-folder `cd`

Date: 2026-11-11 · Task: `terminal-cd` (second survey, task 4)

`TermPane` used to type `cd …⏎` into the visible tab's pty on every folder change, whatever was running: with the drawer closed, into vim, at a sudo prompt, or after a half-typed command. The last is the dangerous case. `rm -r ` with a typed `cd '/x'` and Enter runs `rm -r cd /x`.

## Decision
`followDecision` in `src/shellCd.ts` returns send, wait or skip.
- **Skip** unless all of these hold:
  - the Follow Folder setting is on (Tweaks → "terminal follows folder", or Terminal → Follow Folder; on by default);
  - the drawer is open, and this is its active tab;
  - nothing is typed on the line.
- **Wait** while a command runs or a full-screen program shows, but only for shells that announce their line editor. The `cd` for the latest folder is sent at the next prompt, if it's allowed by then.
- **Send** otherwise.
- **A skipped `cd` is never replayed.** Opening the drawer or switching tabs doesn't move a shell you left somewhere on purpose, the same rule hidden tabs already had.

**How "typed" and "busy" are known** (`PromptTracker`):
- **Busy:** bash 5.1+, zsh and fish turn bracketed paste mode on (`CSI ? 2004 h`) each time they start reading a line, and off before they run the command. `TermPane` hooks those two sequences in xterm's parser. Once a shell has shown the signal, "off" means busy: sudo, `cat`, `make`.
- **Full-screen programs:** the alternate screen (vim, less, htop, nano) also blocks the `cd`.
- **Typed:** any user input since the last Enter, Ctrl+C or new prompt counts as typed, even keys that don't change the line, so the guess errs towards "typed".
  - Terminal reports that xterm sends by itself don't count (focus in and out, DA, cursor position, mouse, OSC and DCS replies). Without that, a shell with focus reporting on would lose follow-folder every time focus left the terminal.
  - Input during a busy spell is carried over to the next line, because it may come back as typeahead.
  - Input to a full-screen program isn't carried over.
- **Shells that never signal** (older bash, PowerShell): only Enter and Ctrl+C end a line, and a busy shell can't be seen.

**Why wait instead of skipping while busy:** a `cd` makes the shell busy for as long as its prompt takes to draw, which is often hundreds of milliseconds with a git prompt. Two quick folder changes would otherwise leave the shell one folder behind.

## Rejected
- **Clearing the line first (Ctrl+U, Escape) and then typing the `cd`.** The keys mean different things in each shell and mode; Escape is a meta prefix in readline, and in vi mode Ctrl+U doesn't clear the line. It would also throw away what the user was typing.
- **Gating only on the drawer being open,** as the survey suggested. That still types into a half-written command, vim or a sudo prompt in plain view.

## Limits
- **A program that reads lines with its own line editor** looks idle and gets the `cd` typed into it. Examples are ssh or a Python REPL started from a local shell. With the quoting fixed, that's a harmless failing command, but only the backend can tell for sure: it would need `tcgetpgrp` on the pty master compared with the shell's pid on unix, and the shell's child processes on Windows. Suggested as a follow-up.
- **PowerShell** doesn't signal, so a `cd` sent while it's busy is queued as typeahead.
