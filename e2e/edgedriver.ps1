# Picks the msedgedriver for the e2e suite on Windows. It must match the
# WebView2 Runtime the app runs on in the first three parts of the version,
# or creating a session hangs. The runner image has a driver for its Edge
# browser ($env:EDGEWEBDRIVER), and the WebView2 Runtime can be on another
# version. Uses that driver when it matches; otherwise downloads the
# matching one from Microsoft. Sets E2E_NATIVE_DRIVER for later steps.
#
#   pwsh ./e2e/edgedriver.ps1 [-OutDir <dir>]
#Requires -Version 7
param([string]$OutDir = (Join-Path ($env:RUNNER_TEMP ?? $env:TEMP) 'edgedriver'))
$ErrorActionPreference = 'Stop'

function Get-Version([string]$Text) {
  if ($Text -match '(\d+\.\d+\.\d+\.\d+)') { return [version]$Matches[1] }
  return $null
}
function Test-SameBuild($A, $B) {
  return $A -and $B -and $A.Major -eq $B.Major -and $A.Minor -eq $B.Minor -and $A.Build -eq $B.Build
}
function Get-DriverVersion([string]$Exe) {
  return Get-Version ((& $Exe --version) | Out-String)
}

# The Evergreen Runtime's version, per machine (both registry views) or per
# user. When there's more than one, take the newest.
$client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$runtime = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client",
  "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$client"
) | ForEach-Object { (Get-ItemProperty -Path $_ -Name pv -ErrorAction SilentlyContinue).pv } |
  Where-Object { $_ -and $_ -ne '0.0.0.0' } |
  ForEach-Object { [version]$_ } |
  Sort-Object -Descending |
  Select-Object -First 1
if (-not $runtime) {
  throw "The WebView2 Runtime isn't installed (no pv under EdgeUpdate\Clients\$client), so the app can't open a window."
}

$driver = $null
$preinstalled = if ($env:EDGEWEBDRIVER) { Join-Path $env:EDGEWEBDRIVER 'msedgedriver.exe' }
$preinstalledVersion = if ($preinstalled -and (Test-Path $preinstalled)) { Get-DriverVersion $preinstalled }
if (Test-SameBuild $runtime $preinstalledVersion) {
  $driver = $preinstalled
  $driverVersion = $preinstalledVersion
} else {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'win64' }
  $url = "https://msedgedriver.microsoft.com/$runtime/edgedriver_$arch.zip"
  Write-Host "The image's msedgedriver is $preinstalledVersion and the WebView2 Runtime is $runtime; downloading $url"
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $zip = Join-Path $OutDir 'edgedriver.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -MaximumRetryCount 3 -RetryIntervalSec 5
  Expand-Archive -Path $zip -DestinationPath $OutDir -Force
  $driver = Join-Path $OutDir 'msedgedriver.exe'
  $signature = Get-AuthenticodeSignature -FilePath $driver
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "$driver isn't signed by Microsoft ($($signature.Status): $($signature.SignerCertificate.Subject))"
  }
  $driverVersion = Get-DriverVersion $driver
  if (-not (Test-SameBuild $runtime $driverVersion)) {
    throw "The downloaded msedgedriver is $driverVersion, not $runtime"
  }
}

$summary = @(
  '## msedgedriver for the WebView2 Runtime',
  "- WebView2 Runtime: $runtime",
  "- The image's msedgedriver: $(if ($preinstalledVersion) { $preinstalledVersion } else { 'none' })",
  "- Using: $driver ($driverVersion)"
)
$summary | ForEach-Object { Write-Host $_ }
if ($env:GITHUB_STEP_SUMMARY) { $summary | Add-Content -Path $env:GITHUB_STEP_SUMMARY }
if ($env:GITHUB_ENV) { Add-Content -Path $env:GITHUB_ENV -Value "E2E_NATIVE_DRIVER=$driver" }
