// status.js — the bottom bar. Split out of core.js; loaded after util.js.
//
// This is where two of the three trust signals live: the duplicate-key warning and the
// standing "big integers kept exact · no ads · no telemetry". (The third, the big-int chip,
// is in the toolbar — check core.js before moving one to sit next to the other.)
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { esc } = JK.util;

  const TRUST = '<span class="jk-trust">big integers kept exact · no ads · no telemetry</span>';

  // A duplicated key means the JSON spec quietly threw values away. Every other viewer lets
  // that pass; saying so is the product.
  function warnHTML(dupes) {
    if (!dupes || !dupes.length) return "";
    return '<span class="jk-warn" title="JSON spec keeps only the last value of a duplicated key; other viewers drop the rest silently">⚠ ' +
      dupes.length + " duplicate key" + (dupes.length > 1 ? "s" : "") + ": " +
      dupes.slice(0, 4).map((k) => '"' + esc(k) + '"').join(", ") + (dupes.length > 4 ? "…" : "") + " — last value shown</span>";
  }

  function mount(statusEl, ctx) {
    const seg = (n, label) => (n ? '<span class="jk-st"><b>' + n + "</b> " + label + "</span>" : "");

    // "tree built on demand" states a policy but offers no demand to make. The Pretty tab does
    // build it, but nothing connects the sentence to the tab — so the line reads as a dead end.
    statusEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-build]") && ctx && ctx.onBuild) ctx.onBuild();
    });

    // state: { dupes[], nodes, counts, heavy, size, treeBuilt }
    // `size` is not optional — the large-file line leads with it ("1.2 MB — large file…").
    function render(state) {
      const s = state || {};
      const head = '<span class="jk-ok">● valid JSON</span>' + warnHTML(s.dupes);
      const tail = '<span class="jk-spacer"></span>' + TRUST;

      // No tree yet: Raw and Min never build one, and large files open without it. The node
      // counts are the *only* thing that needs a tree — "valid JSON", the duplicate-key warning
      // and the promises are true either way, and AC-008 says they are on screen in every state.
      // This branch used to render "" for anything that wasn't a large file, so anyone who had
      // clicked Raw once (jk:view persists across sessions) got an empty bar for every JSON
      // afterwards: no validity, no duplicate-key warning — the one thing this product is for —
      // and none of the promises the store listing makes. Shipped that way since v0.8.0.
      if (!s.treeBuilt) {
        statusEl.innerHTML = head + '<span class="jk-st">' + s.size +
          (s.heavy ? " — large file, tree built on demand</span>" +
            '<button class="jk-build" data-build>Build tree</button>' : "</span>") + tail;
        return;
      }
      const c = s.counts || {};
      statusEl.innerHTML = head + '<span class="jk-st">' + s.nodes + " nodes</span>" +
        seg(c.object, "obj") + seg(c.array, "arr") + seg(c.string, "str") +
        seg(c.number, "num") + seg(c.boolean, "bool") + seg(c.null, "null") + tail;
    }

    return { render };
  }

  JK.status = { mount, warnHTML };
})(typeof window !== "undefined" ? window : globalThis);
