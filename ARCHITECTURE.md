# Architecture

JSON Keeper is a no-build Manifest V3 Chrome extension. There is no bundler and
no framework: files are plain ES5-ish scripts loaded in order, sharing state
through two globals (`window.JSONBig`, `window.JK`). This is a deliberate choice
— content scripts can't easily use ES module `import`, and the whole extension
is small enough that a build step would cost more than it saves.

## Layers

```
jsonbig.js   ── correctness core: JSON parse/stringify that keeps big integers
                 exact and reports diagnostics. No DOM, no dependencies.
     │  window.JSONBig
     ▼
jk-util.js   ── pure value helpers (no DOM, no shared state): esc/escAttr,
                 linkify, embeddedJSON, groupDigits, epochHint, posToLineCol,
                 countNodes, toCSV. Each independently unit-tested.
     │  window.JKUtil
     ▼
core.js      ── the DOM-coupled rendering engine, exposed as window.JK:
                 • markText/clearMarks, scopedEls, applySearch, applyDepth
                 • buildTree     (value → collapsible DOM tree)
                 • mountViewer   (assembles toolbar + tree + status into a root)
                 (re-exports the JKUtil helpers on JK for callers/tests)
     │  window.JK
     ├───────────────┬───────────────────────────────┐
     ▼               ▼                                 ▼
content.js      viewer.html/js                    popup.html/js
(takeover a     (split-pane paste                 (paste box → stash text →
 JSON page)      workbench)                         open viewer.html)
```

The split between `jk-util.js` and `core.js` is the one place we separate by
seam rather than size: the helpers are genuinely pure and reusable, so they earn
their own file. The DOM engine (`buildTree`/`mountViewer`) is one cohesive unit
and stays together — splitting it would thread shared state across files for no
real gain.

Both entry points render through the **same** `JK.mountViewer`, so the in-page
takeover and the standalone workbench never drift apart. Anything visual or
parsing-related belongs in `core.js`/`jsonbig.js`; an entry point should only do
the work unique to its shell.

- **`content.js`** decides whether a page *is* a JSON document, parses into a
  detached node first, and only replaces the page on success (a bad guess never
  destroys a real HTML page).
- **`viewer.js`** owns only the workbench shell — the left editor, its
  validity/error affordance, auto-format, and the draggable split. It has no
  tree, search, or parsing logic; it calls `JK.mountViewer` for all of that.

## Design rules

- **Purity where possible.** Logic that can be a pure function (escaping,
  detection, CSV, line/col math, search scoping) is one, kept free of DOM/chrome
  APIs, and exported on `JK` so it can be unit-tested under Node.
- **Security.** All user-derived text is escaped before it reaches HTML
  (`esc` for text, `escAttr` for attribute context). `linkify` only ever links
  `http(s)` URLs and attribute-escapes the href. No `eval`, no remote code, no
  network requests.
- **Big integers are exact, always.** Values beyond `Number.MAX_SAFE_INTEGER`
  become `BigInt` and serialize as bare digits — in the tree and on copy.
- **Degrade, don't freeze.** Large files render lazily; a huge *structure*
  (node count over a cap) shows an opt-in guard instead of building a giant DOM.

## Tests

`npm test` runs four zero-dependency Node suites (see `test/`). `test/dom-stub.js`
is a tiny DOM implementation that lets the real `buildTree`/`applySearch`/
highlight code run under Node without a browser. Add a test when you add a helper
or fix a bug; the parser and render path are the product's trust surface.
