// Report Bug…'s issue: the form's fields filled in by id, and nothing that
// names the user, the machine or a file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { issueUrl, reportFields, reportText, type ReportFacts } from "./bugReport";

const linux: ReportFacts = {
  version: "0.3.0",
  os: "Ubuntu 24.04",
  arch: "x86_64",
  desktop: "ubuntu / GNOME (wayland)",
  webview: "WebKitGTK 2.48.3",
  scale: 1.25,
};
const windows: ReportFacts = { version: "0.3.0", os: "Windows 11 (26100)", arch: "x86_64", desktop: null, webview: "WebView2 142.0.3595.53", scale: 1 };

describe("Report Bug…", () => {
  it("fills in the form's fields by their ids", () => {
    const q = new URL(issueUrl(linux)).searchParams;
    expect(q.get("template")).toBe("bug_report.yml");
    expect(q.get("version")).toBe("0.3.0");
    expect(q.get("os")).toBe("Ubuntu 24.04 (x86_64)");
    expect(q.get("desktop")).toBe("ubuntu / GNOME (wayland), 125% scale");
    expect(q.get("webview")).toBe("WebKitGTK 2.48.3");
  });

  it("uses only ids the issue form has", () => {
    const form = readFileSync(new URL("../.github/ISSUE_TEMPLATE/bug_report.yml", import.meta.url), "utf8");
    const ids = new Set([...form.matchAll(/^\s+id: (\S+)$/gm)].map(m => m[1]));
    for (const f of reportFields(linux)) expect(ids, f.id).toContain(f.id);
  });

  it("leaves out what it has nothing for", () => {
    expect(reportFields(windows).map(f => f.id)).toEqual(["version", "os", "webview"]);
    expect(new URL(issueUrl(windows)).searchParams.has("desktop")).toBe(false);
    expect(reportFields({ ...windows, scale: 1.5 }).find(f => f.id === "desktop")?.value).toBe("150% scale");
  });

  it("shows the same lines it sends", () => {
    expect(reportText(linux)).toBe(
      "glasshouse: 0.3.0\nOS: Ubuntu 24.04 (x86_64)\nDesktop: ubuntu / GNOME (wayland), 125% scale\nWeb view: WebKitGTK 2.48.3",
    );
    const body = new URL(issueUrl(linux)).searchParams.get("body") ?? "";
    for (const line of reportText(linux).split("\n")) expect(body).toContain(`- ${line}`);
  });

  it("sends nothing but the facts", () => {
    const url = issueUrl(linux);
    const sent = [...new URL(url).searchParams.values()].join("\n");
    expect(sent).not.toMatch(/[/\\]home|Users|@/);
    expect(url.startsWith("https://github.com/Johnson-Anthony/glasshouse/issues/new?")).toBe(true);
  });
});
