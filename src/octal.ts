// Strict octal permission-mode parsing for chmod prompts. parseInt(v, 8)
// stops at the first bad digit ("78" → 7, "0o755" → 0), so validate the
// whole string first.

const MODE_RE = /^[0-7]{3,4}$/;

/** Parses "644" / "0755" / "1777"; returns null for anything else. */
export function parseOctalMode(input: string): number | null {
  const s = input.trim();
  return MODE_RE.test(s) ? parseInt(s, 8) : null;
}

// Permission bits as the Inspector's grid shows them: `who` is 0 owner,
// 1 group, 2 world; `perm` is 0 read, 1 write, 2 exec.

/** The mode bit for `perm` of `who`: permBit(0, 0) is 0o400. */
export function permBit(who: number, perm: number): number {
  return (4 >> perm) << (3 * (2 - who));
}

/** `mode` with that one bit flipped; setuid, setgid and sticky stay. */
export function toggleBit(mode: number, who: number, perm: number): number {
  return mode ^ permBit(who, perm);
}

/** `ls -l` style: "rwxr-x---", with s/S for setuid and setgid and t/T for
 *  sticky (lower case when the exec bit under it is set too). */
export function modeString(mode: number): string {
  const special = [0o4000, 0o2000, 0o1000];
  const mark = ["s", "s", "t"];
  return [0, 1, 2].map(who => {
    const r = mode & permBit(who, 0) ? "r" : "-";
    const w = mode & permBit(who, 1) ? "w" : "-";
    const x = (mode & permBit(who, 2)) !== 0;
    const sp = (mode & special[who]) !== 0;
    return r + w + (sp ? (x ? mark[who] : mark[who].toUpperCase()) : (x ? "x" : "-"));
  }).join("");
}

/** Four octal digits, as chmod takes them: "0644", "2755". */
export function modeOctal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}
