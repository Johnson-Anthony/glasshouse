$env:Path = 'C:\nodejs;' + $env:Path
Set-Location "$env:USERPROFILE\glasshouse"
pnpm exec vite build 2>&1 | Out-String
Write-Host "=== EXIT: $LASTEXITCODE ==="
