// Strict octal permission-mode parsing for chmod prompts. parseInt(v, 8)
// stops at the first bad digit ("78" → 7, "0o755" → 0), so validate the
// whole string first.

const MODE_RE = /^[0-7]{3,4}$/;

/** Parses "644" / "0755" / "1777"; returns null for anything else. */
export function parseOctalMode(input: string): number | null {
  const s = input.trim();
  return MODE_RE.test(s) ? parseInt(s, 8) : null;
}
