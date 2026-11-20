# Windows facts for the e2e artifacts, taken while the app is open:
#   desktop.png  the whole desktop (CopyFromScreen), to tell a blank window
#                from one drawn off screen or not at all;
#   session.txt  who's logged on (`query user`), the screens' resolution,
#                and the app's processes with their session and window rect
#                (session 0 would mean no interactive desktop).
# Runs on Windows PowerShell 5.1, which every Windows has.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File e2e/windows-desktop.ps1 -OutDir <dir>
param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Continue'

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class E2eDesktop {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
'@
# Real pixels, not the scaled ones a DPI-unaware process is told.
[void][E2eDesktop]::SetProcessDPIAware()

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('== query user')
$lines.Add(((& query.exe user 2>&1) | Out-String).TrimEnd())
$lines.Add("== whoami: $(& whoami.exe)")
$lines.Add("== this script's session: $((Get-Process -Id $PID).SessionId)")

$lines.Add('== screens')
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  $lines.Add(('{0}: {1}x{2} at {3},{4}, working area {5}x{6}, primary {7}' -f $s.DeviceName, $s.Bounds.Width, $s.Bounds.Height, $s.Bounds.X, $s.Bounds.Y, $s.WorkingArea.Width, $s.WorkingArea.Height, $s.Primary))
}

$lines.Add('== processes')
foreach ($p in Get-Process -Name glasshouse, msedgewebview2, msedgedriver, tauri-driver -ErrorAction SilentlyContinue) {
  $window = 'no main window'
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    $r = New-Object E2eDesktop+RECT
    if ([E2eDesktop]::GetWindowRect($p.MainWindowHandle, [ref]$r)) {
      $window = 'window "{0}" at {1},{2} to {3},{4}' -f $p.MainWindowTitle, $r.Left, $r.Top, $r.Right, $r.Bottom
    }
  }
  $lines.Add(('{0} pid {1}, session {2}, {3}' -f $p.ProcessName, $p.Id, $p.SessionId, $window))
}

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
  $bitmap.Save((Join-Path $OutDir 'desktop.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $lines.Add("== desktop.png: $($bounds.Width)x$($bounds.Height)")
} catch {
  # "The handle is invalid" here means there's no interactive desktop.
  $lines.Add("== desktop screenshot failed: $($_.Exception.Message)")
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

$lines | Set-Content -Path (Join-Path $OutDir 'session.txt') -Encoding UTF8
$lines | ForEach-Object { Write-Host $_ }
