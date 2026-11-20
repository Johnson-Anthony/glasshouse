# Why a WebDriver session can't start on Windows: runs the app on its own,
# then msedgedriver on its own (verbose), and collects crash records.
# Writes everything to -OutDir; never fails the step.
#
#   pwsh ./e2e/windows-diagnose.ps1 -App <glasshouse.exe> -Driver <msedgedriver.exe> -OutDir <dir>
#Requires -Version 7
param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Driver,
  [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$started = Get-Date
$report = Join-Path $OutDir 'report.txt'
function Say([string]$Text) {
  Write-Host $Text
  Add-Content -Path $report -Value $Text
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class E2eWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[void][E2eWin]::SetProcessDPIAware()

$identifier = (Get-Content (Join-Path $PSScriptRoot '..\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).identifier
$dataDir = Join-Path $env:LOCALAPPDATA $identifier
$configDir = Join-Path $env:APPDATA $identifier

function Show-Tree([string]$Title) {
  Say "-- processes ($Title)"
  $all = Get-CimInstance Win32_Process
  foreach ($p in $all | Where-Object { $_.Name -match '^(glasshouse|msedgewebview2|msedgedriver|WerFault)' }) {
    $line = '{0} pid {1} parent {2}' -f $p.Name, $p.ProcessId, $p.ParentProcessId
    $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
      $r = New-Object E2eWin+RECT
      [void][E2eWin]::GetWindowRect($proc.MainWindowHandle, [ref]$r)
      $line += ', window "{0}" at {1},{2} to {3},{4}' -f $proc.MainWindowTitle, $r.Left, $r.Top, $r.Right, $r.Bottom
    }
    Say $line
    # The browser process's switches: --user-data-dir, --remote-debugging-*.
    if ($p.Name -match '^msedgewebview2' -and $p.CommandLine -notmatch '--type=') {
      Say "   cmd: $($p.CommandLine)"
    }
    if ($p.Name -match '^glasshouse') { Say "   cmd: $($p.CommandLine)" }
  }
}

function Show-DevToolsFiles([string]$Title) {
  Say "-- DevToolsActivePort files ($Title)"
  foreach ($root in $dataDir, $env:TEMP) {
    if (-not (Test-Path $root)) { Say "   $root doesn't exist"; continue }
    Get-ChildItem -Path $root -Recurse -Depth 4 -Filter DevToolsActivePort -Force -ErrorAction SilentlyContinue |
      ForEach-Object { Say "   $($_.FullName) ($($_.LastWriteTime)): $((Get-Content $_.FullName -Raw) -replace '\s+', ' ')" }
  }
}

function Stop-App {
  Get-Process -Name glasshouse -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Reset-AppData {
  Stop-App
  foreach ($d in $dataDir, $configDir) { if (Test-Path $d) { Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue } }
}

# Starts $Program with $Arguments, or without admin rights through
# unelevated.ps1 (which takes the whole command line in an env variable).
function Start-Program([string]$Program, [string[]]$Arguments, [bool]$Unelevated, [string]$Out, [string]$Err) {
  if ($Unelevated) {
    $env:E2E_UNELEVATED_COMMAND = ((@($Program) + $Arguments) | ForEach-Object { if ($_ -match '[\s"]') { '"' + $_ + '"' } else { $_ } }) -join ' '
    try {
      return Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'unelevated.ps1') -PassThru -RedirectStandardOutput $Out -RedirectStandardError $Err
    } finally { Remove-Item env:E2E_UNELEVATED_COMMAND }
  }
  if ($Arguments) { return Start-Process -FilePath $Program -ArgumentList $Arguments -PassThru -RedirectStandardOutput $Out -RedirectStandardError $Err }
  return Start-Process -FilePath $Program -PassThru -RedirectStandardOutput $Out -RedirectStandardError $Err
}

function Invoke-AppAlone([string]$Name, [hashtable]$Env, [int]$Seconds, [bool]$Unelevated, [int]$DebugPort) {
  Say ""
  Say "== $Name"
  Reset-AppData
  $saved = @{}
  foreach ($k in $Env.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $Env[$k]) }
  $out = Join-Path $OutDir "$Name.stdout.txt"
  $err = Join-Path $OutDir "$Name.stderr.txt"
  try {
    $p = Start-Program $App @() $Unelevated $out $err
  } finally {
    foreach ($k in $Env.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
  $devtools = $null
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $Seconds -and -not $p.HasExited) {
    if ($DebugPort -and -not $devtools) {
      try { $devtools = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/version" -TimeoutSec 1 } catch { }
    }
    Start-Sleep -Milliseconds 500
  }
  if ($p.HasExited) {
    Say ('exited after {0:n1} s with code {1} (0x{1:X8})' -f ($p.ExitTime - $p.StartTime).TotalSeconds, $p.ExitCode)
  } else {
    Say "alive after $Seconds s"
    Show-Tree $Name
  }
  if ($DebugPort) { Say "-- DevTools on $DebugPort`: $(if ($devtools) { $devtools | ConvertTo-Json -Compress } else { 'no answer' })" }
  Show-DevToolsFiles $Name
  Stop-App
  foreach ($f in $out, $err) {
    $text = Get-Content $f -Raw -ErrorAction SilentlyContinue
    Say "-- $(Split-Path $f -Leaf): $(if ($text) { "`n$text" } else { '(empty)' })"
  }
}

Say "== elevation"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
Say "admin role: $(([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
Say "integrity: $((& whoami.exe /groups) | Select-String 'Mandatory Label')"
$uac = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction SilentlyContinue
Say "EnableLUA=$($uac.EnableLUA) ConsentPromptBehaviorAdmin=$($uac.ConsentPromptBehaviorAdmin) FilterAdministratorToken=$($uac.FilterAdministratorToken)"
# Without admin rights, the child still has to read these.
foreach ($path in 'D:\a', $App, $Driver) { Say "acl $path`: $(((& icacls.exe $path) | Select-Object -SkipLast 2) -join ' | ')" }
$who = Join-Path $OutDir 'unelevated-whoami.txt'
$w = Start-Program 'whoami.exe' @('/groups') $true $who (Join-Path $OutDir 'unelevated-whoami.err.txt')
$w.WaitForExit(30000) | Out-Null
Say "unelevated.ps1's child (exit $($w.ExitCode)):"
Get-Content $who -ErrorAction SilentlyContinue | Select-String 'Mandatory Label|Administrators' | ForEach-Object { Say "   $($_.Line.Trim() -replace '\s{2,}', ' | ')" }
Say "   stderr: $(Get-Content (Join-Path $OutDir 'unelevated-whoami.err.txt') -Raw -ErrorAction SilentlyContinue)"

# A. Elevated, with the switch from the HKLM policy, which the docs say an
# elevated app still honors (the env variable and HKCU it ignores).
$policy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
New-Item -Path $policy -Force | Out-Null
New-ItemProperty -Path $policy -Name 'glasshouse.exe' -Value '--remote-debugging-port=9334' -PropertyType String -Force | Out-Null
try {
  Invoke-AppAlone 'elevated-policy' @{} 20 $false 9334
} finally {
  Remove-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2' -Recurse -Force -ErrorAction SilentlyContinue
}
# B. The env variable, elevated (as run 1 saw) and then without admin rights.
Invoke-AppAlone 'elevated-env' @{ WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9335' } 20 $false 9335
Invoke-AppAlone 'unelevated-env' @{ WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9336' } 20 $true 9336

# C. msedgedriver without admin rights, sent what tauri-driver sends.
function Invoke-DriverSession([string]$Name, [hashtable]$EdgeOptions, [bool]$Unelevated) {
  Say ""
  Say "== $Name"
  Reset-AppData
  $port = 9515
  $log = Join-Path $OutDir "$Name.msedgedriver.log"
  $env:TAURI_WEBVIEW_AUTOMATION = 'true'
  $d = Start-Program $Driver @("--port=$port", '--verbose', "--log-path=$log") $Unelevated (Join-Path $OutDir "$Name.driver.stdout.txt") (Join-Path $OutDir "$Name.driver.stderr.txt")
  Remove-Item env:TAURI_WEBVIEW_AUTOMATION
  Start-Sleep -Seconds 3
  $caps = @{ capabilities = @{ alwaysMatch = @{ browserName = 'webview2'; 'ms:edgeChromium' = $true; 'ms:edgeOptions' = $EdgeOptions } } } | ConvertTo-Json -Depth 6
  Say "caps: $($caps -replace '\s+', ' ')"
  $job = Start-ThreadJob -ArgumentList $port, $caps -ScriptBlock {
    param($port, $caps)
    try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/session" -Body $caps -ContentType 'application/json' -TimeoutSec 100 | ConvertTo-Json -Depth 8 }
    catch { "FAILED: $($_.Exception.Message) $($_.ErrorDetails.Message)" }
  }
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt 15 -and $job.State -eq 'Running') { Start-Sleep -Milliseconds 500 }
  if ($job.State -eq 'Running') { Show-Tree "$Name, 15 s"; Show-DevToolsFiles "$Name, 15 s" }
  $result = Receive-Job -Job $job -Wait -AutoRemoveJob
  Say "-- New Session: $result"
  if ($result -notmatch '^FAILED') {
    $id = ($result | ConvertFrom-Json).value.sessionId
    Start-Sleep -Seconds 3
    $shot = Invoke-RestMethod -Uri "http://127.0.0.1:$port/session/$id/screenshot" -TimeoutSec 30
    [IO.File]::WriteAllBytes((Join-Path $OutDir "$Name.webview.png"), [Convert]::FromBase64String($shot.value))
    $title = Invoke-RestMethod -Uri "http://127.0.0.1:$port/session/$id/title" -TimeoutSec 30
    Say "-- title: $($title.value)"
    Show-Tree "$Name, session up"
    Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:$port/session/$id" -TimeoutSec 30 | Out-Null
  }
  Stop-Process -Id $d.Id -Force -ErrorAction SilentlyContinue
  Get-Process -Name msedgedriver -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Stop-App
}

Invoke-DriverSession 'unelevated-driver' @{ binary = $App; args = @() } $true

# 4. Crash records since this script started (and the hour before: the
# smoke test may have run first).
Say ""
Say "== Application log: 1000 (crash), 1001 (WER), 1026 (.NET)"
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000, 1001, 1026; StartTime = $started.AddHours(-1) } -ErrorAction SilentlyContinue |
  ForEach-Object { Say "[$($_.TimeCreated)] $($_.Id) $($_.ProviderName): $($_.Message -replace '\s+', ' ')" }
Say "== WER reports"
foreach ($root in "$env:ProgramData\Microsoft\Windows\WER", "$env:LOCALAPPDATA\Microsoft\Windows\WER", "$env:LOCALAPPDATA\CrashDumps") {
  Get-ChildItem -Path $root -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object LastWriteTime -gt $started.AddHours(-1) | ForEach-Object {
    Say "$($_.FullName) ($($_.Length) bytes)"
    if ($_.Name -eq 'Report.wer') { Copy-Item $_.FullName (Join-Path $OutDir "wer-$($_.Directory.Name).txt") }
  }
}
# The smoke test after this gets a first start, as a new user would.
Reset-AppData
exit 0
