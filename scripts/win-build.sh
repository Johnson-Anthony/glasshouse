#!/usr/bin/env bash
# Build the release .exe + .msi on the Windows host from WSL.
# The Windows-side source tree defaults to %USERPROFILE%\glasshouse;
# override with GLASSHOUSE_WIN_DIR.
set -euo pipefail

if [ -n "${GLASSHOUSE_WIN_DIR:-}" ]; then
  WIN_DIR="$GLASSHOUSE_WIN_DIR"
else
  PROFILE="$(powershell.exe -NoProfile -Command 'Write-Host -NoNewline $env:USERPROFILE' | tr -d '\r')"
  WIN_DIR="${PROFILE}\\glasshouse"
fi
powershell.exe -NoProfile -NoLogo -Command "Set-Location '$WIN_DIR'; pnpm install --frozen-lockfile; pnpm tauri build"

ART_DIR="$(wslpath "$WIN_DIR")/src-tauri/target/release"
echo "---"
echo "Release artefacts under $ART_DIR:"
ls -la "$ART_DIR"/*.exe "$ART_DIR/bundle" 2>/dev/null || true
