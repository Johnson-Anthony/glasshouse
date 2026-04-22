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
      console.log("Expand Selection to Folder: MVP selects all entries");
      setSelected(entries.map((_, i) => i));
      return true;
    }
    case "Add Next Match": {
      console.log("Add Next Match: no-op for MVP");
      return true;
    }
    default:
      return false;
  }
};
