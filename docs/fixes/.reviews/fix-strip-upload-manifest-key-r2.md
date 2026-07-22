---
at: 2026-07-23T01:33:21+08:00
reviewer: codex-subagent
independent: true
task: fix-strip-upload-manifest-key
round: 2
scope:
  - pack.sh
  - package.json
  - test/pack.test.sh
  - README.md
  - STORE_LISTING.md
  - RELEASES.md
  - docs/fixes/20260723-strip-upload-manifest-key.md
---

# Result

Zero findings.

The four accepted issues are closed:

- The archive is built beside the target, validated, then atomically moved; an injected second-stage ZIP failure leaves the canonical good artifact unchanged.
- `touch -r` and `zip -X` make delayed repeat builds stable at SHA-256 `877ab93237904bf8a330d3b40d646162f9fa3d61554160dc9980f5d1a831c0f6`.
- The test asserts upload manifest equals source minus only `key`, the exact 14 unique entries, and byte equality for the 13 non-manifest runtime files.
- `bash -n`, `npm test`, the release record, and the current artifact all agree.

Residual external risk is limited to the human-authorized Chrome Web Store retry result.

**Verdict: approved**
