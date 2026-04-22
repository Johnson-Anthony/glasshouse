#!/usr/bin/env bash
# Launch `pnpm tauri dev` on the Windows host from WSL.
# Source tree lives at C:\Users\ajohn\glasshouse — this script is portable.
set -euo pipefail

WIN_DIR='C:\Users\ajohn\glasshouse'
powershell.exe -NoProfile -NoLogo -Command "Set-Location '$WIN_DIR'; pnpm tauri dev"
