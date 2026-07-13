$env:Path = 'C:\nodejs;' + $env:USERPROFILE + '\.cargo\bin;' + $env:Path
Set-Location "$env:USERPROFILE\glasshouse"
pnpm exec tsc -b
if ($LASTEXITCODE -ne 0) { Write-Host "=== tsc FAILED: $LASTEXITCODE ==="; exit $LASTEXITCODE }
Write-Host "=== tsc ok, starting tauri build ==="
pnpm tauri build 2>&1 | Select-Object -Last 30
if ($LASTEXITCODE -ne 0) { Write-Host "=== BUILD FAILED: $LASTEXITCODE ==="; exit $LASTEXITCODE }
Write-Host "=== exit: $LASTEXITCODE ==="
