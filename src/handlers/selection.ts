import { dialogs } from "../components";
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

export const selectionHandler: Handler = async (label, ctx) => {
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
      const pattern = await dialogs.showPrompt({
        title: "select by glob",
        message: "match files whose name matches this glob (use * and ?):",
        placeholder: "*.ts",
        validate: (v) => v.trim() ? null : "pattern required",
      });
      if (pattern == null) return true;
      const re = globToRegex(pattern);
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (re.test(entries[i].name)) next.push(i);
      }
      setSelected(next);
      dialogs.showToast({
        message: `selected ${next.length} item(s) matching "${pattern}"`,
        variant: next.length > 0 ? "success" : "info",
      });
      return true;
    }
    case "Select by Regex…": {
      const pattern = await dialogs.showPrompt({
        title: "select by regex",
        message: "match files whose name matches this JavaScript regex:",
        placeholder: "^test_.*\\.ts$",
        validate: (v) => {
          if (!v.trim()) return "regex required";
          try { new RegExp(v); return null; }
          catch (e) { return e instanceof Error ? `invalid: ${e.message}` : "invalid regex"; }
        },
      });
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
      dialogs.showToast({
        message: `selected ${next.length} item(s)`,
        variant: next.length > 0 ? "success" : "info",
      });
      return true;
    }
    case "Select by Extension →":
    case "Select by Extension": {
      // Gather the set of extensions actually present in the current view so
      // we can surface them as hint text — avoids the user typing a
      // non-existent extension and wondering why nothing happened.
      const extSet = new Set<string>();
      for (const e of entries) if (e.ext) extSet.add(e.ext.toLowerCase());
      const hint = extSet.size > 0
        ? `present: ${[...extSet].sort().slice(0, 10).join(", ")}${extSet.size > 10 ? ", …" : ""}`
        : "no extensions in current folder";
      const ext = await dialogs.showPrompt({
        title: "select by extension",
        message: hint,
        placeholder: "ts",
        validate: (v) => v.trim() ? null : "extension required",
      });
      if (ext == null) return true;
      const target = ext.replace(/^\./, "").toLowerCase();
      const next: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].ext.toLowerCase() === target) next.push(i);
      }
      setSelected(next);
      dialogs.showToast({
        message: `selected ${next.length} .${target} file(s)`,
        variant: next.length > 0 ? "success" : "info",
      });
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
    case "Extend to Line End (Visual)": {
      // Visual-mode-ish: extend selection from the current anchor to the
      // last entry of the active pane (inclusive).
      if (entries.length === 0) return true;
      const anchor = Math.max(0, Math.min(handle.state.anchorIndex, entries.length - 1));
      const end = entries.length - 1;
      const lo = Math.min(anchor, end);
      const hi = Math.max(anchor, end);
      const next: number[] = [];
      for (let i = lo; i <= hi; i++) next.push(i);
      setSelected(next);
      handle.actions.setFocusIndex(end);
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
