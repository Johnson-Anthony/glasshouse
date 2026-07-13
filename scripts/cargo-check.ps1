$env:Path = $env:USERPROFILE + '\.cargo\bin;' + $env:Path
Set-Location "$env:USERPROFILE\glasshouse\src-tauri"
cargo check 2>&1
Write-Host "EXIT: $LASTEXITCODE"
