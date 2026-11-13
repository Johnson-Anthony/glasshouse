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

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- tour ----
  (function tour() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tour-tab"));
    var stage = document.getElementById("tour-stage");
    var video = stage && stage.querySelector("video");
    if (!tabs.length || !video) return;
    var texts = Array.prototype.slice.call(document.querySelectorAll(".tour-texts [data-scene]"));
    var bar = stage.querySelector(".tour-progress i");
    var pauseBtn = document.getElementById("tour-pause");
    var runBtn = document.getElementById("tour-run");
    var webm = video.canPlayType('video/webm; codecs="vp9"') !== "";
    var visible = false;
    var paused = reduceMotion; // reduced motion: nothing plays until asked
    var current = tabs[0].getAttribute("data-scene");

    // The page handles playback itself; the native controls are the no-JS fallback.
    video.controls = false;
    video.loop = false;
    pauseBtn.hidden = false;

    function setPauseLabel() {
      pauseBtn.textContent = paused ? "Play" : "Pause";
      pauseBtn.setAttribute("aria-pressed", String(paused));
    }

    function select(scene, focus) {
      current = scene;
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-scene") === scene;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      texts.forEach(function (p) { p.hidden = p.getAttribute("data-scene") !== scene; });
      var label = tabs.filter(function (t) { return t.getAttribute("data-scene") === scene; })[0].textContent;
      video.setAttribute("aria-label", "Recording: " + label);
      video.poster = "media/tour-" + scene + ".webp";
      video.src = "media/tour-" + scene + (webm ? ".webm" : ".mp4");
      bar.style.width = "0";
      play();
    }

    function play() {
      if (visible && !paused) {
        var p = video.play();
        if (p && p.catch) p.catch(function () { /* autoplay refused: the poster stays */ });
      } else {
        video.pause();
      }
    }

    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t.getAttribute("data-scene"), false); });
      t.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        select(tabs[(i + d + tabs.length) % tabs.length].getAttribute("data-scene"), true);
      });
    });

    video.addEventListener("timeupdate", function () {
      if (video.duration) bar.style.width = (100 * video.currentTime / video.duration) + "%";
    });
    // When a clip ends, move on to the next one (under reduced motion, stop).
    video.addEventListener("ended", function () {
      if (reduceMotion) { paused = true; setPauseLabel(); return; }
      var i = tabs.map(function (t) { return t.getAttribute("data-scene"); }).indexOf(current);
      select(tabs[(i + 1) % tabs.length].getAttribute("data-scene"), false);
    });
    video.addEventListener("click", function () {
      paused = !paused;
      setPauseLabel();
      play();
    });
    pauseBtn.addEventListener("click", function () {
      paused = !paused;
      setPauseLabel();
      play();
    });
    runBtn.addEventListener("click", function () {
      if (window.glasshouseRunScene) window.glasshouseRunScene(current);
    });

    // Load and play only while the player is on screen.
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && video.preload === "none") { video.preload = "auto"; video.load(); }
        play();
      }, { threshold: 0.35 }).observe(stage);
    } else {
      visible = true;
    }
    setPauseLabel();
    select(current, false);
  })();

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

  var pendingScene = null;
  var scenesBar = document.querySelector(".demo-scenes");

  function sendScene(scene) {
    iframe.contentWindow.postMessage({ type: "glasshouse-demo", scene: scene }, location.origin);
  }

  // Run a walkthrough in the live demo, starting the demo first if needed.
  window.glasshouseRunScene = function (scene) {
    demoFrame.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    if (demoFrame.getAttribute("data-state") === "running") sendScene(scene);
    else { pendingScene = scene; startDemo(); }
  };

  if (scenesBar) {
    Array.prototype.forEach.call(scenesBar.querySelectorAll("[data-scene]"), function (b) {
      b.addEventListener("click", function () { window.glasshouseRunScene(b.getAttribute("data-scene")); });
    });
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
      if (scenesBar) scenesBar.hidden = false;
      iframe.focus();
      if (pendingScene) {
        var scene = pendingScene;
        pendingScene = null;
        // Give the app a moment to list its first folder.
        setTimeout(function () { sendScene(scene); }, 600);
      }
    });
    demoFrame.appendChild(iframe);
    fit();
  }

  // The demo reports theme changes made inside it (palette, Preferences).
  window.addEventListener("message", function (ev) {
    if (ev.origin !== location.origin || !iframe || ev.source !== iframe.contentWindow) return;
    var msg = ev.data || {};
    if (msg.type === "glasshouse-demo" && msg.leave) {
      if (document.fullscreenElement) document.exitFullscreen();
      var next = fsBtn && !fsBtn.hidden ? fsBtn : document.querySelector(".demo-scenes button");
      if (next) next.focus();
      return;
    }
    if (msg.type === "glasshouse-demo" && msg.themeChanged && msg.themeChanged !== currentTheme() &&
        chips.some(function (c) { return c.getAttribute("data-choice") === msg.themeChanged; })) {
      applyTheme(msg.themeChanged, true);
      syncTabIndex();
    }
  });

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
