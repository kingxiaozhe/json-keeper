#!/usr/bin/env bash
# Build the Web Store zip.
#
# Allowlist, not exclusions. The old `zip -r . -x '.git/*' '.claude/*' …` shipped whatever it
# hadn't been told to leave out — so once tests/ and specs/ existed, the package carried the PRD,
# the design mockups, LESSONS.md, METRICS.md and the whole suite: 74 files, 304K, all of it
# readable by anyone who unzips a published extension. Every new directory broke it again.
#
# The file list is derived from the manifest, so it can't drift from what actually loads.
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-json-keeper.zip}"

# Everything the extension loads, straight from the manifest plus the two extension pages.
files=$(python3 - <<'PY'
import json, pathlib, re
m = json.loads(pathlib.Path("manifest.json").read_text())
need = {"manifest.json"}
cs = m["content_scripts"][0]
need |= set(cs["js"]) | set(cs.get("css", []))
need.add(m["action"]["default_popup"])
need |= set(m["icons"].values())
for page in ["popup.html", "viewer.html"]:
    if pathlib.Path(page).exists():
        need.add(page)
        need |= set(re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', pathlib.Path(page).read_text()))
need.add("viewer.js")  # loaded by viewer.html; kept explicit in case that link is ever inlined
missing = [f for f in need if not pathlib.Path(f).exists()]
if missing:
    raise SystemExit("manifest references files that don't exist: " + ", ".join(sorted(missing)))
print("\n".join(sorted(need)))
PY
)

rm -f "$OUT"
# shellcheck disable=SC2086
echo "$files" | zip -q "$OUT" -@

echo "packed $(echo "$files" | wc -l | tr -d ' ') files -> $OUT ($(du -h "$OUT" | cut -f1))"

# A signing key inside the package would let anyone publish an update as us. It can't get in via
# the allowlist, but the check costs nothing and the consequence doesn't.
if unzip -l "$OUT" | grep -qE '\.pem|tests/|specs/|\.claude/'; then
  echo "REFUSING: package contains files that must never ship" >&2
  unzip -l "$OUT" | grep -E '\.pem|tests/|specs/|\.claude/' >&2
  rm -f "$OUT"
  exit 1
fi
