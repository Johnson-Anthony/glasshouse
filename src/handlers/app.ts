import { homeDir, quitApp, winToggleMaximize } from "../api";
import { nextTheme } from "../look";
import type { Handler } from "./types";

// App-level commands: panels, dialogs, tabs, window, navigation, theme.
// Moved from App.tsx's handleMenuCommand.
export const appHandler: Handler = (label, ctx) => {
  if (!ctx.app) return false;
  const { activeHandle } = ctx;
  const {
    activeTab,
    closeOtherTabsAt,
    closeTabAt,
    openNewTab,
    setBookmarkManagerOpen,
    setCheatsheetOpen,
    setConnectOpen,
    setManageRemotesOpen,
    setPalOpen,
    setShowFindModal,
    setShowInspector,
    setState,
    setTermOpen,
    setPrefsOpen,
    panes,
  } = ctx.app;
  switch (label) {
    case "Toggle Drawer": {
      setTermOpen(v => !v);
      return true;
    }
    case "Command Palette":
      setPalOpen(v => !v); return true;
    case "Keybindings Cheatsheet":
      setCheatsheetOpen(true); return true;
    case "Find in Files":
      setShowFindModal(true); return true;
    case "Preferences…":
      setPrefsOpen(true); return true;
    case "Manage Bookmarks…":
      setBookmarkManagerOpen(true); return true;
    case "Manage Remotes…":
      setManageRemotesOpen(true); return true;
    case "Connect to Server…":
      setConnectOpen(true); return true;
    case "New Tab":
      openNewTab(); return true;
    case "New Terminal Tab":
      // Drawer owns tab state; open it and signal it to add a tab.
      setTermOpen(true);
      window.dispatchEvent(new Event("glasshouse:term-new-tab"));
      return true;
    case "Close Tab":
      closeTabAt(activeTab); return true;
    case "Close Other Tabs":
      // File-menu path; the tab context-menu variant passes ctxT.tabIndex.
      closeOtherTabsAt(activeTab); return true;
    // Split view. From the palette the tab commands act on the shown tab.
    case "Split Side by Side":
      panes.toggleSplit("row"); return true;
    case "Split Top and Bottom":
      panes.toggleSplit("column"); return true;
    case "Close Split":
      panes.closeSplit(); return true;
    case "Swap Panes":
      panes.swap(); return true;
    case "Focus Other Pane":
      panes.focusOther(); return true;
    case "Copy to Other Pane":
      panes.transferToOther(true); return true;
    case "Move to Other Pane":
      panes.transferToOther(false); return true;
    case "Move Tab to Other Pane":
      panes.moveTabToOtherPane(activeTab); return true;
    case "Home":
      void (async () => {
        const h = await homeDir();
        if (h) activeHandle?.actions.goTo(h);
      })();
      return true;
    case "Quit":
      void quitApp(); return true;
    case "Full Screen":
      void winToggleMaximize(); return true;
    case "Refresh":
      activeHandle?.actions.refresh(); return true;
    case "Back":
      activeHandle?.actions.back(); return true;
    case "Forward":
      activeHandle?.actions.forward(); return true;
    case "Up":
    case "Open Parent":
      activeHandle?.actions.up(); return true;
    case "Toggle Hidden Files":
    case "Show Hidden Files":
      setState(prev => ({ ...prev, hidden: !prev.hidden })); return true;
    case "Inspector":
      setShowInspector(v => !v); return true;
    case "Switch Theme →": {
      const shown = document.documentElement.getAttribute("data-theme") ?? "";
      setState(prev => ({ ...prev, ...nextTheme(prev, shown) }));
      return true;
    }
    default:
      return false;
  }
};
