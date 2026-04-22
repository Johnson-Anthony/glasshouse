#!/usr/bin/env bash
# Bootstrap Windows-side toolchain (Rust, Node LTS, pnpm, Tauri CLI).
# Safe to re-run; winget skips installed packages.
set -euo pipefail

powershell.exe -NoProfile -NoLogo -Command "
  Write-Host '=== winget: Rustup ==='
  winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Null
  Write-Host '=== winget: Node.js LTS ==='
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Null
  Write-Host '=== corepack / pnpm ==='
  corepack enable
  corepack prepare pnpm@9.14.2 --activate
  Write-Host '=== rustup stable-msvc ==='
  rustup default stable-msvc
  Write-Host '=== versions ==='
  rustc --version
  cargo --version
  node --version
  pnpm --version
"
