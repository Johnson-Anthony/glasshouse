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

function Invoke-AppAlone([string]$Name, [hashtable]$Env, [int]$Seconds, [scriptblock]$While) {
  Say ""
  Say "== $Name"
  $saved = @{}
  foreach ($k in $Env.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $Env[$k]) }
  try {
    $out = Join-Path $OutDir "$Name.stdout.txt"
    $err = Join-Path $OutDir "$Name.stderr.txt"
    $p = Start-Process -FilePath $App -WorkingDirectory (Split-Path $App) -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  } finally {
    foreach ($k in $Env.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $Seconds -and -not $p.HasExited) {
    if ($While) { & $While $p }
    Start-Sleep -Milliseconds 500
  }
  if ($p.HasExited) {
    Say ('exited after {0:n1} s with code {1} (0x{1:X8})' -f ($p.ExitTime - $p.StartTime).TotalSeconds, $p.ExitCode)
  } else {
    $p.Refresh()
    Say "alive after $Seconds s; main window: '$($p.MainWindowTitle)'"
    Show-Tree $Name
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'windows-desktop.ps1') -OutDir (New-Item -ItemType Directory -Force -Path (Join-Path $OutDir $Name)).FullName | Out-Null
  }
  Show-DevToolsFiles $Name
  Stop-App
  foreach ($f in $out, $err) {
    $text = Get-Content $f -Raw -ErrorAction SilentlyContinue
    Say "-- $(Split-Path $f -Leaf): $(if ($text) { "`n$text" } else { '(empty)' })"
  }
}

Say "== facts"
Say "app: $App ($((Get-Item $App).Length) bytes)"
Say "driver: $Driver ($((& $Driver --version) -join ' '))"
Say "identifier: $identifier; data dir $dataDir; config dir $configDir"
Say "WEBVIEW2_* env: $((Get-ChildItem env: | Where-Object Name -like 'WEBVIEW2*' | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; ')"
foreach ($key in 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2', 'HKCU:\SOFTWARE\Policies\Microsoft\Edge\WebView2', 'HKLM:\SOFTWARE\Policies\Microsoft\Edge', 'HKCU:\SOFTWARE\Policies\Microsoft\Edge') {
  if (Test-Path $key) {
    Say "policy $key"
    Get-ChildItem -Path $key -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Say "   subkey $($_.Name): $(($_.Property) -join ', ')" }
    $props = Get-ItemProperty -Path $key
    $props.PSObject.Properties | Where-Object Name -notlike 'PS*' | ForEach-Object { Say "   $($_.Name) = $($_.Value)" }
  } else { Say "policy $key`: none" }
}
$rt = Get-ChildItem 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application' -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Say "WebView2 Runtime folders: $($rt -join ', ')"
Say "data dir before: $(if (Test-Path $dataDir) { (Get-ChildItem $dataDir -Force).Name -join ', ' } else { 'none' })"

# 1. The app on its own: does it start, make a window and its WebView2?
Invoke-AppAlone 'alone' @{ RUST_BACKTRACE = '1' } 15 $null

# 2. With a fixed remote-debugging port, as a driver would ask: does
# DevTools answer, and where does DevToolsActivePort go?
$script:devtools = $null
Invoke-AppAlone 'debug-port' @{ RUST_BACKTRACE = '1'; WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333' } 20 {
  param($p)
  if (-not $script:devtools) {
    try { $script:devtools = Invoke-RestMethod -Uri 'http://127.0.0.1:9333/json/version' -TimeoutSec 1 } catch { }
  }
}
Say "-- DevTools on 9333: $(if ($script:devtools) { $script:devtools | ConvertTo-Json -Compress } else { 'no answer' })"

# 3. msedgedriver on its own, sent what tauri-driver sends, logging verbosely.
function Invoke-DriverSession([string]$Name, [hashtable]$EdgeOptions) {
  Say ""
  Say "== $Name"
  $port = 9515
  $log = Join-Path $OutDir "$Name.msedgedriver.log"
  $env:TAURI_WEBVIEW_AUTOMATION = 'true'
  $d = Start-Process -FilePath $Driver -ArgumentList "--port=$port", '--verbose', "--log-path=$log" -PassThru -WindowStyle Hidden
  Remove-Item env:TAURI_WEBVIEW_AUTOMATION
  Start-Sleep -Seconds 2
  $caps = @{ capabilities = @{ alwaysMatch = @{ browserName = 'webview2'; 'ms:edgeChromium' = $true; 'ms:edgeOptions' = $EdgeOptions } } } | ConvertTo-Json -Depth 6
  Say "caps: $($caps -replace '\s+', ' ')"
  $job = Start-ThreadJob -ArgumentList $port, $caps -ScriptBlock {
    param($port, $caps)
    try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/session" -Body $caps -ContentType 'application/json' -TimeoutSec 100 | ConvertTo-Json -Depth 8 }
    catch { "FAILED: $($_.Exception.Message) $($_.ErrorDetails.Message)" }
  }
  foreach ($at in 10, 30) {
    while (((Get-Date) - $d.StartTime).TotalSeconds -lt $at -and $job.State -eq 'Running') { Start-Sleep -Milliseconds 500 }
    if ($job.State -ne 'Running') { break }
    Show-Tree "$Name, $at s"
    Show-DevToolsFiles "$Name, $at s"
  }
  $result = Receive-Job -Job $job -Wait -AutoRemoveJob
  Say "-- New Session: $result"
  if ($result -notmatch '^FAILED') {
    $id = ($result | ConvertFrom-Json).value.sessionId
    $shot = Invoke-RestMethod -Uri "http://127.0.0.1:$port/session/$id/screenshot" -TimeoutSec 30
    [IO.File]::WriteAllBytes((Join-Path $OutDir "$Name.webview.png"), [Convert]::FromBase64String($shot.value))
    $title = Invoke-RestMethod -Uri "http://127.0.0.1:$port/session/$id/title" -TimeoutSec 30
    Say "-- title: $($title.value)"
    Show-Tree "$Name, session up"
    Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:$port/session/$id" -TimeoutSec 30 | Out-Null
  }
  Stop-Process -Id $d.Id -Force -ErrorAction SilentlyContinue
  Stop-App
  return ($result -notmatch '^FAILED')
}

$ok = Invoke-DriverSession 'driver' @{ binary = $App; args = @() }
if (-not $ok) {
  # The browser's own user-data-dir switch, pointed at the folder Tauri gives
  # WebView2, in case msedgedriver waits for DevToolsActivePort elsewhere.
  [void](Invoke-DriverSession 'driver-udd' @{ binary = $App; args = @("--user-data-dir=$dataDir\EBWebView") })
}

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
Say "data dir after: $(if (Test-Path $dataDir) { (Get-ChildItem $dataDir -Force).Name -join ', ' } else { 'none' })"
exit 0
