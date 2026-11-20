# CI's installers job (windows-latest), after `pnpm tauri build --debug
# --bundles nsis,msi`: uninstalling glasshouse turns "Open folders with
# glasshouse" off and puts back the default verb it replaced
# (src-tauri/windows/hooks.nsh for NSIS, integration.wxs for the MSI).
#
# Each round installs, sets a stand-in default verb as another app would,
# turns the setting on with the installed glasshouse.exe, uninstalls, and
# checks the registry. Run it on a throwaway machine: it installs and
# uninstalls glasshouse and changes HKCU\Software\Classes.
$ErrorActionPreference = 'Stop'

$bundle = Join-Path $PSScriptRoot '..\src-tauri\target\debug\bundle'
$log = $env:RUNNER_TEMP
if (-not $log) { $log = $env:TEMP }
$dirShell = 'HKCU:\Software\Classes\Directory\shell'
$driveShell = 'HKCU:\Software\Classes\Drive\shell'

function Get-DefaultVerb($key) {
  if (Test-Path $key) { (Get-Item $key).GetValue('') } else { $null }
}

function Invoke-Checked($file, [string[]]$arguments) {
  $p = Start-Process $file -ArgumentList $arguments -Wait -PassThru -NoNewWindow
  # 3010: done, a restart is needed to finish.
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    throw "$file $arguments exited $($p.ExitCode)"
  }
}

function Test-Round($name, $install, $exe, $uninstall) {
  Write-Host "== $name"
  & $install
  if (-not (Test-Path $exe)) {
    # Say where it went instead: the install folders, the MSI's chosen INSTALLDIR.
    foreach ($d in (Join-Path $env:ProgramFiles 'glasshouse'), (Join-Path $env:LOCALAPPDATA 'glasshouse')) {
      if (Test-Path $d) { Write-Host "$d contains: $((Get-ChildItem $d).Name -join ', ')" }
    }
    $msiLog = Join-Path $log 'msi-install.log'
    if (Test-Path $msiLog) {
      Select-String -Path $msiLog -Pattern 'INSTALLDIR|Return value 3' | Select-Object -First 20 | ForEach-Object { Write-Host $_.Line }
    }
    throw "${name}: $exe isn't there after installing"
  }

  New-Item -Path $dirShell -Force | Out-Null
  Set-ItemProperty -Path $dirShell -Name '(default)' -Value 'standin'
  Invoke-Checked $exe @('--integration-on', 'folders')
  foreach ($k in $dirShell, $driveShell) {
    $v = Get-DefaultVerb $k
    if ($v -ne 'glasshouse') { throw "${name}: $k's default verb is '$v' after turning on" }
  }

  & $uninstall
  $v = Get-DefaultVerb $dirShell
  if ($v -ne 'standin') { throw "${name}: Directory's default verb is '$v' after uninstalling, not the stand-in" }
  foreach ($k in $dirShell, $driveShell) {
    if (Test-Path "$k\glasshouse") { throw "${name}: $k\glasshouse is still there after uninstalling" }
  }
  # Turning on made Drive\shell; nothing else is in it.
  if (Test-Path $driveShell) { throw "${name}: $driveShell is still there after uninstalling" }
  Remove-Item -Path $dirShell -Recurse -Force
  Write-Host "${name}: ok"
}

$setup = (Get-ChildItem "$bundle\nsis\*-setup.exe" | Select-Object -First 1).FullName
$userDir = Join-Path $env:LOCALAPPDATA 'glasshouse'
# _?= runs the uninstaller in place, so Start-Process waits for it.
Test-Round 'NSIS' `
  { Invoke-Checked $setup @('/S') } `
  (Join-Path $userDir 'glasshouse.exe') `
  { Invoke-Checked (Join-Path $userDir 'uninstall.exe') @('/S', "_?=$userDir") }

# The NSIS uninstaller keeps HKCU\Software\<manufacturer>\<product>, its
# install folder, unless "Delete application data" is ticked, and Tauri's MSI
# reads that key for its own INSTALLDIR (main.wxs, PrevInstallDirNoName), so
# after the NSIS round it would install into %LOCALAPPDATA%. A fresh machine
# has no such key.
$nsisKey = 'HKCU:\Software\glasshouse\glasshouse'
if (Test-Path $nsisKey) {
  Write-Host "NSIS left $nsisKey ($((Get-Item $nsisKey).GetValue(''))); removing it"
  Remove-Item -Path $nsisKey -Recurse -Force
}
$msi = (Get-ChildItem "$bundle\msi\*.msi" | Select-Object -First 1).FullName
Test-Round 'MSI' `
  { Invoke-Checked 'msiexec.exe' @('/i', "`"$msi`"", '/qn', '/l*v', "`"$log\msi-install.log`"") } `
  (Join-Path $env:ProgramFiles 'glasshouse\glasshouse.exe') `
  { Invoke-Checked 'msiexec.exe' @('/x', "`"$msi`"", '/qn', '/l*v', "`"$log\msi-uninstall.log`"") }
