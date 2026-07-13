$env:Path = 'C:\nodejs;' + $env:Path
Set-Location "$env:USERPROFILE\glasshouse"
pnpm exec tsc -b 2>&1 | Out-String
Write-Host "=== EXIT: $LASTEXITCODE ==="
