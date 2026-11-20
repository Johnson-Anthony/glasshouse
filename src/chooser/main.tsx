// The file chooser window's page (chooser.html). The resident starts
// `glasshouse --chooser` for each open or save request from
// xdg-desktop-portal; this page asks the backend for the request, renders
// the dialog and answers through chooser_finish. It uses the main window's
// display settings (theme, density, font, zoom, hidden files) as saved.

import React from "react";
import ReactDOM from "react-dom/client";
import { Chooser, type ChooserSettings } from "./Chooser";
import { chooserFinish, chooserRequest, homeDir, winSetTheme } from "../api";
import { applyZoom, validZoom } from "../zoom";
import "../styles/themes.css";
import "../styles/app.css";
import "./chooser.css";

function savedTweaks(): Record<string, unknown> {
  try {
    const saved = JSON.parse(localStorage.getItem("glasshouse.tweaks") || "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

const tweaks = savedTweaks();
const root = document.documentElement;
root.setAttribute("data-theme", typeof tweaks.theme === "string" ? tweaks.theme : "gruvbox-dark");
root.setAttribute("data-density", typeof tweaks.density === "string" ? tweaks.density : "default");
if (typeof tweaks.font === "string") root.style.setProperty("--font-mono", tweaks.font);
applyZoom(validZoom(tweaks.zoom));
const scheme = getComputedStyle(root).colorScheme ?? "";
void winSetTheme(/\bdark\b/.test(scheme) || !/\blight\b/.test(scheme) ? "dark" : "light");

const settings: ChooserSettings = {
  hidden: tweaks.hidden === true,
  showExtensions: tweaks.showExtensions !== false,
  foldersFirst: tweaks.foldersFirst !== false,
  showSidebar: tweaks.showSidebar !== false,
};

const mount = ReactDOM.createRoot(document.getElementById("root")!);
void Promise.all([chooserRequest(), homeDir()]).then(([view, home]) => {
  if (!view) {
    // Not started for a request: nothing to show, so answer "cancelled".
    void chooserFinish({ response: 2, paths: [], choices: [], currentFilter: null });
    return;
  }
  mount.render(
    <React.StrictMode>
      <Chooser view={view} home={home} settings={settings} />
    </React.StrictMode>,
  );
});
