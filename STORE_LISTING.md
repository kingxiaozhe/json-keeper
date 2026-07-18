# Chrome Web Store listing — JSON Keeper

复制到 Developer Dashboard 对应字段。

## Summary (≤132 chars)
```
View, format and copy JSON — obvious paste box, one-click valid-JSON copy, and big integers that never lose precision.
```

## Detailed description (≤16,000)
```
JSON Keeper turns any JSON — a URL, a local file, or text you paste — into a clean, collapsible, syntax-highlighted view, and gives you back exactly the JSON you started with.

WHY IT'S DIFFERENT
• Big integers stay exact. Most viewers run JSON through the browser's number parser, silently rounding large IDs (e.g. 136986234663732436 → ...430). JSON Keeper preserves every digit — in the tree and when you copy.
• Copy is a first-class, visible button. Get valid, properly-quoted JSON in one click — plus per-node "copy value", "copy subtree" and "copy path" (like customer.email) on hover.
• An obvious entry point. Click the icon and paste — or just open any .json URL and it formats automatically.

FEATURES
• Collapsible tree with line numbers, node counts, and a structure outline to jump around large documents
• Fast search with match count, next/previous, and auto-expand of matches
• JSONPath query bar — filter to just the fields you want (e.g. $.users[*].email), with a live match count
• Table view for arrays of objects — and a missing field is drawn distinctly from a null value, so you don't misread the response
• Export an inferred JSON Schema (Draft 2020-12) and TypeScript types — with every guessed type flagged honestly (empty arrays as unknown[], big integers as bigint), so you don't inherit a wrong assumption
• Validate the document against a JSON Schema you paste, with each error pinpointed on the tree
• Highlights duplicate keys (which the JSON spec silently drops) and counts exact big integers
• Pretty / Raw (exact source) / Minified views; download as .json
• Light / dark / auto theme, remembered
• Handles real-world quirks: strips XSSI guard prefixes ()]}') and unwraps JSONP (callback({...})), and tolerates JSONC comments and trailing commas
• Large files stay responsive (the tree is built on demand)

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
Work with the JSON document you're viewing: when you open or paste JSON, JSON Keeper renders it as a readable, collapsible, syntax-highlighted tree and lets you copy it back as valid JSON, filter it, view arrays as a table, and derive or check its schema. Every feature operates on that one document — it does nothing else.
```

## Permission justifications
- **storage**:
```
Used to remember the user's theme and view preferences locally, and to briefly hand pasted text from the popup to the viewer tab. Stored on-device only; never transmitted.
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
https://<gh-user>.github.io/json-keeper/privacy.html   (host docs/privacy.html via GitHub Pages — see note below)
```

## Optional
- Homepage URL: the GitHub repo
- Support URL: the repo's /issues page

## Screenshots (store-assets/, 1280×800 JPEG, no alpha)
- shot-0-hero.jpg · shot-1-viewer-dark.jpg · shot-2-viewer-light.jpg · shot-3-paste.jpg
(lead with the hero or the dark viewer)

## Build the upload zip
```
node src/build-zip.mjs extensions/json-keeper   # strips manifest "key"; excludes docs/, store-assets/, README, *.pem
```
(Only the user can upload + click "Submit for review". Privacy policy must be hosted at a public URL first.)
