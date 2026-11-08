# pages-site

Turn the GitHub Pages site (`docs/index.html`) into an interactive showcase that sells the app with its visuals. Backlog entry: `## pages-site` in `survey-fixes.md` (main commit 62013c8).

## Status
**Done** (2026-11-08). All six milestones are complete. `pnpm build`, `pnpm test` (171 tests, including 21 for the demo's mock) and `pnpm site:build` pass, and `pnpm site:capture check` passes 18 behavior checks in headless Chromium: tour playback, theme sync both ways, the live demo and walkthroughs, Esc twice out of the demo, reduced motion, phones at 320/375/414 px, no console errors, Jekyll-safe names, and a first view of 143 KB.

- **M1 done** (2026-11-08): demo of the real UI over a mocked backend (`site/demo/`), built to `docs/demo/` by `pnpm site:build`; woff2 font subsets; pdf.js stubbed; `.nojekyll` removed. It works from a static server under `/glasshouse/`.
- **M2 done** (2026-11-08): new landing page (`docs/assets/site.css`, `site.js`, `themes.css`), hero images captured from the demo in all 8 themes (`pnpm site:capture`), the theme picker recolors the page, the hero and the running demo, and the live demo loads on click. Screenshots went to the lead.
- Also done early: the pretend shell (part of M3) and the scene runner, with a visible pretend cursor; one scene (`hero`).
- **M3 done:** six scenes (terminal, tabs, git, Quick Look, paste conflicts, command palette).
- **M4 done:** clips recorded from the scenes (WebM and MP4, 200–630 KB each) with posters; one hero image per theme.
- **M5 done:** "see it work" player (tabs, lazy clips, plays on screen, advances, pause, reduced motion) and walkthrough links that run scenes in the live demo; phone layout.
- **M6 done:** demo mock tests in vitest (`site/**/*.test.ts`), Esc twice to leave the demo (the app keeps Tab and F6 for its panes), a `<noscript>` note, behavior checks, README/ARCHITECTURE/CLAUDE.md notes.

## Audience
- **Windows power users** who find File Explorer limiting: they want tabs, a terminal in the file manager, archives and git status. This is the primary audience, because the app is Windows-first.
- **Linux desktop users** who care about keyboard use and good-looking, themed tools.
- **Developers** who arrive from GitHub and want to know whether the project is real, how it's built and how to build it.

Within one screen they should see what it looks like. Within a minute they should know what it does, that it works, and how to get it.

## Voice
Keep the current copy and its plain, matter-of-fact voice. New sections get short text in the same voice: no hype words or jokes, and never the old nickname. Headings stay lowercase, with the `»` marker.

## Sections (top to bottom)
1. **Hero:** `~/glasshouse`, the tagline, and Download / View on GitHub / Try the demo buttons. Below that, a large app window showing a short looping clip of the real UI. The clip has a poster image, and shows only the poster when the visitor prefers reduced motion.
2. **Themes:** the 8 theme names as chips. Clicking one recolors the whole page (the site uses the app's own theme tokens), the hero poster and clip (one capture per theme for the poster), and the live demo if it's running. The choice is remembered per visitor in localStorage.
3. **See it work (tour):** one scene per feature, each with a heading, one or two sentences and a clip recorded from the real UI:
   - terminal drawer (open it, run `git status`, change folder and watch the shell follow);
   - tabs (open, switch, private tab);
   - git (status column, branch in the path bar, the Git menu, blame);
   - Quick Look (Space on an image, then a text file);
   - paste conflicts (paste onto an existing name, then the replace / keep both / skip dialog);
   - command palette (Ctrl+P, fuzzy match, run a command).
   Clips load lazily and play only while visible. Each scene links to the live demo with that scene ready to run.
4. **Try it (live demo):** the real app UI, running in the browser with a mocked backend, inside an iframe. It loads only on click ("Start the demo", with the download size stated). It has scene buttons that play the tour scripts live, then hand control back to the visitor. A note says what's simulated: no real files and no network.
5. **Features:** the existing 8 cards, unchanged.
6. **Get it / build it:** the existing download note and build block.
7. **Stack:** the existing two cards, plus a line saying the demo is the app's real React UI with a mocked backend.
8. **Footer:** unchanged.

## Interactions
- Theme chips recolor the page instantly (CSS variables on `<html data-theme>`), and send `postMessage` to the demo iframe.
- Scene clips use `IntersectionObserver` to play and pause, plus a play/pause button. Under reduced motion they don't autoplay and show the poster with a play button.
- Live demo: click to load; scene buttons run scripted sequences (synthetic key events plus the mock backend's fake shell). Any visitor input stops the script. Esc and the app's own shortcuts work.
- No scroll-jacking. Everything works with plain scrolling, and every section is useful without JavaScript (posters and text; clips need JS only for lazy play).

## Visual direction
- Same identity as today: the Tokyo Night palette by default, JetBrains Mono, dark cards, a subtle accent glow, lowercase headings with `»`.
- The app window is the hero: big, sharp (captured at 2×), with a soft shadow and an accent glow taken from the current theme.
- Theme switching is the signature interaction: the whole page changes palette with a short color transition (none under reduced motion).
- Restrained motion: clips carry the movement; the page itself only fades sections in on first view (none under reduced motion).

## Assets
- **Demo bundle** (`docs/demo/`): the real app built with Vite, with Tauri's IPC mocked (`@tauri-apps/api/mocks`) and a virtual filesystem: a home folder with a git repo (modified and untracked files), images, text and code files, archives, and a fake shell for the terminal.
- **Posters** (`docs/media/*.webp`): hero and one per scene, captured with headless Chromium at 2× from the demo in scene states. Hero posters for all 8 themes.
- **Clips** (`docs/media/*.webm` VP9, plus `.mp4` H.264 fallback for Safari): 6–12 s each, recorded from scripted scenes with the DevTools screencast and encoded with ffmpeg.
- **Fonts:** the demo loads the Nerd Font as a woff2 subset (only the glyphs the UI uses), not the 2.2 MB TTF. The landing page keeps its current font stack (no web font download).
- Weight budget: the landing page without media is under 60 KB, the hero poster under 150 KB, each clip under about 800 KB, loaded lazily. The demo loads only on click, and its size is stated on the button.

## Tech approach
- **Landing page:** hand-written static `docs/index.html` with `docs/assets/site.css` and `docs/assets/site.js` (vanilla, no build), plus `docs/assets/themes.css`, copied from `src/styles/themes.css` by the site build so theme tokens never drift.
- **Demo:** source in `site/demo/` (outside `docs/`, so it isn't served): an entry that installs the IPC mocks before importing `App`, the virtual FS, the fake shell, the scene scripts, and a `postMessage` bridge. It's built with `vite.site.config.ts` into `docs/demo/`. The built output is committed (static hosting, no Actions needed).
- **Captures:** `site/capture/` holds a Node script that drives headless Chromium over the DevTools protocol (Node's built-in WebSocket, no new dependencies) against `vite preview` of the demo. It writes posters and clips to `docs/media/`. It's run by hand (`pnpm site:capture`) when the UI changes, not in CI.
- **Scripts:** `pnpm site:build` (demo bundle and themes copy), `pnpm site:capture`, and `pnpm site:dev` (Vite dev server for the demo).
- **App changes:** keep them minimal. The one planned change is a `glasshouse:set-theme` window event in `App.tsx`, so the demo can switch to a specific theme while keeping React state in sync. Everything else is mocked at the IPC boundary.
- **Jekyll:** remove `docs/.nojekyll`, so the legacy Jekyll build runs and `_config.yml` keeps the working docs off the site. Built file names must not start with `_` or `.` (Jekyll skips those). The fallback is an Actions Pages deploy, which goes to the lead as a proposal.
- **Platform flavor:** the demo always presents the Linux flavor (paths like `/home/you`), whatever the visitor's OS, so captures and scripts are deterministic. A Windows flavor is a possible later milestone.

## Milestones
1. **M1 — demo foundation.** Demo entry with mocked IPC, a virtual FS, git, system info, previews, `vite.site.config.ts`, `pnpm site:build` → `docs/demo/`, and the Jekyll fix. Check: the demo loads from a static server under a subpath and browses folders, with previews and the git column working.
2. **M2 — hero and themes (first visible milestone, screenshots to the lead).** New landing layout with `site.css`/`site.js`, the theme chips recoloring page and demo, and the live demo section with lazy loading.
3. **M3 — fake shell and scenes.** Mock PTY with a small shell (`ls`, `cd`, `pwd`, `cat`, `git status/log/branch`, `echo`, `clear`, `help`) that follows the folder; scene scripts for the six tour scenes, runnable from the landing page.
4. **M4 — captures.** CDP capture script, posters (2×, webp) and clips (webm and mp4) for the hero and the scenes, plus per-theme hero posters.
5. **M5 — tour section and phones.** Tour layout with lazy clips, reduced-motion handling, phone layout (the demo opens full screen on phones, with a note that the UI is made for desktop screens), and the no-JS fallback.
6. **M6 — polish and checks.** Font subset, page weight check, keyboard and screen-reader pass, a Jekyll exclusion check, vitest coverage for the virtual FS and fake shell, and README/ARCHITECTURE notes on the site's source and how to rebuild it.

## Decisions
See `docs/decisions/2026-11-08-pages-site-architecture.md`.

## For review
- **Sample photos:** the user rejected generated images, so the demo's pictures are 8 real public-domain or CC0 photos from Wikimedia Commons (credits in `site/demo/public/files/CREDITS.txt`). The "screenshots" folder holds the app's old screenshot, and the demo website's logo is the app icon.
- **Substring check:** the bundled xterm.js keeps its MIT copyright notice, and one of the names in it (the author of jslinux) contains the old nickname as a substring. So a plain `git grep -i` for it matches `docs/demo/assets/index-*.{js,css}`. The presentation task's word-boundary check doesn't. The MIT license requires keeping the notice in copies, so it stays; treat `docs/demo/assets` like the font files.
- **Phones:** the live demo is replaced by a note and an "open it anyway" link below 760 px. The hero image and the tour (M5) carry the visuals there.
- **Favicon:** the app icon (`docs/favicon.png`); the site had none before.
- **Clips are in tokyo night only.** The hero image follows the theme picker (one capture per theme), but the six clips don't. Recording them in all 8 themes would add about 20 MB to the repo.
- **Phones:** clips play, but the UI in them is small at phone width. Possible follow-up: cropped close-up clips for phones.
- **Keyboard:** inside the live demo, Tab and F6 belong to the app, so pressing Esc twice returns focus to the page. The hint under the demo says so.
- **`docs/screenshot.png`** is no longer used by the README or the site (the README now shows `docs/media/hero-tokyo-night.png`). I kept it so old external links don't break; it can be deleted.
- **CLAUDE.md:** one line added under Commands for the site scripts.
- **Repo weight:** about 8 MB of built demo and media under `docs/`. Re-recording replaces files; unchanged hashes keep their names.
- **Font licenses:** `pnpm site:build` copies every non-font file in `src/assets/fonts` (the OFL texts today) into `docs/demo/licenses/`, with a README saying which fonts they cover. Once the `font-licenses` task puts the Nerd Fonts license texts there, run `pnpm site:build` again to ship them.
- **Merged main** (command-security, dead-code, unsent-labels, local-fonts, async-commands): the mock dropped the four commands the app no longer calls (`ping`, `set_always_on_top`, `wsl_to_win`, `git_ahead_behind`), and the images and clips were re-recorded from the merged UI. The demo also bundles the app's local JetBrains Mono, IBM Plex Mono and Fira Code woff2 files; they're fetched only if a visitor picks one of those fonts in the tweaks panel.
- **No GitHub setting changes are needed:** Pages keeps serving `main:/docs` with the legacy build. The site goes live when `main` is pushed.

## Checks
- `pnpm build`, `pnpm test`, `pnpm site:build`.
- The demo served from a static server under `/glasshouse/` (as on Pages) works with no console errors.
- Phone width (375 px) has no horizontal scroll; reduced motion stops autoplay.
