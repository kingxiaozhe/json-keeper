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

  function mount(statusEl) {
    const seg = (n, label) => (n ? '<span class="jk-st"><b>' + n + "</b> " + label + "</span>" : "");

    // state: { dupes[], nodes, counts, heavy, size, treeBuilt }
    // `size` is not optional — the large-file line leads with it ("1.2 MB — large file…").
    function render(state) {
      const s = state || {};
      const head = '<span class="jk-ok">● valid JSON</span>' + warnHTML(s.dupes);
      if (!s.treeBuilt) {
        statusEl.innerHTML = s.heavy
          ? head + '<span class="jk-st">' + s.size + ' — large file, tree built on demand</span><span class="jk-spacer"></span>' + TRUST
          : "";
        return;
      }
      const c = s.counts || {};
      statusEl.innerHTML = head + '<span class="jk-st">' + s.nodes + " nodes</span>" +
        seg(c.object, "obj") + seg(c.array, "arr") + seg(c.string, "str") +
        seg(c.number, "num") + seg(c.boolean, "bool") + seg(c.null, "null") +
        '<span class="jk-spacer"></span>' + TRUST;
    }

    return { render };
  }

  JK.status = { mount, warnHTML };
})(typeof window !== "undefined" ? window : globalThis);
