import { useEffect, useRef, useState } from "react";
import {
  onUpdateProgress, openUrl, updateCancel, updateCheck, updateInfo, updateInstall,
  type UpdateAvailable, type UpdateInfo,
} from "../api";
import { errDetail, errKind, errText } from "../errors";
import { describeForLog, logWarn } from "../log";
import {
  CHECK_PRIVACY, RELEASES_URL, dayText, installText, manualSteps, noteBlocks, progressText, releasePage,
} from "../updates";
import { ErrorDetails } from "./DialogHost";
import { useEscapeClose } from "./useEscapeClose";
import { useModal } from "./modal";

// ============= UpdateDialog =============
// Help → Check for Updates, Preferences → Updates' "check now", and the
// automatic check's notice. It checks once when it opens (unless it was
// handed what the automatic check found), shows what's new, and installs
// only on Install. A copy that can't update itself (a .deb, a build from
// source) gets a link to the new package instead.

export interface UpdateDialogProps {
  open: boolean;
  /** What the automatic check found: shown without checking again. */
  found?: UpdateAvailable | null;
  onClose: () => void;
}

type Phase =
  | { kind: "checking" }
  | { kind: "current"; version: string }
  | { kind: "available"; update: UpdateAvailable }
  | { kind: "downloading"; update: UpdateAvailable; got: number; total: number | null }
  | { kind: "installing"; update: UpdateAvailable }
  | { kind: "error"; message: string; detail: string; update?: UpdateAvailable };

/** A failed check or install: logged, like every error alert (showError),
 *  and shown in the dialog with the raw text under "Show details". */
function failed(what: string, e: unknown, fallback: string, update?: UpdateAvailable): Phase {
  logWarn(`${what}: ${describeForLog(e)}`);
  return { kind: "error", message: errText(e) || fallback, detail: errDetail(e), update };
}

