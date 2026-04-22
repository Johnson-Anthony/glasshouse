import type { Handler } from "./types";

function globToRegex(glob: string): RegExp {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + out + "$");
}

export const selectionHandler: Handler = (label, ctx) => {
  const handle = ctx.activeHandle;
  if (!handle) return false;
  const { entries, selected } = handle.state;
  const { setSelected } = handle.actions;

  switch (label) {
    case "Select All": {
      setSelected(entries.map((_, i) => i));
      return true;
    }
    case "Invert Selection": {
      const sel = new Set(selected);
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (!sel.has(i)) next.push(i);
      }
      setSelected(next);
      return true;
    }
    case "Deselect": {
      setSelected([]);
      return true;
    }
    case "Select by Pattern…": {
      const pattern = window.prompt("glob pattern:");
      if (pattern == null) return true;
      const re = globToRegex(pattern);
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (re.test(entries[i].name)) next.push(i);
      }
      setSelected(next);
      return true;
    }
    case "Select by Regex…": {
      const pattern = window.prompt("regex:");
      if (pattern == null) return true;
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        return true;
      }
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (re.test(entries[i].name)) next.push(i);
      }
      setSelected(next);
      return true;
    }
    case "Select by Extension →": {
      const ext = window.prompt("extension (no dot):");
      if (ext == null) return true;
      const target = ext.toLowerCase();
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].ext.toLowerCase() === target) next.push(i);
      }
      setSelected(next);
      return true;
    }
    case "Select Modified (Git)": {
      const modified = new Set(["M", "A", "D", "R", "U"]);
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        const g = entries[i].git;
        if (g && modified.has(g)) next.push(i);
      }
      setSelected(next);
      return true;
    }
    case "Select Untracked": {
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].git === "?") next.push(i);
      }
      setSelected(next);
      return true;
    }
    case "Expand Selection to Folder": {
      const hasFolder = selected.some(i => entries[i]?.kind === "folder");
      if (!hasFolder) return true;
      setSelected(entries.map((_, i) => i));
      return true;
    }
    case "Add Next Match": {
      if (selected.length === 0 || entries.length === 0) return true;
      const first = entries[selected[0]];
      if (!first) return true;
      const escaped = first.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ext = first.ext || "";
      const pattern = ext
        ? new RegExp("\\." + ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i")
        : new RegExp("^" + escaped + "$");
      const selSet = new Set(selected);
      const lastIdx = Math.max(...selected);
      let matchIdx = -1;
      for (let i = lastIdx + 1; i < entries.length; i++) {
        if (!selSet.has(i) && pattern.test(entries[i].name)) { matchIdx = i; break; }
      }
      if (matchIdx < 0) {
        for (let i = 0; i < entries.length; i++) {
          if (!selSet.has(i) && pattern.test(entries[i].name)) { matchIdx = i; break; }
        }
      }
      if (matchIdx < 0) return true;
      setSelected([...selected, matchIdx]);
      return true;
    }
    default:
      return false;
  }
};
