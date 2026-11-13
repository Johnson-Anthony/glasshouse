import { dialogs } from "../dialogs/DialogHost";
import { spawnTerminal, spawnVscodeStrict, revealInExplorer, renameEntry, homeDir, listDir, openWithDefault } from "../api";
import { basename, parentPath, joinPath, normalizePath } from "../paths";
import { namesIn, unlessTaken, transferDeps, pushTransferUndo, reportTransfer } from "../transferUi";
import { NameSet, nameProblem } from "../names";
import { IS_WINDOWS } from "../platform";
import { pushUndo } from "../state";
import { moveUndo } from "../undoActions";
import { runTransfer } from "../transfer";
import type { Handler } from "./types";
import { clearAllTags, copyWslPath, removeTagPrompt } from "./helpers";
import { trashPaths } from "./fileOps";
import { cmdState } from "../commandState";
import { sshProfileFor } from "../remotes";
import { errText } from "../errors";
import { cdCommand } from "../shellCd";

// Commands from a context menu opened on a tab, a saved remote, or a
// sidebar/breadcrumb row. Runs first; the menu's target is in
// cmdState.contextTarget, and a case consumes it. A label with a target but
// no case here is refused rather than passed on, because the later handlers
// act on the pane's selection, not on the right-clicked row. Moved from
// App.tsx's handleMenuCommand.
export const targetHandler: Handler = (label, ctx) => {
  if (!ctx.app) return false;
  const { activeHandle } = ctx;
  const {
    closeOtherTabsAt,
    closeTabAt,
    duplicateTabAt,
    openPathInNewTab,
    persistRemotes,
    pins,
    savePins,
    savedRemotes,
    setFolderPicker,
    setManageRemotesOpen,
    setPropsEntry,
    setTagPickerPath,
    setTermOpen,
    setTermProfile,
  } = ctx.app;
  // Handle context-sourced commands (sidebar / tab / breadcrumb right-click)
  // up front. Consume contextTarget on use so a later selection-sourced
  // click with the same label doesn't misfire.
  const ctxT = cmdState.contextTarget;
  if (ctxT) {
    if (ctxT.kind === "tab" && typeof ctxT.tabIndex === "number") {
      switch (label) {
        case "Close Tab":
          cmdState.contextTarget = null;
          closeTabAt(ctxT.tabIndex); return true;
        case "Close Other Tabs":
          cmdState.contextTarget = null;
          closeOtherTabsAt(ctxT.tabIndex); return true;
        case "Duplicate Tab":
          cmdState.contextTarget = null;
          duplicateTabAt(ctxT.tabIndex); return true;
      }
    } else if (ctxT.kind === "sidebar" && ctxT.rowKind === "remote" && ctxT.path) {
      const host = ctxT.path;
      switch (label) {
        case "Connect": {
          cmdState.contextTarget = null;
          const r = savedRemotes.find(x => x.host === host);
          if (!r) return true;
          setTermProfile(sshProfileFor(r));
          setTermOpen(true);
          void dialogs.showToast({ message: `connecting to ${r.label}…`, variant: "info" });
          return true;
        }
        case "Edit…": {
          cmdState.contextTarget = null;
          setManageRemotesOpen(true);
          return true;
        }
        case "Remove": {
          cmdState.contextTarget = null;
          const idx = savedRemotes.findIndex(x => x.host === host);
          if (idx < 0) return true;
          const r = savedRemotes[idx];
          void (async () => {
            const ok = await dialogs.showConfirm({
              title: "remove remote",
              message: `Remove "${r.label}"?`,
              danger: true,
              okLabel: "remove",
            });
            if (!ok) return;
            persistRemotes(savedRemotes.filter((_, i) => i !== idx));
          })();
          return true;
        }
        case "Manage Remotes…":
          cmdState.contextTarget = null;
          setManageRemotesOpen(true);
          return true;
      }
    } else if ((ctxT.kind === "sidebar" || ctxT.kind === "breadcrumb") && ctxT.path) {
      const target = ctxT.path;
      const isFile = ctxT.rowKind === "tree-file" || ctxT.rowKind === "pinned-file";
      switch (label) {
        case "Open":
          cmdState.contextTarget = null;
          if (isFile) void openWithDefault(target);
          else activeHandle?.actions.goTo(target);
          return true;
        case "Open in New Tab":
          cmdState.contextTarget = null;
          openPathInNewTab(target); return true;
        case "Open in New Window":
          cmdState.contextTarget = null;
          openPathInNewTab(target); return true;
        case "Open in Terminal":
          cmdState.contextTarget = null;
          void spawnTerminal(target); return true;
        case "Open in VS Code":
          cmdState.contextTarget = null;
          void (async () => {
            try { await spawnVscodeStrict(target); }
            catch (err) {
              const msg = errText(err);
              void dialogs.showAlert({ title: "open in VS Code failed", variant: "error", message: msg });
            }
          })();
          return true;
        case "Copy Path":
          cmdState.contextTarget = null;
          void navigator.clipboard.writeText(target); return true;
        case "Copy as WSL Path":
        case "Copy Path (WSL)":
          cmdState.contextTarget = null;
          void copyWslPath(target);
          return true;
        case "Copy as Command": {
          cmdState.contextTarget = null;
          // PowerShell is Windows' default terminal shell.
          const cmd = cdCommand(IS_WINDOWS ? "pwsh" : "posix", target);
          if (cmd === null) {
            void dialogs.showToast({ message: "can't copy as a command: the path has control characters", variant: "info" });
          } else {
            void navigator.clipboard.writeText(cmd);
          }
          return true;
        }
        case "Reveal in Explorer":
          cmdState.contextTarget = null;
          void revealInExplorer(target); return true;
        case "Rename": {
          cmdState.contextTarget = null;
          const base = basename(target);
          void (async () => {
            const dir = parentPath(target);
            // An unreadable folder still gets a prompt; the rename reports it.
            const taken = await namesIn(dir).catch(() => new NameSet([], IS_WINDOWS));
            const next = await dialogs.showPrompt({
              title: "rename",
              message: `rename "${base}" to:`,
              initialValue: base,
              placeholder: "new name",
              validate: (v) => nameProblem(v, taken, base),
              submit: (v) => unlessTaken(v, async () => { if (v !== base) await renameEntry(target, joinPath(dir, v)); }),
            });
            if (!next || next === base) return;
            const dst = joinPath(dir, next);
            try {
              pushUndo(moveUndo(`rename ${base} → ${next}`, [{ src: target, dst }], "rename"));
              activeHandle?.actions.refresh();
            } catch (err) {
              const msg = errText(err);
              void dialogs.showAlert({ message: `rename failed: ${msg}`, variant: "error" });
            }
          })();
          return true;
        }
        case "Move to…": {
          cmdState.contextTarget = null;
          void (async () => {
            const home = await homeDir();
            setFolderPicker({
              initialPath: home ?? undefined,
              title: `move "${basename(target)}" to…`,
              onPick: (to) => {
                setFolderPicker(null);
                void (async () => {
                  const res = await runTransfer([{ path: target }], to, "move", transferDeps);
                  if (!res) return;
                  pushTransferUndo(res, "move", `move ${basename(target)} to ${to}`);
                  reportTransfer(res, "move", true);
                  activeHandle?.actions.refresh();
                })();
              },
            });
          })();
          return true;
        }
        case "Move to Trash": {
          cmdState.contextTarget = null;
          void trashPaths([target], () => activeHandle?.actions.refresh());
          return true;
        }
        case "Pin":
          cmdState.contextTarget = null;
          ctx.pinPath(target);
          return true;
        case "Properties": {
          // Previously fell through to the pane-selection handler, so the
          // dialog showed whatever was selected in the pane instead of the
          // sidebar/breadcrumb row that was right-clicked.
          cmdState.contextTarget = null;
          void (async () => {
            const siblings = await listDir(parentPath(target), true);
            const norm = normalizePath(target);
            const entry = siblings.find(e => normalizePath(e.path) === norm) ?? {
              name: basename(target) || target,
              path: target,
              kind: "folder",
              size: 0,
              modified_ms: 0,
              hidden: false,
              ext: "",
              is_symlink: false,
              lossy: false,
              git: null,
            };
            setPropsEntry(entry);
          })();
          return true;
        }
        case "Add Tag…":
          cmdState.contextTarget = null;
          setTagPickerPath(target);
          return true;
        case "Remove Tag…":
          cmdState.contextTarget = null;
          void removeTagPrompt(target, ctx.app);
          return true;
        case "Clear All Tags": {
          cmdState.contextTarget = null;
          const app = ctx.app;
          void (async () => {
            if (await clearAllTags([target], app) === "none") {
              dialogs.showToast({ message: `${basename(target) || target} has no tags`, variant: "info" });
            }
          })();
          return true;
        }
        case "Unpin": {
          cmdState.contextTarget = null;
          if (!pins.includes(target)) return true;
          savePins(pins.filter(p => p !== target));
          return true;
        }
        case "Move pin up":
        case "Move pin down": {
          cmdState.contextTarget = null;
          const idx = pins.indexOf(target);
          if (idx < 0) return true;
          const dst = label === "Move pin up" ? idx - 1 : idx + 1;
          if (dst < 0 || dst >= pins.length) return true;
          const next = [...pins];
          [next[idx], next[dst]] = [next[dst], next[idx]];
          savePins(next);
          return true;
        }
      }
    }
    // Every item on the target menus is handled above. Passing anything else
    // on would run it on the pane's selection instead of the right-clicked
    // row (Git: Discard on a sidebar file once discarded the pane's files).
    cmdState.contextTarget = null;
    console.warn("no context-menu handler for this target:", label, ctxT);
    dialogs.showToast({ message: `"${label}" isn't available here`, variant: "warning" });
    return true;
  }
  return false;
};
