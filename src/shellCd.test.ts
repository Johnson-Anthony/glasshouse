import { describe, expect, it } from "vitest";
import type { ShellProfile } from "./api";
import { makeCdCommand, winPathToWsl } from "./shellCd";

function profile(over: Partial<ShellProfile>): ShellProfile {
  return {
    id: "shell:bash",
    label: "bash",
    exec: "/usr/bin/bash",
    args: [],
    kind: "shell",
    ...over,
  } as ShellProfile;
}

describe("winPathToWsl", () => {
  it("converts drive-letter paths to /mnt form", () => {
    expect(winPathToWsl("C:\\Users\\foo")).toBe("/mnt/c/Users/foo");
    expect(winPathToWsl("D:/data/x")).toBe("/mnt/d/data/x");
  });

  it("handles bare drives and trailing slashes", () => {
    expect(winPathToWsl("C:")).toBe("/mnt/c");
    expect(winPathToWsl("C:\\")).toBe("/mnt/c");
  });

  it("translates \\\\wsl$ UNC paths to native paths", () => {
    expect(winPathToWsl("\\\\wsl$\\Ubuntu\\home\\me")).toBe("/home/me");
    expect(winPathToWsl("\\\\wsl.localhost\\Ubuntu")).toBe("/");
  });

  it("leaves posix paths untouched", () => {
    expect(winPathToWsl("/home/me/projects")).toBe("/home/me/projects");
  });
});

describe("makeCdCommand", () => {
  it("returns null for ssh profiles", () => {
    expect(makeCdCommand(profile({ kind: "ssh", id: "ssh:box" }), "/tmp")).toBeNull();
  });

  it("emits Set-Location for powershell/cmd flavors", () => {
    for (const p of [
      profile({ id: "shell:pwsh", exec: "C:\\pwsh.exe" }),
      profile({ id: "shell:powershell", exec: "powershell.exe" }),
      profile({ id: "shell:cmd", exec: "C:\\Windows\\cmd.exe" }),
    ]) {
      expect(makeCdCommand(p, "C:\\Users\\foo")).toBe('Set-Location "C:\\Users\\foo"');
    }
  });

  it("emits cd with wsl-translated path for posix flavors", () => {
    expect(makeCdCommand(profile({}), "/home/me")).toBe('cd "/home/me"');
    expect(makeCdCommand(profile({ kind: "wsl", id: "wsl:Ubuntu" }), "C:\\Users\\foo"))
      .toBe('cd "/mnt/c/Users/foo"');
  });

  it("escapes embedded double quotes", () => {
    expect(makeCdCommand(profile({}), '/tmp/we"ird')).toBe('cd "/tmp/we\\"ird"');
  });
});
