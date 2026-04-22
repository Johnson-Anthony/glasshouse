#!/usr/bin/env bash
# Build the release .exe + .msi on the Windows host from WSL.
set -euo pipefail

WIN_DIR='C:\Users\ajohn\glasshouse'
powershell.exe -NoProfile -NoLogo -Command "Set-Location '$WIN_DIR'; pnpm install --frozen-lockfile; pnpm tauri build"

ART_DIR='/mnt/c/Users/ajohn/glasshouse/src-tauri/target/release'
echo "---"
echo "Release artefacts under $ART_DIR:"
ls -la "$ART_DIR"/*.exe "$ART_DIR/bundle" 2>/dev/null || true
