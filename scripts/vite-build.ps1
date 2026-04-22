$env:Path = 'C:\nodejs;' + $env:Path
Set-Location 'C:\Users\ajohn\glasshouse'
pnpm exec vite build 2>&1 | Out-String
Write-Host "=== EXIT: $LASTEXITCODE ==="
