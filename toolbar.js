// toolbar.js — the top bar. Split out of core.js; loaded after util.js.
//
// mount() takes callbacks AND returns setters. The setters are not decoration: the bar shows
// the file size, the node summary, and the big-int chip — data core owns. Without a way in,
// the "✓ N big-ints exact" badge would have no renderer and whoever implemented it would end
// up reaching into this module's DOM from outside, which defeats the split.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});

  const THEMES = ["auto", "light", "dark"];
  const GLYPH = { auto: "◐", light: "☀", dark: "☾" };

  const BAR_HTML =
    '<div class="jk-bar">' +
      '<button class="jk-btn" data-act="copy"><svg class="jk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy JSON</button>' +
      '<div class="jk-seg"><button class="on" data-act="pretty">Pretty</button><button data-act="raw">Raw</button><button data-act="min">Min</button></div>' +
      '<button class="jk-btn" data-act="fold" style="display:none">⤢ Collapse all</button>' +
      '<button class="jk-btn" data-act="sort" title="Sort keys A→Z (recursive)">⇅ Sort</button>' +
      '<div class="jk-search"><svg class="jk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>' +
        '<input placeholder="Search keys &amp; values"><span class="jk-find-n" data-find hidden></span>' +
        '<button class="jk-find-b" data-find-prev title="Previous (Shift+Enter)" hidden>↑</button><button class="jk-find-b" data-find-next title="Next (Enter)" hidden>↓</button><kbd>/</kbd></div>' +
      '<button class="jk-btn jk-icon" data-act="dl" title="Download .json">⤓</button>' +
      '<button class="jk-btn jk-icon" data-act="theme" title="Theme: auto">◐</button>' +
      '<select class="jk-skin" data-act="skin" title="Color theme"><option value="default">Default</option><option value="solarized">Solarized</option><option value="monokai">Monokai</option><option value="github">GitHub</option></select>' +
      '<div class="jk-meta"><span class="jk-mono" data-meta></span><span class="jk-chip" data-chip></span></div>' +
      '<span class="jk-flash" data-flash></span>' +
    "</div>";

  function applyTheme(rootEl, mode) {
    const set = (el) => { if (!el) return; if (mode === "auto") el.removeAttribute("data-jk-theme"); else el.setAttribute("data-jk-theme", mode); };
    set(rootEl.querySelector(".jk-wrap"));
    set(document.documentElement);
  }

  function applySkin(rootEl, s) {
    const set = (el) => { if (!el) return; if (s === "default") el.removeAttribute("data-jk-skin"); else el.setAttribute("data-jk-skin", s); };
    set(rootEl.querySelector(".jk-wrap"));
    set(document.documentElement);
  }

  // ctx: { onView, onCopy, onDownload, onFold, onSort, getSorted }
  function mount(rootEl, ctx) {
    const { store } = JK.util;
    const $ = (s) => rootEl.querySelector(s);
    const segBtns = { pretty: $('[data-act="pretty"]'), raw: $('[data-act="raw"]'), min: $('[data-act="min"]') };
    const foldBtn = $('[data-act="fold"]'), sortBtn = $('[data-act="sort"]');
    const themeBtn = $('[data-act="theme"]'), skinSel = $('[data-act="skin"]');
    const flash = $("[data-flash]");

    Object.keys(segBtns).forEach((k) => segBtns[k].addEventListener("click", () => ctx.onView(k)));
    $('[data-act="copy"]').addEventListener("click", () => ctx.onCopy());
    $('[data-act="dl"]').addEventListener("click", () => ctx.onDownload());

    let collapsed = false;
    foldBtn.addEventListener("click", () => {
      collapsed = !collapsed;
      ctx.onFold(collapsed);
      foldBtn.textContent = collapsed ? "⤡ Expand all" : "⤢ Collapse all";
    });

    sortBtn.addEventListener("click", () => ctx.onSort());

    let theme = "auto";
    const renderTheme = () => {
      themeBtn.textContent = GLYPH[theme];
      themeBtn.title = "Theme: " + theme;
      applyTheme(rootEl, theme);
    };
    themeBtn.addEventListener("click", () => {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % 3];
      renderTheme();
      store.set("jk:theme", theme);
    });
    store.get("jk:theme", (t) => { if (t) { theme = t; renderTheme(); } });
    renderTheme();

    skinSel.addEventListener("change", () => { applySkin(rootEl, skinSel.value); store.set("jk:skin", skinSel.value); });
    store.get("jk:skin", (s) => { if (s) { skinSel.value = s; applySkin(rootEl, s); } });

    return {
      setView(v) { Object.entries(segBtns).forEach(([k, b]) => b.classList.toggle("on", k === v)); },
      currentView() { return Object.keys(segBtns).find((k) => segBtns[k].classList.contains("on")) || "pretty"; },
      setFlash(t) { flash.textContent = t; setTimeout(() => (flash.textContent = ""), 1500); },
      setMeta(text) { $("[data-meta]").textContent = text; },
      setChip(text) { $("[data-chip]").textContent = text; },
      setSorted(on) { sortBtn.classList.toggle("on", on); },
      // Collapse all hides itself when there is nothing to collapse — otherwise a flat
      // {"a":1,"b":2} would show a button that does nothing when clicked.
      setFoldable(on) { foldBtn.style.display = on ? "" : "none"; },
      resetFold() { collapsed = false; foldBtn.textContent = "⤢ Collapse all"; },
    };
  }

  JK.toolbar = { mount, BAR_HTML, applyTheme, applySkin };
})(typeof window !== "undefined" ? window : globalThis);
