Get-Process | Where-Object { $_.ProcessName -match 'glasshouse|tauri' } | Select-Object ProcessName, Id, Path
