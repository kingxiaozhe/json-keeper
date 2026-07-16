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
      input.value = "";
    }

    function run(q) {
      ctx.renderTree();    // a hit inside a tree that was never built cannot be found
      ctx.ensurePretty();
      const tree = ctx.getTree();
      if (!tree) return;
      tree.rows.forEach((r) => r.classList.remove("jk-dim", "jk-current"));
      if (!q) { matches = []; cur = -1; showFind(false); return; }
      // Expanding everything is what makes a hit reachable, but it leaves the Collapse all
      // button believing the tree is still collapsed — so tell the toolbar the truth.
      tree.expandAll();
      ctx.onExpandAll();
      matches = tree.rows.filter((r) => r.textContent.toLowerCase().includes(q));
      const hit = new Set(matches);
      tree.rows.forEach((r) => { if (!hit.has(r)) r.classList.add("jk-dim"); });
      showFind(true);
      findN.textContent = matches.length ? "1/" + matches.length : "0";
      cur = -1;
      if (matches.length) goto(0);
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

    return { run, reset, next: () => goto(cur + 1), prev: () => goto(cur - 1), input };
  }

  JK.search = { mount };
})(typeof window !== "undefined" ? window : globalThis);
