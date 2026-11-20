# Runs a command without admin rights: as the same user, with the
# Administrators group deny-only, no admin privileges, and medium integrity
# (the "Basic User" SAFER level that `runas /trustlevel:0x20000` uses). The
# child gets this script's environment, working folder and standard handles;
# the script waits for it and exits with its exit code.
#
# Why: GitHub's Windows runners run every step elevated, and an elevated
# WebView2 app ignores the WEBVIEW2_* environment variables, which is how
# msedgedriver turns on remote debugging and picks the user data folder.
# Under an elevated tauri-driver, a session never starts ("DevToolsActivePort
# file doesn't exist"). See docs/decisions/2026-11-20-e2e-windows-elevation.md.
#
# The command line comes in E2E_UNELEVATED_COMMAND, already quoted, so that
# no PowerShell argument parsing touches it:
#   $env:E2E_UNELEVATED_COMMAND = '"C:\path\tauri-driver.exe" --port 4444'
#   powershell -NoProfile -ExecutionPolicy Bypass -File e2e/unelevated.ps1
# Runs on Windows PowerShell 5.1, which every Windows has.
$ErrorActionPreference = 'Stop'
$command = $env:E2E_UNELEVATED_COMMAND
if (-not $command) { throw 'E2E_UNELEVATED_COMMAND is empty: set it to the command line to run' }
[Environment]::SetEnvironmentVariable('E2E_UNELEVATED_COMMAND', $null)

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class E2eUnelevated {
  const uint SAFER_SCOPEID_USER = 2;
  const uint SAFER_LEVELID_NORMALUSER = 0x20000;
  const uint SAFER_LEVEL_OPEN = 1;
  const int TokenIntegrityLevel = 25;
  const uint SE_GROUP_INTEGRITY = 0x20;
  const uint STARTF_USESTDHANDLES = 0x100;
  const uint HANDLE_FLAG_INHERIT = 1;
  const uint INFINITE = 0xFFFFFFFF;

  [StructLayout(LayoutKind.Sequential)]
  struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SaferCreateLevel(uint scope, uint level, uint flags, out IntPtr handle, IntPtr reserved);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SaferComputeTokenFromLevel(IntPtr level, IntPtr inToken, out IntPtr outToken, uint flags, IntPtr reserved);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SaferCloseLevel(IntPtr level);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertStringSidToSid(string sid, out IntPtr psid);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint GetLengthSid(IntPtr psid);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SetTokenInformation(IntPtr token, int infoClass, IntPtr info, uint length);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessAsUserW(IntPtr token, string app, StringBuilder commandLine, IntPtr pa, IntPtr ta,
    bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr mem);

  static Win32Exception Fail(string what) {
    int code = Marshal.GetLastWin32Error();
    return new Win32Exception(code, what + ": " + new Win32Exception(code).Message);
  }

  static IntPtr InheritableStd(int which) {
    IntPtr h = GetStdHandle(which);
    if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    return h;
  }

  public static uint Run(string commandLine) {
    IntPtr level, token;
    if (!SaferCreateLevel(SAFER_SCOPEID_USER, SAFER_LEVELID_NORMALUSER, SAFER_LEVEL_OPEN, out level, IntPtr.Zero)) throw Fail("SaferCreateLevel");
    try {
      if (!SaferComputeTokenFromLevel(level, IntPtr.Zero, out token, 0, IntPtr.Zero)) throw Fail("SaferComputeTokenFromLevel");
    } finally {
      SaferCloseLevel(level);
    }
    try {
      // Medium integrity, as a process the user starts from Explorer has.
      IntPtr sid;
      if (!ConvertStringSidToSid("S-1-16-8192", out sid)) throw Fail("ConvertStringSidToSid");
      try {
        SID_AND_ATTRIBUTES label = new SID_AND_ATTRIBUTES { Sid = sid, Attributes = SE_GROUP_INTEGRITY };
        int size = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
        IntPtr info = Marshal.AllocHGlobal(size);
        try {
          Marshal.StructureToPtr(label, info, false);
          if (!SetTokenInformation(token, TokenIntegrityLevel, info, (uint)size + GetLengthSid(sid))) throw Fail("SetTokenInformation(integrity)");
        } finally {
          Marshal.FreeHGlobal(info);
        }
      } finally {
        LocalFree(sid);
      }

      STARTUPINFO si = new STARTUPINFO();
      si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
      si.dwFlags = STARTF_USESTDHANDLES;
      si.hStdInput = InheritableStd(-10);
      si.hStdOutput = InheritableStd(-11);
      si.hStdError = InheritableStd(-12);
      PROCESS_INFORMATION pi;
      if (!CreateProcessAsUserW(token, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, null, ref si, out pi)) {
        throw Fail("CreateProcessAsUser(" + commandLine + ")");
      }
      CloseHandle(pi.hThread);
      WaitForSingleObject(pi.hProcess, INFINITE);
      uint code;
      GetExitCodeProcess(pi.hProcess, out code);
      CloseHandle(pi.hProcess);
      return code;
    } finally {
      CloseHandle(token);
    }
  }
}
'@

$code = [E2eUnelevated]::Run($command)
# An NTSTATUS such as 0xC0000005 doesn't fit an int as a number.
exit [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$code), 0)
