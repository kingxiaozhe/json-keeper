// search.js — highlight + count + jump. Split out of core.js; loaded after util.js.
//
// ⇅ Sort throws the whole tree away and builds a new one, which strands two things: the tree
// reference (solved by asking ctx.getTree() each time) and `matches`, an array of rows from
// the discarded tree. A stale `matches` is worse than it sounds — the counter keeps claiming
// "1/1", jk-current lands on a detached row, and offsetTop of a detached node is 0, so Enter
// throws the page to the top with nothing highlighted. Hence reset(), which core must call
// whenever it rebuilds.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});

  function mount(rootEl, ctx) {
    const $ = (s) => rootEl.querySelector(s);
    const input = $(".jk-search input"), findN = $("[data-find]");
    const prevB = $("[data-find-prev]"), nextB = $("[data-find-next]");
    const scrollEl = ctx.scrollEl;

    let matches = [], cur = -1;
    const showFind = (on) => [findN, prevB, nextB].forEach((el) => (el.hidden = !on));

    // A bar above the tree for the one case dimming can't express. Lives in the scroll container
    // rather than the tree, so rebuilding the tree (⇅ Sort) doesn't take it with it.
    const noHits = document.createElement("div");
    noHits.className = "jk-nohits";
    noHits.hidden = true;
    scrollEl.insertBefore(noHits, scrollEl.firstChild);
    let lastQ = "";
    const sayNoHits = (q) => {
      lastQ = q;
      noHits.hidden = !q;
      // textContent: q is what the user typed, and there's no reason for this to parse markup.
      if (q) noHits.textContent = 'No match for "' + q + '"';
    };
    // The bar sits in the scroll container, which also holds the Raw pane — so switching to Raw
    // left "No match" hanging over the source text. It's a statement about the tree, and Raw
    // isn't showing the tree (searching from Raw pulls you back to Pretty anyway).
    const showBarFor = (view) => { noHits.hidden = !(lastQ && view === "pretty"); };

    function goto(i) {
      if (!matches.length) return;
      cur = (i + matches.length) % matches.length;
      matches.forEach((r) => r.classList.remove("jk-current"));
      const r = matches[cur];
      r.classList.add("jk-current");
      scrollEl.scrollTop = r.offsetTop - scrollEl.clientHeight / 2;
      findN.textContent = cur + 1 + "/" + matches.length;
    }

    function reset() {
      matches = [];
      cur = -1;
      showFind(false);
      sayNoHits("");   // ⇅ Sort rebuilds the tree; a bar about the old one has nothing to say
      input.value = "";
    }

    function run(q) {
      ctx.renderTree();    // a hit inside a tree that was never built cannot be found
      ctx.ensurePretty();
      const tree = ctx.getTree();
      if (!tree) return;
      tree.rows.forEach((r) => r.classList.remove("jk-dim", "jk-current"));
      if (!q) { matches = []; cur = -1; showFind(false); sayNoHits(""); return; }
      // Expanding everything is what makes a hit reachable, but it leaves the Collapse all
      // button believing the tree is still collapsed — so tell the toolbar the truth.
      tree.expandAll();
      ctx.onExpandAll();
      matches = tree.rows.filter((r) => r.textContent.toLowerCase().includes(q));
      showFind(true);
      cur = -1;

      if (!matches.length) {
        // Dimming every row for zero hits made the whole document 26% opaque with a lone "0" in
        // the toolbar — indistinguishable from the viewer having broken. Nothing was found, so
        // nothing gets de-emphasised; the bar says so in words.
        sayNoHits(q);
        // "0/0", not "0": every other state reads "n/m", and a lone "0" in that slot is the
        // toolbar half-answering. Leaving the previous "1/1" standing would be worse still.
        findN.textContent = "0/0";
        return;
      }

      sayNoHits("");
      const hit = new Set(matches);
      tree.rows.forEach((r) => { if (!hit.has(r)) r.classList.add("jk-dim"); });
      findN.textContent = "1/" + matches.length;
      goto(0);
    }

    input.addEventListener("input", (e) => run(e.target.value.trim().toLowerCase()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); goto(cur + (e.shiftKey ? -1 : 1)); }
    });
    nextB.addEventListener("click", () => goto(cur + 1));
    prevB.addEventListener("click", () => goto(cur - 1));
    rootEl.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    });

    return { run, reset, onViewChange: showBarFor, next: () => goto(cur + 1), prev: () => goto(cur - 1), input };
  }

  JK.search = { mount };
})(typeof window !== "undefined" ? window : globalThis);
