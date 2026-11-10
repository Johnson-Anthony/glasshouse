import { homeDir, winClose, winToggleMaximize } from "../api";
import { THEMES } from "../data";
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
    setTweaksOpen,
    state,
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
    case "Tweaks":
    case "Preferences…":
      setTweaksOpen(v => !v); return true;
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
    case "Home":
      void (async () => {
        const h = await homeDir();
        if (h) activeHandle?.actions.goTo(h);
      })();
      return true;
    case "Quit":
      void winClose(); return true;
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
      const i = THEMES.indexOf(state.theme);
      const next = THEMES[(i < 0 ? 0 : i + 1) % THEMES.length];
      setState(prev => ({ ...prev, theme: next }));
      return true;
    }
    default:
      return false;
  }
};
