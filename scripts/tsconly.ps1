$env:Path = 'C:\nodejs;' + $env:Path
Set-Location 'C:\Users\ajohn\glasshouse'
pnpm exec tsc -b 2>&1 | Out-String
Write-Host "=== EXIT: $LASTEXITCODE ==="
