// Pure helpers for building the "cd" command sent to a terminal tab when the
// browsing cwd changes. Extracted from Terminal.tsx so they can be unit-tested
// without pulling in xterm.
import type { ShellProfile } from "./api";

type ShellFlavor = "pwsh" | "posix" | "ssh";

/** Classify the profile so we know which cd syntax to emit. Tauri reports
 *  every Windows shell under `kind: "shell"`, so we fall back to `id` (which
 *  is set by Rust as `shell:pwsh`, `shell:bash`, etc.) and then to `exec`. */
function flavorOf(profile: ShellProfile): ShellFlavor {
  if (profile.kind === "ssh") return "ssh";
  if (profile.kind === "wsl") return "posix";
  const id = profile.id.toLowerCase();
  const exec = profile.exec.toLowerCase();
  if (id.includes("pwsh") || id.includes("powershell") ||
      exec.endsWith("pwsh.exe") || exec.endsWith("powershell.exe") ||
      exec.endsWith("cmd.exe")) {
    return "pwsh";
  }
  return "posix";
}

/** Rewrite a Windows drive-letter path (`C:\Users\foo`) to the WSL mount
 *  form (`/mnt/c/Users/foo`) so bash/zsh/fish can cd into it. Already-WSL
 *  paths and non-Windows paths are returned untouched. UNC (`\\wsl$\…`) is
 *  stripped and translated to `/` for linux shells. */
export function winPathToWsl(path: string): string {
  const unc = path.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/i);
  if (unc) {
    const rest = (unc[1] ?? "").replace(/\\/g, "/");
    return rest.length > 0 ? rest : "/";
  }
  const drive = path.match(/^([A-Za-z]):[\\/](.*)$/);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, "/");
    return `/mnt/${letter}/${rest}`.replace(/\/+$/, "") || `/mnt/${letter}`;
  }
  const bareDrive = path.match(/^([A-Za-z]):$/);
  if (bareDrive) return `/mnt/${bareDrive[1].toLowerCase()}`;
  return path;
}

function shellQuote(p: string): string {
  // Wrap in double quotes and escape embedded double quotes for both
  // PowerShell and POSIX shells. Paths with `$` in pwsh would still expand
  // variables — we accept that; most real paths don't hit this.
  return `"${p.replace(/"/g, '\\"')}"`;
}

/** Build the cd command to send when the active tab's cwd changes. Returns
 *  `null` when the active profile can't meaningfully cd (ssh sessions). */
export function makeCdCommand(profile: ShellProfile, path: string): string | null {
  const flavor = flavorOf(profile);
  if (flavor === "ssh") return null;
  if (flavor === "pwsh") {
    return `Set-Location ${shellQuote(path)}`;
  }
  return `cd ${shellQuote(winPathToWsl(path))}`;
}
