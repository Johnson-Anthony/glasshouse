// Updates (src-tauri/src/update.rs): the words Preferences → Updates and
// the update dialog show, the release notes as plain blocks, and the
// automatic check. Nothing here touches the network: the check runs in Rust.

import { useEffect, useRef } from "react";
import { sessionOwner, updateCheck, type InstallKind, type UpdateAvailable, type UpdateInfo } from "./api";
import { describeForLog, logWarn } from "./log";

export const RELEASES_URL = "https://github.com/Johnson-Anthony/glasshouse/releases";

/** The release's page on GitHub. */
export function releasePage(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

/** What a check contacts and sends, for Preferences and the dialog. */
export const CHECK_PRIVACY =
  "A check is one request to github.com for the latest release's latest.json (its version, release notes and download links). " +
  "It carries nothing about you or this computer beyond what any web request does (your IP address): no ID, no usage data. " +
  "Nothing is downloaded or installed unless you choose Install.";

/** The file a download URL names. */
export function fileOf(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? ""); } catch { return ""; }
}

/** How this copy gets an update, in a sentence or two. */
export function installText(info: Pick<UpdateInfo, "install" | "canInstall" | "appImage">): string {
  switch (info.install) {
    case "nsis":
      return "Installed with the setup (for you alone): glasshouse downloads the new setup and runs it, " +
        "which closes every glasshouse window and starts glasshouse again when it's done.";
    case "msi":
      return "Installed with the MSI (for every user of this PC): glasshouse downloads the new MSI and runs it. " +
        "Windows asks for an administrator's approval, and every glasshouse window closes.";
    case "appimage":
      return info.canInstall
        ? `Running as an AppImage: glasshouse replaces ${info.appImage ?? "it"} with the new one and restarts this window. ` +
          "Other glasshouse windows keep the old version until you close them."
        : info.appImage
          ? `Running as an AppImage, but glasshouse can't write to the folder ${info.appImage} is in, ` +
            "so it links to the new AppImage for you to download."
          : "An AppImage that wasn't started as one, so glasshouse links to the new AppImage for you to download.";
    case "deb":
      return "Installed from a .deb package, which is the package manager's to update: " +
        "glasshouse tells you when a new version is out and links to its .deb.";
    case "rpm":
      return "Installed from an .rpm package, which is the package manager's to update: " +
        "glasshouse tells you when a new version is out and links to the release.";
    case "source":
      return "Built from source, so it can't update itself: glasshouse tells you when a new version is out " +
        "and links to the release.";
  }
}

/** For an update the user installs themselves: what to do with the file. */
export function manualSteps(install: InstallKind, download: string | null): string | null {
  const file = download ? fileOf(download) : "";
  switch (install) {
    case "deb":
      return `Download the new .deb, then install it as you did this one: sudo apt install ./${file || "glasshouse_<version>_<arch>.deb"}`;
    case "rpm":
      return "Download the new package from the release page and install it with your package manager.";
    case "appimage":
      return "Download the new AppImage, make it executable (chmod +x) and use it in place of this one.";
    case "source":
      return "Get the new version from the release page, or pull and rebuild.";
    default:
      return null;
  }
}

/** "3 hours ago" and the like, for the last check. */
export function agoText(ms: number | null, now = Date.now()): string {
  if (ms == null) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"} ago`;
  if (s < 3600) return unit(Math.floor(s / 60), "minute");
  if (s < 86400) return unit(Math.floor(s / 3600), "hour");
  return unit(Math.floor(s / 86400), "day");
}

/** A release date from latest.json as a day, or "" if there's none. */
export function dayText(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function mb(n: number): string {
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

/** "12.3 MB of 80.1 MB" while downloading. */
export function progressText(got: number, total: number | null): string {
  return total ? `${mb(got)} of ${mb(total)}` : mb(got);
}

/** A line of the release notes. The notes are the release's CHANGELOG
 *  section (markdown); they're shown as text, never as HTML. */
export type NoteBlock =
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string; depth: number }
  | { kind: "para"; text: string };

/** Inline markdown reduced to its text: links keep their words, and the
 *  `**`, `_` and backtick marks go. */
export function plainInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** The notes as headings, bullets (with their depth) and paragraphs. A
 *  wrapped bullet or paragraph line joins the one before it. */
export function noteBlocks(md: string): NoteBlock[] {
  const out: NoteBlock[] = [];
  let open: NoteBlock | null = null;
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { open = null; continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: "heading", text: plainInline(heading[1]) });
      open = null;
      continue;
    }
    const item = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (item) {
      open = { kind: "item", text: plainInline(item[2]), depth: Math.min(3, Math.floor(item[1].replace(/\t/g, "  ").length / 2)) };
      out.push(open);
      continue;
    }
    if (open) {
      open.text = `${open.text} ${plainInline(line)}`;
      continue;
    }
    open = { kind: "para", text: plainInline(line) };
    out.push(open);
  }
  return out;
}

/** The first automatic check waits this long after start, so it doesn't
 *  compete with the first listing. */
export const FIRST_CHECK_MS = 20_000;
/** Then it asks Rust this often; Rust contacts the server once a day. */
export const CHECK_TICK_MS = 60 * 60 * 1000;

/** Preferences → Updates' automatic check: while `on`, and only in the
 *  window that owns the session (one per user, not one per window), asks
 *  `update_check` (auto) after start and then every hour. `onFound` gets a
 *  newer version, once per version. */
export function useAutoUpdateCheck(on: boolean, onFound: (u: UpdateAvailable) => void): void {
  const found = useRef(onFound);
  found.current = onFound;
  useEffect(() => {
    if (!on) return;
    let live = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const r = await updateCheck(true);
        if (live && r.status === "available") found.current(r);
      } catch (e) {
        logWarn(`automatic update check: ${describeForLog(e)}`);
      }
      if (live) timer = window.setTimeout(() => void tick(), CHECK_TICK_MS);
    };
    void sessionOwner().then(owner => {
      if (owner && live) timer = window.setTimeout(() => void tick(), FIRST_CHECK_MS);
    });
    return () => { live = false; window.clearTimeout(timer); };
  }, [on]);
}
