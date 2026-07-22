#!/usr/bin/env bash
# Build the Chrome Web Store upload ZIP from an allowlist derived from manifest.json.
set -euo pipefail
cd "$(dirname "$0")"

version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
out="${1:-release-artifacts/json-keeper-${version}.zip}"
mkdir -p "$(dirname "$out")"
tmp=$(mktemp -d "$(dirname "$out")/.json-keeper-pack.XXXXXX")
trap 'find "$tmp" -type f -delete; rmdir "$tmp"' EXIT
archive="$tmp/package.zip"

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

python3 - "$tmp/manifest.json" <<'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path("manifest.json").read_text())
manifest.pop("key", None)  # source-only: pins the unpacked development ID
pathlib.Path(sys.argv[1]).write_text(json.dumps(manifest, indent=2) + "\n")
PY
touch -r manifest.json "$tmp/manifest.json"

# The Web Store owns the published item identity. Include a sanitized manifest
# while leaving the source manifest's development key untouched.
zip -qXj "$archive" "$tmp/manifest.json"
# shellcheck disable=SC2086
echo "$files" | grep -vx 'manifest.json' | zip -qX "$archive" -@

if unzip -Z1 "$archive" | grep -qE '(^|/)(test|tests|docs|store-assets|release-artifacts|\.git|\.github)(/|$)|\.pem$|\.map$'; then
  echo "REFUSING: package contains files that must not ship" >&2
  unzip -Z1 "$archive" | grep -E '(^|/)(test|tests|docs|store-assets|release-artifacts|\.git|\.github)(/|$)|\.pem$|\.map$' >&2
  exit 1
fi

count=$(echo "$files" | wc -l | tr -d ' ')
size=$(du -h "$archive" | cut -f1)
unzip -tq "$archive" >/dev/null
mv -f "$archive" "$out"
echo "packed ${count} files -> ${out} (${size})"
unzip -tq "$out"
