#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'find "$tmp" -type f -delete; find "$tmp" -depth -type d -exec rmdir {} \;' EXIT

./pack.sh "$tmp/first.zip" >/dev/null
sleep 3
./pack.sh "$tmp/second.zip" >/dev/null

# A failed build must not replace the last known-good canonical artifact. The
# wrapper lets the manifest zip step succeed, then fails the runtime-file step.
mkdir "$tmp/fail-bin"
real_zip=$(command -v zip)
cat >"$tmp/fail-bin/zip" <<'SH'
#!/usr/bin/env bash
if [ -f "$ZIP_FAIL_STATE" ]; then
  exit 12
fi
: >"$ZIP_FAIL_STATE"
exec "$ZIP_REAL" "$@"
SH
chmod +x "$tmp/fail-bin/zip"
cp "$tmp/first.zip" "$tmp/canonical.zip"
if PATH="$tmp/fail-bin:$PATH" ZIP_REAL="$real_zip" ZIP_FAIL_STATE="$tmp/zip-state" ./pack.sh "$tmp/canonical.zip" >/dev/null 2>&1; then
  echo "simulated second-stage zip failure unexpectedly succeeded" >&2
  exit 1
fi
if ! cmp -s "$tmp/first.zip" "$tmp/canonical.zip"; then
  echo "failed build replaced the last known-good artifact" >&2
  exit 1
fi

python3 - "$tmp/first.zip" "$tmp/second.zip" <<'PY'
import hashlib
import json
import pathlib
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as package:
    names = package.namelist()
    upload_manifest = json.loads(package.read("manifest.json"))

with open("manifest.json") as source:
    source_manifest = json.load(source)

if "key" not in source_manifest:
    raise SystemExit("source manifest must retain the development key")

expected_manifest = dict(source_manifest)
expected_manifest.pop("key")
if upload_manifest != expected_manifest:
    raise SystemExit("upload manifest must equal the source manifest minus only key")

expected_names = {
    "manifest.json", "content.js", "core.js", "jk-util.js", "jsonbig.js",
    "popup.html", "popup.js", "viewer.css", "viewer.html", "viewer.js",
    "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png",
    "icons/icon-128.png",
}
if len(names) != len(set(names)) or set(names) != expected_names:
    raise SystemExit(f"upload entries differ: got {sorted(names)}")

with zipfile.ZipFile(sys.argv[1]) as package:
    for name in expected_names - {"manifest.json"}:
        if package.read(name) != pathlib.Path(name).read_bytes():
            raise SystemExit(f"packaged file differs from source: {name}")

first_hash = hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()
second_hash = hashlib.sha256(pathlib.Path(sys.argv[2]).read_bytes()).hexdigest()
if first_hash != second_hash:
    raise SystemExit(f"repeat builds must be deterministic: {first_hash} != {second_hash}")

print("packaging regression passed: key stripped only, 14 files exact, repeat hash stable")
PY
