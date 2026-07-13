#!/usr/bin/env bash
# Launch `pnpm tauri dev` on the Windows host from WSL.
# The Windows-side source tree defaults to %USERPROFILE%\glasshouse;
# override with GLASSHOUSE_WIN_DIR.
set -euo pipefail

if [ -n "${GLASSHOUSE_WIN_DIR:-}" ]; then
  WIN_DIR="$GLASSHOUSE_WIN_DIR"
else
  PROFILE="$(powershell.exe -NoProfile -Command 'Write-Host -NoNewline $env:USERPROFILE' | tr -d '\r')"
  WIN_DIR="${PROFILE}\\glasshouse"
fi
powershell.exe -NoProfile -NoLogo -Command "Set-Location '$WIN_DIR'; pnpm tauri dev"
