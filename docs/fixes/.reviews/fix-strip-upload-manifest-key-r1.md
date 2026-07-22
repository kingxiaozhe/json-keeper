---
at: 2026-07-23T01:28:00+08:00
reviewer: codex-subagent
independent: true
task: fix-strip-upload-manifest-key
round: 1
scope:
  - pack.sh
  - package.json
  - test/pack.test.sh
  - README.md
  - STORE_LISTING.md
  - RELEASES.md
  - docs/fixes/20260723-strip-upload-manifest-key.md
---

# Findings

- **[P2] Failed packaging can leave an incomplete but readable upload ZIP.** `pack.sh` deleted the old artifact and created a manifest-only target before the runtime-file ZIP step. If that second step failed, the canonical path retained the incomplete ZIP. Build and validate at a temporary path, then atomically replace the target.
- **[P2] Repeat builds from identical source produced different SHA-256 values.** The generated manifest carried the current timestamp. Align the timestamp and remove non-deterministic ZIP metadata.
- **[P2] The regression test did not lock the full contract.** It checked only that the upload lacked `key` and the source retained it. It also needs to assert that every other manifest value is unchanged and that the exact 14 allowlisted entries remain present.

Independent verification confirmed the initial key-only regression test passed, but the three failure scenarios above remained possible.

**Verdict: changes_requested**
