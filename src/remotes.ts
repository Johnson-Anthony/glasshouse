import type { ShellProfile } from "./api";
import type { SavedRemote } from "./Sidebar";

/** Build the ssh terminal profile for a saved remote, honoring a trailing
 *  :port in the host ("example.com:2222" → ssh -p 2222 example.com). */
export function sshProfileFor(r: SavedRemote): ShellProfile {
  const colonIdx = r.host.lastIndexOf(":");
  const portPart = colonIdx > 0 ? r.host.slice(colonIdx + 1) : "";
  const hasPort = colonIdx > 0 && /^\d+$/.test(portPart);
  const hostOnly = hasPort ? r.host.slice(0, colonIdx) : r.host;
  return {
    id: `ssh:${r.host}`,
    label: `SSH: ${r.label}`,
    kind: "ssh",
    exec: "ssh",
    args: hasPort ? ["-p", portPart, hostOnly] : [hostOnly],
  };
}
