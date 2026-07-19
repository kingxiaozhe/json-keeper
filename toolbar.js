// toolbar.js — the top bar. Split out of core.js; loaded after util.js.
//
// Three zones plus overflow, because eleven controls already filled the bar and four feature
// groups still want a place:
//
//   [Copy JSON] [Pretty|Raw|Min] [search]            [⋯] [1.2 MB · 8 keys · ✓ N big-ints exact]
//
// Left of the gap is what you reach for constantly. Right of it is what must never move: the
// size, the count, and the big-int chip. Everything occasional goes in ⋯ — and so does anything
// a later feature adds, unless that feature's design argues for a promotion.
//
// mount() takes callbacks AND returns setters. The setters aren't decoration: the bar shows data
// core owns, and without a way in, the "✓ N big-ints exact" badge would have no renderer and
// whoever implemented it would reach into this module's DOM from outside.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});

  const THEMES = ["auto", "light", "dark"];
  const GLYPH = { auto: "◐", light: "☀", dark: "☾" };
  // Literal constants — no escaping. Escaping the value while leaving the label bare would only
  // have proved the escape was copied rather than thought about.
  const SKIN_OPTIONS =
    '<option value="default">Default</option><option value="solarized">Solarized</option>' +
    '<option value="monokai">Monokai</option><option value="github">GitHub</option>';

  const ICON_COPY = '<svg class="jk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_FIND = '<svg class="jk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>';

  const BAR_HTML =
    '<div class="jk-bar">' +
      '<button class="jk-btn" data-act="copy">' + ICON_COPY + "Copy JSON</button>" +
      // Table sits next to Pretty (both are rendered views). Raw and Min retired here in v0.10: the
      // source is now the permanent left editor, so a Raw tab that hid the tree would be showing what
      // is already on screen. Table still disables itself when the data isn't an array of objects
      // (F-106); the reason rides in its title. Min moved to ⋯ as "Copy minified".
      '<div class="jk-seg"><button class="on" data-act="pretty">Pretty</button><button data-act="table">Table</button></div>' +
      // ☰ pops out the STRUCTURE outline (a drawer now, not a permanent rail — the two-pane split
      // left no room for a third column). Hidden until core reports the doc is worth an outline.
      '<button class="jk-btn jk-icon" data-act="rail" title="Structure outline" aria-expanded="false" hidden>☰</button>' +
      '<div class="jk-search">' + ICON_FIND +
        '<input placeholder="Search keys &amp; values"><span class="jk-find-n" data-find hidden></span>' +
        '<button class="jk-find-b" data-find-prev title="Previous (Shift+Enter)" hidden>↑</button><button class="jk-find-b" data-find-next title="Next (Enter)" hidden>↓</button><kbd>/</kbd></div>' +
      '<div class="jk-menu" data-menu>' +
        // No role="menu": that contract promises arrow-key navigation and focus management this
        // doesn't implement, and a <label><select> child would violate it outright (menu takes
        // only menuitem/group). These are buttons in a popup — Tab already walks them, Esc
        // already closes. aria-expanded stays because it's true and cheap.
        '<button class="jk-btn jk-icon" data-menu-btn title="More" aria-expanded="false">⋯</button>' +
        '<div class="jk-menu-pop" data-menu-pop hidden></div>' +
      "</div>" +
      '<div class="jk-meta"><span class="jk-mono" data-meta></span>' +
        '<span class="jk-chip jk-chip-sort" data-sortchip hidden title="Keys are sorted A→Z — Copy JSON gives you this order, not the original">⇅ A→Z</span>' +
        '<span class="jk-chip" data-chip></span></div>' +
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

  // ctx: { onView, onRail, onCopy, onDownload, onFold, onSort }
  function mount(rootEl, ctx) {
    const { store } = JK.util;
    const $ = (s) => rootEl.querySelector(s);
    const segBtns = { pretty: $('[data-act="pretty"]'), table: $('[data-act="table"]') };
    const railBtn = $('[data-act="rail"]');
    const flash = $("[data-flash]");
    const menuBtn = $("[data-menu-btn]"), pop = $("[data-menu-pop]");

    // ---- overflow menu ----
    let open = false;
    function setOpen(on) {
      open = on;
      pop.hidden = !on;
      menuBtn.setAttribute("aria-expanded", on ? "true" : "false");
    }
    menuBtn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!open); });
    // Close on any click elsewhere and on Esc — otherwise the popup survives clicks into the
    // tree and sits over the JSON you were trying to read.
    //
    // Detached first: the viewer page calls mountViewer on every Format click, and a listener
    // that only ever gets added would pile up one per render, each pinning a discarded popup.
    // document has no teardown hook, so the handle lives on document itself.
    if (document.__jkMenuClose) document.removeEventListener("click", document.__jkMenuClose);
    document.__jkMenuClose = () => { if (open) setOpen(false); };
    document.addEventListener("click", document.__jkMenuClose);
    rootEl.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) setOpen(false); });
    pop.addEventListener("click", (e) => e.stopPropagation());

    const groups = new Map();
    function groupEl(name) {
      if (!groups.has(name)) {
        const g = document.createElement("div");
        g.className = "jk-menu-g";
        g.dataset.group = name;
        pop.appendChild(g);
        groups.set(name, g);
      }
      return groups.get(name);
    }

    // The only way later features add controls. Returns handles because a menu item is not
    // static: Collapse all flips its own label, and hides entirely when there is nothing to
    // collapse — otherwise a flat {"a":1,"b":2} offers a button that does nothing.
    function addMenuItem(item) {
      const b = document.createElement("button");
      b.className = "jk-menu-i";
      b.dataset.id = item.id;
      b.textContent = item.label;
      if (item.title) b.title = item.title;
      if (item.visible === false) b.hidden = true;
      b.addEventListener("click", () => { setOpen(false); item.onClick(); });
      groupEl(item.group || "misc").appendChild(b);
      return {
        el: b,
        setLabel(t) { b.textContent = t; },
        setVisible(on) { b.hidden = !on; },
        setActive(on) { b.classList.toggle("on", !!on); },
      };
    }

    // ---- zone 1: constant reach ----
    Object.keys(segBtns).forEach((k) => segBtns[k].addEventListener("click", () => ctx.onView(k)));
    $('[data-act="copy"]').addEventListener("click", () => ctx.onCopy());
    railBtn.addEventListener("click", (e) => { e.stopPropagation(); ctx.onRail(); });

    // ---- zone 3: occasional — everything below lives in ⋯ ----
    let collapsed = false;
    // Starts hidden, like the old inline style="display:none" did. setFoldable only runs from
    // renderTree, and Raw/Min never build a tree — so a visible-by-default entry would sit in
    // the menu doing nothing while flipping its own label to "Expand all", leaving the label
    // lying about a tree that is in fact fully expanded.
    const foldItem = addMenuItem({
      id: "fold", group: "tree", label: "⤢ Collapse all", visible: false,
      onClick: () => {
        collapsed = !collapsed;
        ctx.onFold(collapsed);
        foldItem.setLabel(collapsed ? "⤡ Expand all" : "⤢ Collapse all");
      },
    });
    const sortItem = addMenuItem({
      id: "sort", group: "tree", label: "⇅ Sort keys A→Z",
      title: "Sort keys A→Z (recursive); view and copy stay in sync",
      onClick: () => ctx.onSort(),
    });
    addMenuItem({ id: "dl", group: "export", label: "⤓ Download .json", onClick: () => ctx.onDownload() });

    let theme = "auto";
    const themeItem = addMenuItem({
      id: "theme", group: "appearance", label: "◐ Theme: auto",
      onClick: () => {
        theme = THEMES[(THEMES.indexOf(theme) + 1) % 3];
        renderTheme();
        store.set("jk:theme", theme);
      },
    });
    const renderTheme = () => {
      themeItem.setLabel(GLYPH[theme] + " Theme: " + theme);
      applyTheme(rootEl, theme);
    };
    // Only from the callback. Rendering synchronously first meant applying "auto", and applying
    // "auto" means removeAttribute("data-jk-theme") on document.documentElement — the very
    // attribute theme-boot.js had just put there for the popup and the viewer page. The result
    // was dark → (press Format) → white → dark, a flash added for exactly the people the
    // remembered theme is for. The label lagging one tick costs nothing: it lives inside a
    // closed menu, and addMenuItem already created it reading "◐ Theme: auto".
    store.get("jk:theme", (t) => { theme = t || "auto"; renderTheme(); });

    // Skin stays a <select>: four mutually exclusive values, and a native select is both the
    // smallest thing that works and the one that behaves for keyboard users.
    const skinRow = document.createElement("label");
    skinRow.className = "jk-menu-i jk-menu-row";
    skinRow.innerHTML = '<span>Colors</span><select class="jk-skin" data-act="skin">' + SKIN_OPTIONS + "</select>";
    groupEl("appearance").appendChild(skinRow);
    const skinSel = skinRow.querySelector("select");
    skinSel.addEventListener("change", () => { applySkin(rootEl, skinSel.value); store.set("jk:skin", skinSel.value); });
    store.get("jk:skin", (s) => { if (s) { skinSel.value = s; applySkin(rootEl, s); } });

    return {
      setView(v) { Object.entries(segBtns).forEach(([k, b]) => b.classList.toggle("on", k === v)); },
      currentView() { return Object.keys(segBtns).find((k) => segBtns[k].classList.contains("on")) || "pretty"; },
      // Table disables itself when the data can't be a table; the reason rides in the tooltip so
      // the segment doesn't look broken (F-106). A real <button disabled> gets no click event, so
      // core doesn't also need to guard the onView call.
      setTableAvailable(ok, reason) {
        segBtns.table.disabled = !ok;
        segBtns.table.title = ok ? "" : reason;
        segBtns.table.classList.toggle("jk-seg-off", !ok);
      },
      // The ☰ button only earns its place when there's an outline to show — a flat scalar-only doc
      // gets no structure drawer (rail.shouldShow decides), so the button hides with it.
      setRailAvailable(on) { railBtn.hidden = !on; if (!on) { railBtn.classList.remove("on"); railBtn.setAttribute("aria-expanded", "false"); } },
      setRailOpen(on) { railBtn.classList.toggle("on", !!on); railBtn.setAttribute("aria-expanded", on ? "true" : "false"); },
      setFlash(t) { flash.textContent = t; setTimeout(() => (flash.textContent = ""), 1500); },
      setMeta(text) { $("[data-meta]").textContent = text; },
      setChip(text) { $("[data-chip]").textContent = text; },
      // Two indicators, deliberately. The menu entry's highlight is only visible with the menu
      // open, but jk:sort persists across sessions — so sort once and every JSON you open after
      // that is silently alphabetised, and Copy JSON hands you that order rather than the
      // document's. A viewer selling "we don't quietly change your data" cannot hide that
      // behind a closed menu, so the chip sits in the strip that never moves.
      setSorted(on) {
        sortItem.setActive(on);
        $("[data-sortchip]").hidden = !on;
      },
      setFoldable(on) { foldItem.setVisible(on); },
      resetFold() { collapsed = false; foldItem.setLabel("⤢ Collapse all"); },
      addMenuItem,
      isMenuOpen() { return open; },
    };
  }

  JK.toolbar = { mount, BAR_HTML, applyTheme, applySkin };
})(typeof window !== "undefined" ? window : globalThis);
