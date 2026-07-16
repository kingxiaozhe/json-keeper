// rail.js — the left STRUCTURE outline. Split out of core.js; loaded after util.js.
//
// Two separate jobs that look like one: jumping to a top-level block, and highlighting
// whichever block you have scrolled to. Both read offsetTop today, which works only because
// top-level rows are never hidden — a caveat worth keeping in view when virtual scrolling
// lands, since detached rows report offsetTop 0 and would peg the highlight to the last item.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { esc } = JK.util;

  // Flat JSON gets no rail: an outline of three or fewer scalars is noise, not navigation.
  const shouldShow = (topLevel) => topLevel.some((t) => !t.leaf) && topLevel.length >= 3;

  function mount(railEl, ctx) {
    const scrollEl = ctx.scrollEl;
    let items = [];

    function render(topLevel) {
      if (!shouldShow(topLevel)) { railEl.hidden = true; railEl.innerHTML = ""; items = []; return false; }
      items = topLevel;
      railEl.hidden = false;
      railEl.innerHTML = '<div class="jk-rail-h">STRUCTURE</div>' + topLevel.map((t, i) =>
        '<button class="jk-rail-i" data-i="' + i + '"><span class="jk-rail-k">' + esc(String(t.key)) + "</span>" +
        (t.leaf ? "" : '<span class="jk-rail-n">' + t.n + "</span>") + "</button>").join("");
      railEl.querySelectorAll(".jk-rail-i").forEach((b) => b.addEventListener("click", () => {
        // Goes through core's jumpTo rather than scrolling here. One implementation instead of
        // two, and it fixes the outline being clickable in Raw view while doing nothing visible
        // — the rail stays on screen there, but the rows it scrolled to were hidden.
        ctx.jumpTo(items[+b.dataset.i].apath, { align: "top" });
      }));
      return true;
    }

    let raf = 0;
    scrollEl.addEventListener("scroll", () => {
      if (raf || !items.length) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = scrollEl.scrollTop + 12;
        let active = 0;
        items.forEach((t, i) => { if (t.head.offsetTop <= y) active = i; });
        railEl.querySelectorAll(".jk-rail-i").forEach((x, i) => x.classList.toggle("on", i === active));
      });
    });

    return { render, shouldShow };
  }

  JK.rail = { mount, shouldShow };
})(typeof window !== "undefined" ? window : globalThis);
