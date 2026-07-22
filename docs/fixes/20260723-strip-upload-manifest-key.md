# Strip the development key from the Web Store upload manifest

## Status

Fixed and independently approved; awaiting upload retry.

## Symptom

Chrome Web Store rejected `json-keeper-0.19.0.zip` during upload with:

> 清单中“key”字段的值与当前内容不符。

The package was not accepted and did not enter review.

## Reproduction

1. Build the release with `./pack.sh`.
2. Inspect the packaged manifest with `unzip -p release-artifacts/json-keeper-0.19.0.zip manifest.json`.
3. Before the fix, the upload manifest contained the source manifest's `key`.

Red regression output:

```text
62 passed, 0 failed
58 passed, 0 failed
43 passed, 0 failed
14 passed, 0 failed
32 passed, 0 failed
upload manifest must not contain source-only key (got: true)
```

The strengthened determinism check also failed before the second-round fix:

```text
repeat builds must be deterministic: fde84bad4b65f4986cb51facf0e1480aba37cb4fb32c709ab6a87bc28b9d9e38 != b5d83b35e26962e707e80e678db908fb33bb83bb2098808f94463ea245ac2d4f
```

The retained v0.16 upload artifact has no `key`, and the pre-release documentation at `7cc059c` explicitly described stripping it.

## Root cause

The new allowlist packer copied `manifest.json` byte-for-byte. The source `key` exists to keep the unpacked development ID stable, but it does not match the existing Chrome Web Store item's identity. Chrome documents the field as a development-ID mechanism: <https://developer.chrome.com/docs/extensions/reference/manifest/key>.

## Fix

`pack.sh` now writes a temporary manifest, removes only `key`, aligns its timestamp with the source manifest, and builds a metadata-stripped ZIP in a temporary directory beside the target. It validates the complete temporary archive before atomically replacing the last known-good artifact. The repository's source manifest remains unchanged so local development keeps its stable ID.

Rejected alternative: delete `key` from the source manifest. That would also avoid the upload error, but would unnecessarily change the unpacked development ID and weaken the existing upgrade smoke workflow.

## Impact and regression coverage

- Packaging: upload manifest has no `key`; all other manifest values and the exact 14-file allowlist are retained byte-for-byte.
- Determinism: repeat builds from the same source produce the same SHA-256.
- Failure handling: a simulated second-stage ZIP failure leaves the last known-good canonical artifact untouched.
- Development: source manifest still contains its existing public key.
- Runtime: no extension JavaScript, permissions, host permissions, or storage keys changed.
- Regression test: `test/pack.test.sh`, included in `npm test`, locks both sides of the key contract, the exact archive entries, byte equality for runtime files, repeat-build determinism, and atomic failure behavior.
- Baseline: 209 existing assertions passed before the regression test was added.
- Fixed suite: 209 existing assertions plus the packaging regression passed.
- New artifact SHA-256: `877ab93237904bf8a330d3b40d646162f9fa3d61554160dc9980f5d1a831c0f6` (identical across two builds three seconds apart).

## Review

Independent review completed in two rounds:

- Round 1 requested changes for atomic failure handling, deterministic ZIP metadata, and complete package-contract assertions.
- Round 2 reported zero findings and approved the fix.

Evidence:

- `docs/fixes/.reviews/fix-strip-upload-manifest-key-r1.md`
- `docs/fixes/.reviews/fix-strip-upload-manifest-key-r2.md`

Final sanitized-ZIP Chrome smoke passed: manifest `key` absent, v0.19.0 enabled, valid JSON rendered, exact big integers counted, duplicate-key warning shown, and Copy JSON present.
