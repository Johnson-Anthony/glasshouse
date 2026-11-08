#!/bin/sh
# Rebuild the demo's woff2 font subsets (site/demo/fonts) from the app's Nerd
# Font TTFs, keeping Latin, the symbol blocks the UI and the demo shell draw,
# and every non-ASCII character used in src/ and site/. Needs uv (uvx).
set -e
cd "$(dirname "$0")/.."
unicodes=$(python3 - <<'PY'
import pathlib
cps = set(range(0x20, 0x7f)) | set(range(0xa0, 0x100))
for a, b in [(0x2010, 0x2027), (0x2030, 0x205e), (0x2190, 0x21ff), (0x2300, 0x23ff),
             (0x2500, 0x259f), (0x25a0, 0x25ff), (0x2600, 0x26ff), (0x2700, 0x27bf)]:
    cps |= set(range(a, b + 1))
for root in ["src", "site"]:
    for p in pathlib.Path(root).rglob("*"):
        if p.suffix in {".ts", ".tsx", ".css", ".html"}:
            cps |= {ord(c) for c in p.read_text(encoding="utf-8", errors="ignore") if ord(c) > 0x7e}
print(",".join(f"U+{c:04X}" for c in sorted(cps)))
PY
)
mkdir -p site/demo/fonts
for v in Regular Bold Italic BoldItalic; do
  uvx --from fonttools --with brotli pyftsubset "src/assets/fonts/JetBrainsMonoNerdFont-$v.ttf" \
    --unicodes="$unicodes" --flavor=woff2 --layout-features='*' \
    --output-file="site/demo/fonts/JetBrainsMonoNerdFont-$v.woff2"
done
ls -l site/demo/fonts
