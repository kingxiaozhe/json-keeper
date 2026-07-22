#!/usr/bin/env bash
# Build the Chrome Web Store upload ZIP from an allowlist derived from manifest.json.
set -euo pipefail
cd "$(dirname "$0")"

version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
out="${1:-release-artifacts/json-keeper-${version}.zip}"
mkdir -p "$(dirname "$out")"

files=$(python3 - <<'PY'
import json
import pathlib
import re

manifest = json.loads(pathlib.Path("manifest.json").read_text())
needed = {"manifest.json"}

for script in manifest.get("content_scripts", []):
    needed.update(script.get("js", []))
    needed.update(script.get("css", []))

action = manifest.get("action", {})
if action.get("default_popup"):
    needed.add(action["default_popup"])

needed.update(manifest.get("icons", {}).values())

for page in [action.get("default_popup"), "viewer.html"]:
    if not page:
        continue
    path = pathlib.Path(page)
    if not path.exists():
        continue
    needed.add(page)
    needed.update(re.findall(r'(?:src|href)="([^"?#]+\.(?:js|css))"', path.read_text()))

missing = sorted(name for name in needed if not pathlib.Path(name).is_file())
if missing:
    raise SystemExit("manifest/page references missing files: " + ", ".join(missing))

print("\n".join(sorted(needed)))
PY
)

rm -f "$out"
# shellcheck disable=SC2086
echo "$files" | zip -q "$out" -@

if unzip -Z1 "$out" | grep -qE '(^|/)(test|tests|docs|store-assets|release-artifacts|\.git|\.github)(/|$)|\.pem$|\.map$'; then
  echo "REFUSING: package contains files that must not ship" >&2
  unzip -Z1 "$out" | grep -E '(^|/)(test|tests|docs|store-assets|release-artifacts|\.git|\.github)(/|$)|\.pem$|\.map$' >&2
  rm -f "$out"
  exit 1
fi

count=$(echo "$files" | wc -l | tr -d ' ')
size=$(du -h "$out" | cut -f1)
echo "packed ${count} files -> ${out} (${size})"
unzip -tq "$out"
