import { dialogs } from "../dialogs/DialogHost";
import { spawnTerminal, spawnVscodeStrict, winToWsl, revealInExplorer, renameEntry, homeDir, moveToTrash, writePins, listDir } from "../api";
import { winPathToWsl } from "../shellCd";
import { basename, parentPath, joinPath, normalizePath } from "../paths";
import { namesIn, unlessTaken, transferDeps, pushTransferUndo, reportTransfer } from "../transferUi";
import { NameSet, nameProblem } from "../names";
import { IS_WINDOWS } from "../platform";
import { pushUndo } from "../state";
import { moveUndo } from "../undoActions";
import { runTransfer } from "../transfer";
import type { Handler } from "./types";
import { cmdState } from "../commandState";
import { sshProfileFor } from "../remotes";

// Commands from a context menu opened on a tab, a saved remote, or a
// sidebar/breadcrumb folder. Runs first; the menu's target is in
// cmdState.contextTarget, and a case consumes it. Moved from App.tsx's
// handleMenuCommand.
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
    savedRemotes,
    setFolderPicker,
    setManageRemotesOpen,
    setPins,
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
      switch (label) {
        case "Open":
          cmdState.contextTarget = null;
          activeHandle?.actions.goTo(target); return true;
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
              const msg = err instanceof Error ? err.message : String(err);
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
          void (async () => {
            let wsl = "";
            try { wsl = await winToWsl(target); } catch { wsl = ""; }
            if (!wsl) wsl = winPathToWsl(target);
            await navigator.clipboard.writeText(wsl);
          })();
          return true;
        case "Copy as Command":
          cmdState.contextTarget = null;
          void navigator.clipboard.writeText(`cd ${JSON.stringify(target)}`);
          return true;
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
              const msg = err instanceof Error ? err.message : String(err);
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
          void (async () => {
            try {
              await moveToTrash(target);
              activeHandle?.actions.refresh();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              void dialogs.showAlert({ message: `trash failed: ${msg}`, variant: "error" });
            }
          })();
          return true;
        }
        case "Pin": {
          cmdState.contextTarget = null;
          if (pins.includes(target)) return true;
          const next = [...pins, target];
          setPins(next);
          void writePins(next);
          return true;
        }
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
        case "Unpin": {
          cmdState.contextTarget = null;
          if (!pins.includes(target)) return true;
          const next = pins.filter(p => p !== target);
          setPins(next);
          void writePins(next);
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
          setPins(next);
          void writePins(next);
          return true;
        }
      }
    }
  }
  return false;
};
