# ci-hygiene

Branch: `claude/exciting-rubin-44f4c0` (worktree `exciting-rubin-44f4c0`). CI config, plus one small change to the site build config. No Rust build.
Scope: section 27 of `docs/plans/active/survey-2.md`.

## Status
Done 2026-11-12, merged with `main` at `14f5189`. Decision record: `docs/decisions/2026-11-12-ci-hygiene-jobs.md`.

**Checks:**
- `pnpm build` passes.
- `pnpm test`: 393 passed and 3 skipped (zsh, fish and pwsh aren't installed).
- `pnpm check:wiring`: 0 problems.
- `pnpm site:build` leaves `docs/demo` unchanged after the merge.
- `pnpm site:capture check`: 23/23.

**Reproducible demo, checked locally:**
- two rebuilds match the committed copy;
- a clone at another path builds a byte-identical `docs/demo`;
- in that clone, a back-dated source commit gives its own date, a PROGRESS.md-only commit leaves the date alone, and an uncommitted source edit gives today.

**Workflows, checked locally:**
- PyYAML parse and a cross-reference check of needs, outputs and step ids for ci.yml and release.yml;
- shellcheck clean on every `run:` script;
- the freshness step passes on the current demo and fails, with its message, on a stale one;
- the audit step, with a stub `cargo`, always exits 0, and adds a warning and the summary only when the audit fails;
- dependabot.yml parses with the intended groups and ignore rule.
- actionlint wasn't run locally (nothing installed); the CI job is its first run.

**cargo audit preview:** Cargo.lock's 631 registry crates were checked against the OSV database. The findings were sent to the lead and are now task 10b, security-deps:
- zip 2.4.2: a critical GHSA, fixed in 9.0.5;
- tauri 2.10.3: a moderate GHSA, fixed in 2.11.1. It's GitHub-only, so cargo audit won't show it;
- zstd and zstd-safe, quick-xml, crossbeam-epoch, libz-sys;
- unsound and unmaintained notices.

**Only a real CI run can prove:**
- what actionlint flags in ci.yml and release.yml (fix it in a follow-up);
- that the snapshot Chromium starts on ubuntu-latest once the sysctl is lifted, and that the site checks' timings hold on a runner;
- that Node 22 there builds the same `docs/demo` as Node 20 here;
- cargo audit's real output and exit code;
- that Dependabot accepts the config (it reports errors on the repo's Insights → Dependency graph → Dependabot page).

## Approach
New jobs in `.github/workflows/ci.yml`. The existing jobs are unchanged.

1. **`actionlint`.** It fetches rhysd/actionlint's own download script pinned to v1.7.12 (no third-party action) and lints every workflow. It runs shellcheck on each `run:` script too, since shellcheck is preinstalled on the runner. Nothing is installed locally.
2. **`site`:**
   - `pnpm site:build`, then fail if `git status --porcelain -- docs/demo docs/assets/themes.css` isn't empty, with "run `pnpm site:build` and commit the result";
   - then `pnpm site:capture check` with the runner's Chromium.
   - **Reproducible builds.** The demo's About date was the build day, so the committed demo went stale every day. `vite.site.config.ts` now uses the date of the newest commit that changed the demo's sources (`src`, `site`, `package.json`, `pnpm-lock.yaml`, `vite.site.config.ts`, `tsconfig.site.json`), or today if those have uncommitted changes. The job checks out full history for that.
   - **Chromium on Ubuntu 24.04:** the image's `/usr/bin/chromium` is a snapshot build without an AppArmor profile. 24.04 restricts unprivileged user namespaces, so its sandbox can't start (actions/runner-images#12096). The job lifts that restriction with `sysctl` on the throwaway runner, rather than passing `--no-sandbox` or changing `capture.mjs`. `check` mode doesn't use ffmpeg.
3. **`audit`.** `cargo audit` (cargo-audit through `taiki-e/install-action`, which the notices job already uses) on `src-tauri/Cargo.lock`.
   - It reports into the job summary and a warning annotation, and doesn't fail. Cargo.lock has about 15 RustSec vulnerabilities today (zip, zstd, quick-xml, crossbeam-epoch, libz-sys), and bumping them is task 28. A failing job would turn every push red until then.
4. **`.github/dependabot.yml`:**
   - npm, cargo and github-actions, weekly;
   - minor and patch updates grouped per ecosystem, with Tauri packages in their own group in npm and in cargo;
   - majors one PR each, at most 3 open PRs per ecosystem (2 for actions);
   - tauri-action majors ignored (decision: stay on v0 until deps-bump).
5. **Formatting:** no `cargo fmt --check`, as the backlog says.

## Checks
- `pnpm build`, `pnpm test`, `pnpm check:wiring`, `pnpm site:build`, `pnpm site:capture check`.
- Reproducibility of `pnpm site:build`: rebuild twice, rebuild in a clone at another path, and the date rules with a back-dated commit.
- The workflow files as for release-prep: PyYAML structure and cross-references, shellcheck on the `run:` scripts, and the new scripts run locally where possible. actionlint isn't run locally; the CI job is its first run.