export function UpdateDialog({ open, found, onClose }: UpdateDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const busy = phase.kind === "downloading" || phase.kind === "installing";

  useEscapeClose(onClose, open && !busy);
  useModal(open);

  const check = () => {
    setPhase({ kind: "checking" });
    updateCheck(false).then(
      r => setPhase(r.status === "available" ? { kind: "available", update: r }
        : { kind: "current", version: r.status === "current" ? r.version : "" }),
      e => setPhase(failed("update check", e, "The check failed.")),
    );
  };

  useEffect(() => {
    if (!open) return;
    let live = true;
    setCancelError(null);
    void updateInfo().then(i => { if (live) setInfo(i); });
    if (found) setPhase({ kind: "available", update: found });
    else check();
    panelRef.current?.focus({ preventScroll: true });
    return () => { live = false; };
    // `found` is read when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return onUpdateProgress(p => setPhase(ph => {
      if (ph.kind !== "downloading" && ph.kind !== "installing") return ph;
      return p.installing ? { kind: "installing", update: ph.update } : { ...ph, got: p.got, total: p.total };
    }));
  }, [open]);

  if (!open) return null;

  const install = (update: UpdateAvailable) => {
    setCancelError(null);
    setPhase({ kind: "downloading", update, got: 0, total: null });
    // Resolves only if nothing restarted: the AppImage restarts, and a
    // Windows installer ends this process.
    updateInstall().then(
      () => onClose(),
      e => setPhase(errKind(e) === "cancelled" ? { kind: "available", update } : failed("update install", e, "The update failed.", update)),
    );
  };

  const cancel = () => {
    updateCancel().catch(e => setCancelError(errText(e)));
  };

  const update = "update" in phase ? phase.update : undefined;
  const close = () => { if (!busy) onClose(); };

  return (
    <div className="prefs-backdrop" onClick={close}>
      <div
        className="prefs upd"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upd-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="prefs-head">
          <span className="upd-head">check for updates</span>
          <button type="button" className="prefs-x" onClick={close} disabled={busy} aria-label="close">×</button>
        </div>
        <div className="upd-body">
          {phase.kind === "checking" && (
            <>
              <p id="upd-title" className="upd-title" role="status">Checking for updates…</p>
              <p className="prefs-note">{CHECK_PRIVACY}</p>
            </>
          )}
          {phase.kind === "current" && (
            <>
              <p id="upd-title" className="upd-title" role="status">
                glasshouse {phase.version || info?.version} is the newest version.
              </p>
              {info && <p className="prefs-note">{installText(info)}</p>}
            </>
          )}
          {phase.kind === "error" && (
            <>
              <p id="upd-title" className="upd-title">{update ? `glasshouse ${update.version} wasn't installed.` : "The check didn't work."}</p>
              <p className="prefs-note error" role="alert">{phase.message}</p>
              {phase.detail && <ErrorDetails detail={phase.detail} />}
            </>
          )}
          {update && phase.kind !== "error" && (
            <>
              <p id="upd-title" className="upd-title">
                glasshouse {update.version} is out
                <span className="upd-sub">
                  {" "}· you have {update.current}{dayText(update.date) && ` · released ${dayText(update.date)}`}
                </span>
              </p>
              <Notes notes={update.notes} />
              {info && <p className="prefs-note">{installText(info)}</p>}
              {!update.canInstall && info && manualSteps(info.install, update.download) && (
                <p className="prefs-note">{manualSteps(info.install, update.download)}</p>
              )}
            </>
          )}
          {phase.kind === "downloading" && (
            <div className="upd-progress">
              <div
                className="upd-bar"
                role="progressbar"
                aria-label="download"
                aria-valuemin={0}
                aria-valuemax={phase.total ?? undefined}
                aria-valuenow={phase.total ? phase.got : undefined}
              >
                <div style={{ width: phase.total ? `${Math.min(100, (100 * phase.got) / phase.total)}%` : "0%" }} />
              </div>
              <span className="prefs-note" role="status">Downloading… {progressText(phase.got, phase.total)}</span>
            </div>
          )}
          {phase.kind === "installing" && (
            <p className="prefs-note" role="status">Installing: glasshouse closes and starts again.</p>
          )}
          {cancelError && <p className="prefs-note error" role="alert">{cancelError}</p>}
        </div>
        <div className="prefs-foot">
          {update && (
            <button type="button" onClick={() => void openUrl(releasePage(update.version))} disabled={busy}>release page</button>
          )}
          {phase.kind === "error" && !update && (
            <button type="button" onClick={() => void openUrl(RELEASES_URL)}>releases</button>
          )}
          {phase.kind === "error" && !update && <button type="button" onClick={check}>try again</button>}
          {phase.kind === "available" && !update?.canInstall && update?.download && (
            <button type="button" className="primary" onClick={() => void openUrl(update.download!)}>download</button>
          )}
          {phase.kind === "available" && update?.canInstall && (
            <button type="button" className="primary" onClick={() => install(update)}>install and restart</button>
          )}
          {phase.kind === "downloading" && <button type="button" onClick={cancel}>cancel</button>}
          {!busy && (
            <button type="button" onClick={onClose}>{phase.kind === "available" ? "later" : "close"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The release notes as text: headings, bullets and paragraphs, no HTML. */
function Notes({ notes }: { notes: string }) {
  const blocks = noteBlocks(notes);
  if (blocks.length === 0) return <p className="prefs-note">This release has no notes; the release page may say more.</p>;
  return (
    <div className="upd-notes" aria-label="what's new" tabIndex={0}>
      {blocks.map((b, i) =>
        b.kind === "heading" ? <h4 key={i}>{b.text}</h4>
        : b.kind === "item" ? <p key={i} className="upd-item" style={{ marginLeft: `${2 + 2 * b.depth}ch` }}>{b.text}</p>
        : <p key={i}>{b.text}</p>,
      )}
    </div>
  );
}
