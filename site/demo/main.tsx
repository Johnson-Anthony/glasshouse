// The browser demo: the app's real UI over a mocked backend. The mock must be
// installed before the app's modules run, so it's the first import.
import { THEMES } from "./mock/install";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../../src/App";
import "../../src/styles/themes.css";
import "../../src/styles/app.css";
import "./demo.css";
import { runScene, stopScene, SCENES } from "./scenes";

declare global {
  interface Window {
    glasshouseDemo?: { runScene: typeof runScene; stopScene: typeof stopScene; scenes: string[] };
  }
}
window.glasshouseDemo = { runScene, stopScene, scenes: Object.keys(SCENES) };

// Messages from the project site (same origin only).
window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.origin !== location.origin) return;
  const msg = ev.data as { type?: string; theme?: string; scene?: string; stop?: boolean } | null;
  if (msg?.type !== "glasshouse-demo") return;
  if (msg.theme && (THEMES as readonly string[]).includes(msg.theme)) {
    window.dispatchEvent(new CustomEvent("glasshouse:set-theme", { detail: msg.theme }));
  }
  if (msg.stop) stopScene();
  if (msg.scene) {
    void runScene(msg.scene).then(done => {
      window.parent.postMessage({ type: "glasshouse-demo", sceneDone: msg.scene, completed: done }, location.origin);
    });
  }
});

// Tell the page when the app's theme changes (the palette, the tweaks
// panel), so the site follows the demo as well as the other way round.
if (window.parent !== window) {
  new MutationObserver(() => {
    const theme = document.documentElement.getAttribute("data-theme");
    window.parent.postMessage({ type: "glasshouse-demo", themeChanged: theme }, location.origin);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
