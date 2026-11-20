# open-with: how Custom Command… reads what's typed

Date: 2026-11-20. Task: `open-with` (survey-2 task 21). Keeps `docs/decisions/2026-11-08-command-security-design.md`: no user string becomes a shell command line.

## The problem
Custom Command… sent the whole typed line to `run_script` as the program name, so `grep -n foo` looked for a program called `grep -n foo`. Its placeholder was `echo`, which on Windows is a cmd built-in, not a program.

## Chosen
The frontend splits the line (`src/commandLine.ts`). `run_script(program, args, cwd)` starts the program directly, with no shell, in the tab's folder. These are the rules, and the prompt says them in short:
- **Words** are separated by spaces and tabs outside quotes.
- **Quotes:**
  - `'…'` is literal.
  - `"…"` is literal too, except that on Linux `\"` and `\\` stand for `"` and `\`.
  - On Linux, an unquoted `\` makes the next character literal (`a\ b`).
  - On Windows `\` is always an ordinary character, so `C:\tools\x.exe` and `\\server\share` need no doubling, and `"C:\dir\"` ends where it looks like it ends. To put a `"` in an argument there, use `'…'`.
  - An unclosed quote is refused.
- **Nothing is expanded:** no `$VAR`, `~`, globs, `$(…)` or backticks. They reach the program as text.
- **Shell operators are refused** rather than passed on as arguments, since nobody typing `grep x | wc -l` wants `|` as grep's argument. That covers an unquoted word that is `|`, `||`, `&`, `&&`, `;`, `;;`, `|&`, `&>`, and an unquoted word starting with a redirection (`>out`, `2>&1`, `<in`). Quoted, they're text. Inside a longer word (`a;b`) they're plain characters, because nothing reads them.
- **The file** goes where `{}` is, outside quotes, as a word of its own or inside one (`--in={}`). Without a `{}`, the file goes last. `'{}'`, `"{}"` and `\{}` are a literal `{}`. The path goes in **after** splitting, so it is always inside one argument, whatever its name holds.
  - `{}` can't be the program.
  - Paths are absolute, so a name like `-rf` can't be read as an option.
  - Like the other Open With items, it acts on the first selected item; Run Script on Selection is the one for many.
- **Two shell traps are refused**, because there the file's name would become code:
  - Linux: the name as the script of `sh -c` (also bash, dash, zsh, ksh, mksh, fish, csh, tcsh, ash and busybox; `-c` in a cluster like `-lc`; `-o`/`-O` values skipped; `--` allowed). That covers `sh -c {}`, and `sh -c` with the file appended. After the script it's safe, and the message shows the idiom: `sh -c '… "$1"' sh {}`.
  - Windows: cmd, PowerShell, pwsh, wsl, bash and sh given the file at all. cmd.exe re-parses its whole command line, PowerShell joins `-Command`'s arguments into script, and wsl.exe hands its arguments to a Linux shell. So a name like `a&calc.txt` would run.

  Other programs that run their arguments as commands (`env sh -c`, `ssh host`, `xargs`) aren't caught. What a program does with its arguments is up to it, as in a terminal.
- **The program** is looked up on PATH by `run_script` when it's a bare name (`which`, with PATHEXT on Windows, so `code` finds `code.cmd`). A missing one fails with its name. A relative path is taken from the tab's folder. On Windows std's batch-file escaping applies to a `.bat`/`.cmd`, as before.
- **Placeholder:** `grep -n TODO {}` on Linux, `findstr /n TODO {}` on Windows (findstr.exe is in System32).
- It still waits for the program and shows its output, killing it after 60 s, as before. The prompt says so. Opening the file in an app is what Choose App… is for.

## Rejected
- **Splitting in Rust.** The rules are the same either way, but in the frontend the prompt can check the line as it's typed (unclosed quote, a `|`, `sh -c {}`) and refuse it before anything runs. The backend still only ever gets a program and an argument list.
- **POSIX shell rules on Windows too.** Backslash escapes would mangle every typed Windows path (`C:\new` → `C:new`).
- **Windows' own `CommandLineToArgvW` rules.** Their quote and backslash handling (`\"`, the `2n` backslash rule) is hard to predict when typing, and paths ending in `\` before a quote break.
- **Passing the line to a shell** (`sh -c`, `cmd /c`). That's exactly what the command-security rules rule out, and a file name with `;` or `&` would then run.
