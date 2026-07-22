# Release record

## 2026-07-23 — v0.19 release candidate → local verification

- Version: `0.19.0` from `7cc059c` plus release-preparation changes on `codex/release-0.19.0`
- Channel: local verification; not submitted
- Published baseline: Chrome Web Store `0.16.0` (`a91532a`)
- Permission diff: none (`storage`; `http://*/*`, `https://*/*`, `file:///*` unchanged)
- Storage migration: none; `jk:theme`, `jk:skin`, `jk:view`, `jk:sort`, and `jk:pending` are unchanged
- Automated tests: 209 assertions plus the upload-packaging regression passed, 0 failed
- Browser smoke: passed in an isolated Chrome profile after upgrading the same extension ID from v0.16 to v0.19
  - retained theme, skin, view, and sort preferences across the upgrade
  - verified popup-to-viewer handoff and removal of the temporary `jk:pending` value
  - verified page takeover for a JSON response and no takeover for an ordinary HTML page
  - verified exact big integers, duplicate-key diagnostics, embedded JSON, search/highlight, CSV availability, and Pretty/Raw switching
  - verified the 50,000-node guard and text-only rendering of HTML/script-like JSON content
  - verified manual light/dark theme switching keeps both workbench panes synchronized
- Store materials: listing, privacy policy, and three 1280×800 v0.19 screenshots updated
- Upload validation: the first local artifact was rejected before submission because it retained the source manifest's development `key`; the packer now removes that field only from the upload manifest, matching the published v0.16 package
- Upload artifact: `release-artifacts/json-keeper-0.19.0.zip` (14 allowlisted files; upload manifest has no `key`; deterministic SHA-256 `877ab93237904bf8a330d3b40d646162f9fa3d61554160dc9980f5d1a831c0f6`)
- Corrected-artifact smoke: passed from the sanitized ZIP in a fresh Chrome profile; v0.19.0 enabled and the JSON/big-int/duplicate-key/copy flow rendered correctly
- Fix review: approved with zero findings in round 2; evidence under `docs/fixes/.reviews/`
- Privacy policy deployment: `main` commit `fe90855`; GitHub Pages build `1109315236` completed and the public URL was verified with the 2026-07-23 policy
- Review verdict: ready for human-authorized Chrome Web Store upload and submission
- Store review status: not submitted; initial upload failed package validation and did not enter review
- Rollback plan: retain the published v0.16 CRX under `release-artifacts/0.16.0/`; prefer the Chrome Web Store rollback action to republish the previous package. If rollback is unavailable, rebuild the `a91532a` source with a version greater than the failed release and submit it as an emergency replacement.
