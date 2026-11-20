// Report Bug…: a new GitHub issue, filled in with the facts about this
// system that a bug report needs (diagnostics.rs `SystemReport`, plus the
// display scale) and nothing personal: no paths, no user or machine name.
// The user sees exactly that text before the browser opens; nothing is sent
// until they submit the issue on GitHub.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { bugReportInfo, type SystemReport } from "./api";

export const REPO_URL = "https://github.com/Johnson-Anthony/glasshouse";

/** The issue form in `.github/ISSUE_TEMPLATE/`; its fields' ids match the
 *  ids below. A repo without it opens a blank issue with `body` instead. */
const TEMPLATE = "bug_report.yml";

export interface ReportFacts extends SystemReport {
  /** The screen's scale: 1.25 for 125%. */
  scale: number;
}

/** Everything Report Bug… sends, as the form's field id, label and value.
 *  The display scale goes with the desktop, as the form asks; a field with
 *  nothing to say is left out (the desktop on Windows at 100%). */
export function reportFields(f: ReportFacts): Array<{ id: string; label: string; value: string }> {
  const percent = Math.round(f.scale * 100);
  const desktop = [f.desktop, percent !== 100 ? `${percent}% scale` : null].filter(Boolean).join(", ");
  return [
    { id: "version", label: "glasshouse", value: f.version },
    { id: "os", label: "OS", value: `${f.os} (${f.arch})` },
    { id: "desktop", label: "Desktop", value: desktop },
    { id: "webview", label: "Web view", value: f.webview ?? "" },
  ].filter(x => x.value !== "");
}

/** The facts as the lines the preview shows and the issue gets. */
export function reportText(f: ReportFacts): string {
  return reportFields(f).map(x => `${x.label}: ${x.value}`).join("\n");
}

function body(f: ReportFacts): string {
  return [
    "**What happened**",
    "",
    "",
    "**What you expected to happen**",
    "",
    "",
    "**Steps to reproduce**",
    "1. ",
    "",
    "**System**",
    ...reportFields(f).map(x => `- ${x.label}: ${x.value}`),
  ].join("\n");
}

/** The new-issue page with the facts filled in: the form's fields when the
 *  repo has the form, else the body of a blank issue. */
export function issueUrl(f: ReportFacts): string {
  const q = new URLSearchParams({ template: TEMPLATE, title: "" });
  for (const x of reportFields(f)) q.set(x.id, x.value);
  q.set("body", body(f));
  return `${REPO_URL}/issues/new?${q.toString()}`;
}

/** This system's facts, or null when the backend can't say (no Tauri). */
export async function collectFacts(): Promise<ReportFacts | null> {
  const info = await bugReportInfo();
  return info && { ...info, scale: await screenScale() };
}

/** The screen's scale for this window. Not devicePixelRatio: WebView2
 *  counts the window's zoom (View → Zoom) in it, WebKit doesn't. */
async function screenScale(): Promise<number> {
  try {
    const s = await getCurrentWindow().scaleFactor();
    if (s > 0) return s;
  } catch { /* no Tauri window */ }
  return window.devicePixelRatio || 1;
}

/** What the preview says around the facts. */
export const PREVIEW_INTRO = "This opens a new GitHub issue in your browser with these lines filled in:";
export const PREVIEW_NOTE =
  "Nothing is sent until you submit the issue on GitHub. You need a GitHub account to do that. " +
  "If you attach the log (Help → Open Log Folder), look through it first: it can contain file and folder names.";
