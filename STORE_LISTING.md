# Chrome Web Store listing — JSON Keeper

复制到 Developer Dashboard 对应字段。

## Summary (≤132 chars)
```
View, format and copy JSON — obvious paste box, one-click valid-JSON copy, and big integers that never lose precision.
```

## Detailed description (≤16,000)
```
JSON Keeper turns any JSON — a URL, a local file, or text you paste — into a clean, collapsible, syntax-highlighted view. It keeps the exact source available in Raw view and gives you valid JSON back without losing large-integer digits.

WHY IT'S DIFFERENT
• Big integers stay exact. Most viewers run JSON through the browser's number parser, silently rounding large IDs (e.g. 136986234663732436 → ...430). JSON Keeper preserves every digit — in the tree and when you copy.
• Copy is a first-class, visible button. Get valid, properly-quoted JSON in one click — plus per-node "copy value", "copy subtree" and "copy path" (like customer.email) on hover.
• An obvious entry point. Click the icon and paste — or just open any .json URL and it formats automatically.

FEATURES
• Side-by-side workbench: edit or paste source on the left and inspect the formatted result on the right
• Editor-grade find with key/value scope, real substring highlights, automatic ancestor expansion, and a matches-only mode that preserves context
• Collapsible tree with line numbers, node counts, structure navigation, breadcrumbs, and one-click depth controls
• Inline expansion of JSON embedded inside strings, clickable http/https links, timestamp hints, and digit-group tooltips
• Correctness diagnostics for duplicate keys, exact big integers, numeric overflow, and floating-point precision loss
• Pretty / Raw / Minified views; copy valid JSON, download .json, or export a top-level array as CSV
• Light / dark / auto themes and color skins, remembered locally
• Handles real-world quirks: XSSI prefixes, JSONP wrappers, JSONC comments, and trailing commas
• Large documents are guarded by byte and node-count limits before an expensive DOM tree is built

PRIVACY
No accounts, no tracking, no ads, no telemetry. JSON Keeper makes no network requests — everything runs locally. Your settings are stored on your device only. See the privacy policy linked below.

NOTES
• To view local files (file://), enable "Allow access to file URLs" for JSON Keeper in chrome://extensions.
• Chrome only.
```

## Category
Developer Tools (or "Tools")

## Single purpose
```
Work with the JSON document the user opens or pastes: JSON Keeper formats, searches, diagnoses, copies, downloads, and exports that document locally. Every feature serves inspection or transformation of that one JSON document.
```

## Permission justifications
- **storage**:
```
Used to remember the user's theme, color skin, view, and key-sorting preferences locally, and to briefly hand pasted text from the popup to the viewer tab. The temporary text is deleted after the viewer reads it. Stored on-device only; never transmitted.
```
- **host permissions (http / https / file)**:
```
JSON Keeper auto-detects and formats a JSON document on whatever page the user opens, so it must be able to run on any URL (including local files). It only reads the page's text to render JSON; it does not read cookies, history, or other site data, makes no network requests, and transmits nothing.
```

## Remote code
**No, I am not using remote code.** All code is bundled in the package; no external `<script>`, no `eval`, no network requests.

## Data usage (dashboard checkboxes)
- Data collected: **none** — leave every box unchecked (preferences are local-only and never transmitted).
- Check all three compliance declarations (no selling/transfer beyond approved use; no unrelated use; not for creditworthiness/lending).

## Privacy policy URL
```
https://kingxiaozhe.github.io/json-keeper/privacy.html
```

## Optional
- Homepage URL: the GitHub repo
- Support URL: the repo's /issues page

## Screenshots (store-assets/, 1280×800 JPEG, no alpha)
- Upload `shot-v019-dark-workbench.jpg`, `shot-v019-light-find.jpg`, and `shot-v019-dark-raw.jpg`.
- Existing `shot-0..3` images show the v0.16-and-earlier layout. Do not upload them for v0.19.
- The v0.19 screenshots were captured at 1280×800 from the same unpacked package used for the final Chrome smoke.

## Build the upload zip
```
./pack.sh
```
The allowlist build excludes tests, docs, store assets, release artifacts, source maps, and signing keys, and removes the source-only development `key` from the upload manifest. Only the user can authorize upload and click "Submit for review".
