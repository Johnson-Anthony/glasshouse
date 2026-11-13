import { dialogs } from "../dialogs/DialogHost";
import type { FileEntry } from "../api";
import { getTags } from "../tags";
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

// Every command picks from the rows on screen (ctx.visibleRows, in display
// order), never from the whole listing: a filter that hides rows must not let
// Select All or Invert put them under a Delete. Indexes are into this ctx's
// entries; setSelected maps them to the same files if the folder is re-listed
// while a prompt is open.
export const selectionHandler: Handler = async (label, ctx) => {
  const handle = ctx.activeHandle;
  if (!handle) return false;
  const { entries, selected } = handle.state;
  const { setSelected } = handle.actions;
  const pick = (test: (e: FileEntry) => boolean): number[] => ctx.visibleRows().filter(i => test(entries[i]));

  switch (label) {
    case "Select All": {
      setSelected(ctx.visibleRows());
      return true;
    }
    case "Invert Selection": {
      const sel = new Set(selected);
      setSelected(ctx.visibleRows().filter(i => !sel.has(i)));
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
      const next = pick(e => re.test(e.name));
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
      const next = pick(e => re.test(e.name));
      setSelected(next);
      dialogs.showToast({
        message: `selected ${next.length} item(s)`,
        variant: next.length > 0 ? "success" : "info",
      });
      return true;
    }
    case "Select by Extension →": {
      // Gather the set of extensions actually present in the current view so
      // we can surface them as hint text — avoids the user typing a
      // non-existent extension and wondering why nothing happened.
      const extSet = new Set<string>();
      for (const i of ctx.visibleRows()) if (entries[i].ext) extSet.add(entries[i].ext.toLowerCase());
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
      const next = pick(e => e.ext.toLowerCase() === target);
      setSelected(next);
      dialogs.showToast({
        message: `selected ${next.length} .${target} file(s)`,
        variant: next.length > 0 ? "success" : "info",
      });
      return true;
    }
    case "Select by Tag →": {
      // Only offer tags that something in this folder carries, as
      // Select by Extension does for extensions.
      const tags = getTags();
      const present = new Set<string>();
      for (const i of ctx.visibleRows()) for (const t of tags[entries[i].path] ?? []) present.add(t);
      if (present.size === 0) {
        dialogs.showToast({ message: "nothing in this folder is tagged", variant: "info" });
        return true;
      }
      const sorted = [...present].sort();
      const tag = await dialogs.showPrompt({
        title: "select by tag",
        message: `present: ${sorted.join(", ")}`,
        initialValue: sorted[0],
        placeholder: "tag",
        validate: (v) => present.has(v.trim()) ? null : "no item here has that tag",
      });
      if (tag == null) return true;
      const target = tag.trim();
      const next = pick(e => (tags[e.path] ?? []).includes(target));
      setSelected(next);
      dialogs.showToast({
        message: `selected ${next.length} item(s) tagged "${target}"`,
        variant: next.length > 0 ? "success" : "info",
      });
      return true;
    }
    case "Select Modified (Git)": {
      const modified = new Set(["M", "A", "D", "R", "U"]);
      setSelected(pick(e => !!e.git && modified.has(e.git)));
      return true;
    }
    case "Select Untracked": {
      setSelected(pick(e => e.git === "?"));
      return true;
    }
    case "Expand Selection to Folder": {
      const hasFolder = selected.some(i => entries[i]?.kind === "folder");
      if (!hasFolder) return true;
      setSelected(ctx.visibleRows());
      return true;
    }
    case "Extend to Line End (Visual)": {
      // Visual-mode-ish: extend selection from the current anchor to the
      // last row of the active pane (inclusive), in display order.
      const rows = ctx.visibleRows();
      if (rows.length === 0) return true;
      const at = rows.indexOf(handle.state.anchorIndex);
      const from = at >= 0 ? at : Math.max(0, rows.indexOf(handle.state.focusIndex));
      setSelected(rows.slice(from));
      handle.actions.setFocusIndex(rows[rows.length - 1]);
      return true;
    }
    case "Add Next Match": {
      const rows = ctx.visibleRows();
      if (selected.length === 0 || rows.length === 0) return true;
      const first = entries[selected[0]];
      if (!first) return true;
      const escaped = first.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ext = first.ext || "";
      const pattern = ext
        ? new RegExp("\\." + ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i")
        : new RegExp("^" + escaped + "$");
      // The next match after the last selected row on screen, wrapping to
      // the top.
      const selSet = new Set(selected);
      let last = rows.length - 1;
      while (last >= 0 && !selSet.has(rows[last])) last--;
      const order = [...rows.slice(last + 1), ...rows.slice(0, last + 1)];
      const match = order.find(i => !selSet.has(i) && pattern.test(entries[i].name));
      if (match === undefined) return true;
      setSelected([...selected, match]);
      return true;
    }
    default:
      return false;
  }
};
