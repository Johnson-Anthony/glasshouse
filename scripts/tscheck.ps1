$env:Path = 'C:\nodejs;' + $env:Path
Set-Location "$env:USERPROFILE\glasshouse"
pnpm exec tsc --noEmit
