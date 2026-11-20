// What the window shows when rendering fails, instead of going blank: say
// so, log it, and offer Reload, the log folder and a bug report. App's own
// dialogs are gone by then (they render inside it), so this screen has its
// own buttons and the bug report's preview inline.

import React, { useState } from "react";
import { logDir, openUrlStrict, openWithDefaultStrict } from "./api";
import { collectFacts, issueUrl, PREVIEW_INTRO, PREVIEW_NOTE, reportText, type ReportFacts } from "./bugReport";
import { ErrorDetails } from "./dialogs/DialogHost";
import { errText } from "./errors";
import { describeForLog, logError } from "./log";

interface BoundaryProps {
  children: React.ReactNode;
  /** An extra "cancel" button: the file chooser answers its caller with it. */
  onCancel?: () => void;
  /** Runs once it has failed: the chooser shows its window, which is made
   *  hidden until the page has rendered. */
  onCrash?: () => void;
}

interface BoundaryState {
  failed: boolean;
  error: unknown;
  componentStack: string;
}

/** Catches what its children throw while rendering, logs it, and shows the
 *  crash screen in their place. */
export class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, error: null, componentStack: "" };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    this.setState({ componentStack });
    logError(`the window failed to render: ${describeForLog(error)}${componentStack}`);
    this.props.onCrash?.();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { error, componentStack } = this.state;
    const detail = [describeForLog(error).trim(), componentStack.trim()].filter(Boolean).join("\n\n");
    return <CrashScreen detail={detail} onCancel={this.props.onCancel} />;
  }
}

export function CrashScreen({ detail, onCancel }: { detail: string; onCancel?: () => void }) {
  const [facts, setFacts] = useState<ReportFacts | null | "none">(null);
  const [problem, setProblem] = useState<string | null>(null);

  const openLogs = () => {
    setProblem(null);
    logDir()
      .then(dir => (dir ? openWithDefaultStrict(dir) : null))
      .catch(e => setProblem(errText(e)));
  };
  const report = () => {
    setProblem(null);
    void collectFacts().then(f => setFacts(f ?? "none"));
  };
  const send = (f: ReportFacts) => {
    openUrlStrict(issueUrl(f)).then(() => setFacts(null), e => setProblem(errText(e)));
  };

  return (
    <div className="crash-screen" role="alert">
      <div className="crash-panel">
        <h1>glasshouse ran into a problem</h1>
        <p>
          Something in this window failed, so it can't be shown. Reload starts the window again; your
          settings and tabs are kept. If it keeps happening, please report it.
        </p>
        <div className="crash-buttons">
          <button className="primary" onClick={() => window.location.reload()}>reload</button>
          <button onClick={openLogs}>open log folder</button>
          <button onClick={report}>report bug…</button>
          {onCancel && <button onClick={onCancel}>cancel</button>}
        </div>
        {problem && <p className="crash-problem">{problem}</p>}
        {facts === "none" && <p className="crash-problem">The system details aren't available here.</p>}
        {facts && facts !== "none" && (
          <div className="crash-report">
            <p>{PREVIEW_INTRO}</p>
            <pre>{reportText(facts)}</pre>
            <p>{PREVIEW_NOTE} The error below isn't included; copy what you want from it.</p>
            <div className="crash-buttons">
              <button onClick={() => setFacts(null)}>cancel</button>
              <button className="primary" onClick={() => send(facts)}>open GitHub</button>
            </div>
          </div>
        )}
        <ErrorDetails detail={detail} />
      </div>
    </div>
  );
}
