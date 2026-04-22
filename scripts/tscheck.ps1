$env:Path = 'C:\nodejs;' + $env:Path
Set-Location 'C:\Users\ajohn\glasshouse'
pnpm exec tsc --noEmit
