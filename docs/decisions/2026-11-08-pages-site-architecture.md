# Pages site architecture (pages-site task)

## The demo is the real app over a mocked backend
- **Chosen:** build the app's own React UI (`src/`) a second time with Vite (`vite.site.config.ts`, entry `site/demo/main.tsx`) and replace Tauri's IPC with `@tauri-apps/api/mocks`, backed by an in-memory filesystem, a pretend git repo and a pretend shell (`site/demo/mock/`). The built output is committed to `docs/demo/`.
- **Rejected:**
  - a hand-made imitation of the UI, which would drift from the app and isn't the real thing;
  - video only, which can't be tried, and the user asked for an interactive site;
  - an Actions-based Pages deploy, which is a repo setting change. It stays the fallback if committing built files becomes a problem.
- The mocks are installed before any app module runs, because `src/api.ts` and `src/platform.ts` decide at import time whether they're in Tauri and on Windows.
- The only app change is a `glasshouse:set-theme` window event in `App.tsx`, so the site's theme picker can set a named theme without the app's React state going stale.

## Jekyll stays on
`docs/.nojekyll` was removed. With it, the legacy Pages build skipped Jekyll, so `_config.yml`'s `exclude` did nothing and the working docs would have been served. Jekyll skips files whose names start with `_` or `.`, so the demo build strips those prefixes from asset names.

## The demo always looks like Linux
It reports a Linux user agent and uses POSIX paths whatever the visitor's OS, so the scripted scenes and captured images are repeatable. A Windows flavor (drive letters, `C:\Users\…`) is possible later. It would need a second filesystem seed and path handling in the mock.

## Weight
- The demo uses woff2 subsets of the Nerd Font (about 48 KB each, `site/subset-fonts.sh`) instead of the 2.2 MB TTFs.
- pdf.js (about 1.7 MB) is stubbed out, so a PDF in the demo shows an error instead of a preview.
- A first visit to the demo downloads about 300 KB. The landing page loads the demo only when the visitor clicks "Start the demo".

## Demo state is per visit
The demo replaces `localStorage` with an in-memory store, so every visit starts from the same files and settings. Nothing leaks into the real origin's storage, which johnson-anthony.github.io shares with the user's other Pages sites. The landing page keeps one key, `glasshouse-site.theme`.

## Sample photos
The demo's pictures are real photos from Wikimedia Commons, all public domain or CC0, resized and re-encoded. Credits are in `site/demo/public/files/CREDITS.txt`, which is served at `demo/files/CREDITS.txt`. Generated images (ffmpeg patterns) were tried first and rejected by the user.

## Images of the UI are captured, not drawn
`site/capture/capture.mjs` serves `docs/` the way Pages does, drives headless Chromium over the DevTools protocol (Node's built-in WebSocket, no new dependencies), runs the demo's scripted scenes, and saves 2× WebP stills to `docs/media/`. It's run by hand after UI changes.
