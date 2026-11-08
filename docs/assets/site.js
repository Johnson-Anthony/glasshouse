// Project site: theme picker and the live demo. No build step; plain ES2017.
(function () {
  "use strict";

  var THEME_KEY = "glasshouse-site.theme";
  var root = document.documentElement;
  var demoFrame = document.querySelector(".demo-frame");
  var iframe = null;

  function currentTheme() {
    return root.getAttribute("data-theme") || "tokyo-night";
  }

  // ---- themes ----
  var chips = Array.prototype.slice.call(document.querySelectorAll(".theme-picker .chip"));
  var heroShot = document.getElementById("hero-shot");

  function themedSrc(el, theme) {
    var pattern = el && el.getAttribute("data-src-pattern");
    return pattern ? pattern.replace("{theme}", theme) : null;
  }

  function applyTheme(theme, save) {
    root.setAttribute("data-theme", theme);
    chips.forEach(function (c) {
      c.setAttribute("aria-checked", String(c.getAttribute("data-choice") === theme));
    });
    var src = themedSrc(heroShot, theme);
    if (src && heroShot.getAttribute("src") !== src) heroShot.setAttribute("src", src);
    // Absolute: a relative url() in a custom property would resolve against site.css.
    if (demoFrame && src) demoFrame.style.setProperty("--demo-poster", "url('" + new URL(src, document.baseURI).href + "')");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: "glasshouse-demo", theme: theme }, location.origin);
    }
    if (save) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ }
    }
  }

  chips.forEach(function (chip, i) {
    chip.addEventListener("click", function () { applyTheme(chip.getAttribute("data-choice"), true); });
    // Arrow keys move between options, as in a radio group.
    chip.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var next = chips[(i + d + chips.length) % chips.length];
      next.focus();
      next.click();
    });
  });
  // Only the checked chip is in the tab order.
  function syncTabIndex() {
    chips.forEach(function (c) { c.tabIndex = c.getAttribute("aria-checked") === "true" ? 0 : -1; });
  }
  applyTheme(currentTheme(), false);
  syncTabIndex();
  chips.forEach(function (c) { c.addEventListener("click", syncTabIndex); });

  // ---- live demo ----
  if (!demoFrame) return;
  var startBtn = document.getElementById("demo-start");
  var fsBtn = document.getElementById("demo-fullscreen");
  var DEMO_W = 1280;
  var DEMO_H = 800;

  function fit() {
    if (!iframe) return;
    var full = document.fullscreenElement === demoFrame;
    var w = demoFrame.clientWidth;
    var h = demoFrame.clientHeight;
    if (full) {
      // Full screen: the app gets the whole screen at its natural size.
      iframe.style.width = w + "px";
      iframe.style.height = h + "px";
      iframe.style.transform = "none";
    } else {
      iframe.style.width = DEMO_W + "px";
      iframe.style.height = DEMO_H + "px";
      iframe.style.transform = "scale(" + Math.min(w / DEMO_W, h / DEMO_H) + ")";
    }
  }

  function startDemo() {
    if (iframe) return;
    demoFrame.setAttribute("data-state", "loading");
    startBtn.textContent = "Loading…";
    iframe = document.createElement("iframe");
    iframe.title = "glasshouse demo";
    iframe.src = "demo/?theme=" + encodeURIComponent(currentTheme());
    iframe.addEventListener("load", function () {
      demoFrame.setAttribute("data-state", "running");
      if (fsBtn && demoFrame.requestFullscreen) fsBtn.hidden = false;
      iframe.focus();
    });
    demoFrame.appendChild(iframe);
    fit();
  }

  startBtn.addEventListener("click", startDemo);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(demoFrame);
  window.addEventListener("resize", fit);
  document.addEventListener("fullscreenchange", function () {
    fit();
    if (fsBtn) fsBtn.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  });
  if (fsBtn) {
    fsBtn.addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else demoFrame.requestFullscreen().then(function () { if (iframe) iframe.focus(); });
    });
  }
})();
