# CI: workflow lint, a current demo, site checks, cargo audit and Dependabot

Date: 2026-11-12 · Task: ci-hygiene

## Decision
- **actionlint** runs in its own job through rhysd/actionlint's download script, pinned to v1.7.12 in the URL and the version argument.
  - No third-party wrapper action.
  - shellcheck, preinstalled on the runner, checks every `run:` script.
- **The committed demo must be current.** The `site` job runs `pnpm site:build` and fails if `docs/demo` or `docs/assets/themes.css` changed. The message says to run `pnpm site:build` and commit.
- **The demo build is reproducible.** About's "built on" date in the demo was the build day, so the committed demo went stale every day. `vite.site.config.ts` now uses `git log -1 --format=%cs` over the demo's sources (`src`, `site`, `package.json`, `pnpm-lock.yaml`, `vite.site.config.ts`, `tsconfig.site.json`).
  - With uncommitted changes to those sources, it uses today.
  - Commits that only touch docs, PROGRESS.md or Rust don't change the date, so they never make the demo stale.
  - The job checks out full history, because a shallow clone would date the build from HEAD.
  - The installed app is unchanged: `vite.config.ts` still stamps the build day.
- **After a merge where both sides changed demo sources,** the merge commit is the newest source commit, so the demo must be rebuilt on `main`. That was already the practice ("Site: rebuild the demo"); CI now enforces it.
- **`pnpm site:capture check` runs in the same job** with the image's `/usr/bin/chromium`.
  - That binary is a snapshot build with no AppArmor profile, and Ubuntu 24.04's `kernel.apparmor_restrict_unprivileged_userns` stops its sandbox (actions/runner-images#12096). The job sets that sysctl to 0 on the throwaway runner.
  - Check mode needs neither ffmpeg nor the captured media rebuilt.
- **`cargo audit` reports but doesn't fail.**
  - Its output goes to the job summary, and a warning annotation appears when it exits non-zero.
  - On 2026-11-12, Cargo.lock had about 15 RustSec vulnerabilities (zip, zstd, quick-xml, crossbeam-epoch, libz-sys) and more unsound or unmaintained notices. Fixing them is the security-deps / deps-bump tasks.
  - Make it blocking once those land.
- **Dependabot:**
  - version updates for npm, cargo and github-actions, weekly;
  - minor and patch updates grouped per ecosystem, majors one PR each, at most 3 open PRs (2 for actions);
  - Tauri packages grouped on each side, because the npm packages and crates must stay on the same minor;
  - tauri-action majors ignored while release.yml stays on v0.
  - Alerts and security updates are repository settings, not this file, and they're off. That's the user's call.

## Rejected
- **Passing `--no-sandbox` in `capture.mjs`, or switching CI to `google-chrome`.** Either changes the tool for every run, or tests a different browser than the one used locally.
- **Pinning the demo date with `SOURCE_DATE_EPOCH`.** CI can't know which date the committed copy was built with.
- **Comparing the demo with its date masked out.** The date sits inside content-hashed bundles, so the file names change with it.
- **`cargo fmt --check`.** rustfmt reports 148 differences across shared files; adopt it at a quiet point, as the backlog says.
