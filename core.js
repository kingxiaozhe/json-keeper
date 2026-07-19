// core.js — the orchestrator. Owns the parsed value and the view state; everything visual lives
// in toolbar / tree / rail / search / status / split / export-panel. window.JK.mountViewer.
//
// Layout (v0.10): toolbar · query · breadcrumb · [ source editor | ⇔ | tree/table + drawer ] ·
// status. The left pane is the source, EDITABLE — typing there re-parses (debounced) and the tree
// on the right follows. That replaced the old Raw/Min view tabs: the source is now always on
// screen next to the tree instead of being a mode that hid it. STRUCTURE moved into a ☰ drawer.
// All parsing/serializing goes through JSONBig so big integers stay exact.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const JSONBig = global.JSONBig;
  const { esc, isContainer, humanSize, store, normalize, LARGE } = JK.util;

  const DEBOUNCE = 300; // ms; same value the popup uses — re-parse after typing settles, not per key
  const freshDiag = () => ({ dupKeys: [], bigInts: 0, lossy: [], dupPaths: [] });

  // Recursive key sort (arrays keep order). A sorted COPY feeds the tree and copy/pretty/min alike,
  // so what you see equals what you copy.
  const sortValue = (v) => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === "object" && typeof v !== "bigint") {
      const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]); return o;
    }
    return v;
  };

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Query bar is its own row, not merged into the toolbar search box: the two are different acts
  // (search = full-text highlight, query = structural filter), and the toolbar is a nowrap flex row
  // that already truncates under pressure. A separate row keeps /-to-focus-search intact.
  const QUERY =
    '<div class="jk-query" data-query>' +
      '<div class="jk-query-row">' +
        '<span class="jk-query-sig jk-mono">$</span>' +
        '<input class="jk-query-in jk-mono" placeholder="JSONPath filter — e.g. $.users[*].email" spellcheck="false" autocapitalize="off" autocomplete="off">' +
        '<span class="jk-query-n" data-query-n hidden></span>' +
        '<button class="jk-query-clear" data-query-clear hidden title="Clear filter (Esc)">✕</button>' +
      "</div>" +
      '<div class="jk-query-err jk-mono" data-query-err hidden></div>' +
    "</div>";

  // The two-pane body. Left is an editable source textarea; right is the tree/table scroll with the
  // STRUCTURE drawer overlaid on it. The old Raw <pre> is gone — the editor is the source view now.
  const MAIN =
    '<div class="jk-main">' +
      '<div class="jk-edit-pane">' +
        '<textarea class="jk-src jk-mono" data-src spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" ' +
          'placeholder="Paste or type JSON here — the tree updates as you type"></textarea>' +
        '<div class="jk-src-err jk-mono" data-src-err hidden></div>' +
      "</div>" +
      '<div class="jk-splitter" data-splitter title="Drag to resize · double-click to reset"></div>' +
      '<div class="jk-view-pane">' +
        '<div class="jk-scroll"><div data-pretty></div><div class="jk-table-wrap" data-table hidden></div></div>' +
        '<aside class="jk-drawer" data-drawer hidden><div class="jk-drawer-body" data-rail></div></aside>' +
      "</div>" +
    "</div>";

  const SHELL =
    '<div class="jk-wrap jk-scope">' +
      "{BAR}" +
      QUERY +
      '<div class="jk-crumb jk-mono" data-crumb>root</div>' +
      MAIN +
      '<div class="jk-status jk-mono" data-status></div>' +
      // Subtree panel for a table's nested {…}/[N] cell. An overlay, not a jump: the value is shown
      // in place so you don't lose the table you were reading.
      '<div class="jk-subtree" data-subtree hidden>' +
        '<div class="jk-subtree-card">' +
          '<div class="jk-subtree-head"><span class="jk-subtree-path jk-mono" data-subtree-path></span>' +
            '<button class="jk-subtree-close" data-subtree-close title="Close (Esc)">✕</button></div>' +
          '<div class="jk-subtree-body" data-subtree-body></div>' +
        "</div>" +
      "</div>" +
    "</div>";

  // Placeholder rows shown while a large tree builds. Not a spinner: a spinner says "wait", these
  // say "a tree is coming, and roughly this shape". Widths vary so it reads as content, not a
  // progress bar — we have no progress to report (see buildDeferred).
  const SKELETON =
    '<div class="jk-skel" aria-hidden="true">' +
    [72, 48, 60, 36, 66, 42, 54, 30].map((w, i) =>
      '<div class="jk-skel-row" style="width:' + w + "%;margin-left:" + (i % 3) * 14 + 'px"></div>').join("") +
    "</div>";

  function mountViewer(rootEl, rawText, opts) {
    opts = opts || {};
    // Fail before the caller commits. content.js wipes the host page the moment this returns true.
    for (const m of ["tree", "toolbar", "search", "rail", "status"]) if (!JK[m]) return false;

    rawText = rawText == null ? "" : String(rawText);
    const blank = !rawText.trim();

    // Parse up front. content.js commits to us by our return value — it erases the host page the
    // instant this returns true — so a takeover doc that isn't valid JSON must return false BEFORE
    // any DOM is touched, never mounting at all. The viewer page (showErrors) is the opposite: a
    // bad paste should land in the editor with the error under it (the repair path), so it mounts.
    let value, diag = freshDiag(), initialError = null;
    if (!blank) {
      try { value = JSONBig.parse(normalize(rawText), diag); }
      catch (e) { if (!opts.showErrors) return false; initialError = e; }
    }

    // Function form, not the string: in a replacement string `$&`, `$'` and `` $` `` are
    // substitution patterns, so a toolbar label containing one would silently eat part of the markup.
    rootEl.innerHTML = SHELL.replace("{BAR}", () => JK.toolbar.BAR_HTML);

    const $ = (s) => rootEl.querySelector(s);
    const prettyEl = $("[data-pretty]"), scrollEl = $(".jk-scroll"), tableEl = $("[data-table]");
    const railEl = $("[data-rail]"), crumbEl = $("[data-crumb]"), wrapEl = $(".jk-wrap"), mainEl = $(".jk-main");
    const srcEl = $("[data-src]"), srcErrEl = $("[data-src-err]"), drawerEl = $("[data-drawer]");

    // ---- live document state (all reassignable: an edit adopts a new value) ----
    let sorted = false, displayValue, pretty = "", minified = "";
    let dupes = [], dupPaths = [], topInfo = "value", heavy = false, hasDoc = false;

    const recompute = () => {
      displayValue = sorted ? sortValue(value) : value;
      pretty = JSONBig.stringify(displayValue, 2);
      minified = JSONBig.stringify(displayValue);
    };

    // adopt(v, d, text): make (v, d) the live document. Runs on the initial parse and on every edit,
    // so all the per-document derived facts have one place to be recomputed.
    function adopt(v, d, text) {
      value = v; diag = d; hasDoc = true;
      dupes = [...new Set(diag.dupKeys)];
      dupPaths = diag.dupPaths.map(JK.tree.trailToPath);
      topInfo = isContainer(value) ? (Array.isArray(value) ? value.length + " items" : Object.keys(value).length + " keys") : "value";
      heavy = text.length > LARGE;
      recompute();
    }

    let treeBuilt = false, tree = null, search = null, query = null, pendingBuild = false, tableHandle = null;
    let queryValue = null; // non-null ⇒ query mode (matched subset)
    const getTree = () => tree;

    // persist=false everywhere below: Build tree and every jump/search is a remedy for THIS document,
    // not a statement about which view every future one should open in. The Pretty tab persists.
    const status = JK.status.mount($("[data-status]"), { onBuild: () => buildDeferred() });
    const rail = JK.rail.mount(railEl, { scrollEl, jumpTo: (apath, o) => { setDrawer(false); return jumpToPath(apath, o); } });
    JK.split.mount(mainEl);

    const docSize = () => humanSize(srcEl.value.length);
    const renderStatus = () => {
      if (!hasDoc) { $("[data-status]").innerHTML = ""; return; }
      status.render({ dupes, nodes: tree && tree.nodes, counts: tree && tree.counts, heavy, size: docSize(), treeBuilt });
    };

    function renderTree() {
      if (!hasDoc || treeBuilt) return;
      treeBuilt = true;
      const v = queryValue == null ? displayValue : queryValue;
      tree = JK.tree.build(v, prettyEl, queryValue == null ? { scrollEl, dupPaths } : { scrollEl });
      bar.setRailAvailable(rail.render(tree.topLevel));
      renderStatus();
      bar.setFoldable(tree.hasContainers);
    }

    // Large files don't auto-build: a 20MB tree blocks the thread for seconds. The source is already
    // readable on the left, so heavy just means "the tree waits for a click". This shows the offer.
    function showHeavyHint() {
      prettyEl.innerHTML =
        '<div class="jk-heavy"><p class="jk-heavy-t">Large file — the tree is built on demand so the tab stays responsive.</p>' +
        '<button class="jk-build" data-build-inline>Build tree</button>' +
        '<p class="jk-heavy-s">The full source is on the left.</p></div>';
      const b = prettyEl.querySelector("[data-build-inline]");
      if (b) b.addEventListener("click", () => buildDeferred());
    }

    function showEmptyRight(msg) {
      prettyEl.innerHTML = '<div class="jk-empty">' + esc(msg) + "</div>";
      prettyEl.hidden = false; tableEl.hidden = true;
    }

    // Two frames deep, not one: a single rAF runs inside the same frame's render step, BEFORE paint —
    // the skeleton DOM would exist, the build would block, and the browser would paint once with the
    // finished tree. The user would see a frozen tab and no skeleton. Frame 1 paints the skeleton,
    // frame 2 does the work. The thread still blocks; do not collapse this to a single rAF.
    function buildDeferred() {
      if (treeBuilt || pendingBuild || !hasDoc) return;
      pendingBuild = true;
      prettyEl.innerHTML = SKELETON;
      requestAnimationFrame(() => requestAnimationFrame(() => { pendingBuild = false; renderTree(); }));
    }

    // The single entry point for jumping to a node. Only core knows the tree might not be built yet
    // (large files) — the rail, the table's cell clicks and the validator's error list all land here.
    function jumpToPath(apath, o) {
      if (heavy && !treeBuilt) buildDeferred(); else renderTree();
      if (bar.currentView() !== "pretty") setView("pretty", false);
      const row = tree ? tree.jumpTo(apath, o) : false;
      if (row && row._trail) showCrumb(row._trail);
      return row;
    }

    // When a query is active the tree shows the matched subset. queryValue is a synthetic object
    // keyed by each match's JSONPath with the matched value — one render path, one flag.
    function showQuery(matches) {
      const obj = {};
      matches.forEach((m) => { obj[m.path] = m.value; });
      queryValue = obj;
      treeBuilt = false; tree = null;
      if (search) search.reset();
      if (bar.currentView() !== "pretty") setView("pretty", false);
      else renderTree();
    }
    function clearQuery() {
      queryValue = null;
      treeBuilt = false; tree = null;
      if (search) search.reset();
      renderTree();
    }

    // The table shows the whole array; built lazily and cached. recompute()/Sort/edit invalidate it.
    function renderTable() {
      if (!hasDoc || tableHandle) return;
      tableHandle = JK.table.mount(tableEl, displayValue, { onJump: jumpToPath, onSubtree: openSubtree });
    }

    // A table's nested cell opens its value here, in place, rather than jumping away.
    const subEl = $("[data-subtree]"), subBody = $("[data-subtree-body]"), subPath = $("[data-subtree-path]");
    function openSubtree(value, apath) {
      subPath.textContent = apath || "(root)";
      JK.tree.build(value, subBody, { basePath: apath });
      subEl.hidden = false;
    }
    function closeSubtree() { subEl.hidden = true; subBody.innerHTML = ""; }
    $("[data-subtree-close]").addEventListener("click", closeSubtree);
    subEl.addEventListener("click", (e) => { if (e.target === subEl) closeSubtree(); });
    rootEl.addEventListener("keydown", (e) => { if (e.key === "Escape" && !subEl.hidden) closeSubtree(); });

    // Views: only pretty (tree) and table now — Raw and Min retired with the source moving into the
    // permanent left editor. Heavy files show the build offer instead of auto-building.
    function setView(v, persist) {
      if (v === "pretty") { if (!treeBuilt && hasDoc) { if (heavy) showHeavyHint(); else renderTree(); } }
      else if (v === "table") renderTable();
      bar.setView(v);
      prettyEl.hidden = v !== "pretty";
      tableEl.hidden = v !== "table";
      if (search) search.onViewChange(v);
      if (persist !== false) store.set("jk:view", v);
    }

    // ---- STRUCTURE drawer (the ☰ pop-out) ----
    let drawerOpen = false;
    function setDrawer(on) { drawerOpen = on; drawerEl.hidden = !on; bar.setRailOpen(on); }
    // Click outside the drawer closes it; the ☰ button is excluded so its own toggle isn't undone.
    wrapEl.addEventListener("click", (e) => {
      if (drawerOpen && !drawerEl.contains(e.target) && !e.target.closest('[data-act="rail"]')) setDrawer(false);
    });
    rootEl.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerOpen) setDrawer(false); });

    const TABLE_REASON = {
      "not an array": "Table view is for JSON arrays",
      "empty array": "Empty array — nothing to tabulate",
      "some elements aren't objects": "Table view needs an array of objects",
    };
    let tableOk = { ok: false };
    function updateTableAvail() {
      tableOk = hasDoc ? JK.table.canRender(displayValue) : { ok: false, reason: "no document" };
      if (bar) bar.setTableAvailable(tableOk.ok, tableOk.ok ? "" : (TABLE_REASON[tableOk.reason] || "Table view unavailable"));
    }

    // rerender(): rebuild everything downstream of displayValue. Sort and every edit funnel through
    // here — a rebuilt tree strands search's row list and the cached table, so both are dropped.
    function rerender() {
      treeBuilt = false; tree = null; prettyEl.innerHTML = ""; queryValue = null;
      if (tableHandle) { tableHandle.destroy(); tableHandle = null; }
      bar.resetFold();
      if (search) search.reset();
      if (query) query.clear();
      updateTableAvail();
      bar.setMeta(docSize() + " · " + topInfo);
      bar.setChip(diag.bigInts ? "✓ " + diag.bigInts + " big-ints exact" : "✓ big-ints precise");
      renderStatus();
      // persist=false: re-showing the view already on screen says nothing new about preference.
      setView(bar.currentView(), false);
    }

    function applySort() {
      bar.setSorted(sorted);
      recompute();
      rerender();
    }

    // ---- live editing: type in the source pane, the tree follows (debounced) ----
    let editTimer = 0;
    const setSrcErr = (msg) => { srcErrEl.hidden = !msg; if (msg) srcErrEl.textContent = msg; };
    function ingest() {
      const text = srcEl.value;
      if (!text.trim()) {
        // Emptied the box: not an error, but there's no document to show. Reset to the blank state.
        srcEl.classList.remove("jk-bad"); setSrcErr("");
        hasDoc = false; treeBuilt = false; tree = null;
        bar.setMeta(""); bar.setChip(""); bar.setSorted(sorted); bar.setRailAvailable(false);
        updateTableAvail(); renderStatus();
        showEmptyRight("Paste or type JSON on the left to see it as a tree.");
        return;
      }
      if (text.length > LARGE) {
        // Trial-parsing on every keystroke of a multi-MB doc would freeze the pane; the popup makes
        // the same call. Leave the last good tree standing and say why formatting paused.
        srcEl.classList.remove("jk-bad");
        setSrcErr(humanSize(text.length) + " — large file; live formatting paused while editing");
        return;
      }
      const d = freshDiag();
      let v;
      try { v = JSONBig.parse(normalize(text), d); }
      catch (e) {
        // Keep the last good tree on the right; mark the source and say what's wrong. textContent in
        // setSrcErr, not innerHTML: the message can quote the input, so it must not become markup.
        srcEl.classList.add("jk-bad"); setSrcErr(e.message);
        return;
      }
      srcEl.classList.remove("jk-bad"); setSrcErr("");
      adopt(v, d, text);
      rerender();
    }
    srcEl.addEventListener("input", () => { clearTimeout(editTimer); editTimer = setTimeout(ingest, DEBOUNCE); });

    // Declared here because bar's ctx callbacks close over the functions above, and nothing invokes
    // them until after this line — a callback firing during mount would hit the temporal dead zone.
    const bar = JK.toolbar.mount(rootEl, {
      onView: setView,
      onRail: () => setDrawer(!drawerOpen),
      onCopy: async () => {
        try { await navigator.clipboard.writeText(pretty); bar.setFlash("Copied valid JSON ✓"); }
        catch { bar.setFlash("Select & ⌘C to copy"); }
      },
      onDownload: () => { download("data.json", pretty); bar.setFlash("Downloaded ✓"); },
      onFold: (on) => { if (tree) on ? tree.collapseAll() : tree.expandAll(); },
      onSort: () => { sorted = !sorted; store.set("jk:sort", sorted); applySort(); },
    });

    // Min retired from the view tabs; copying a minified document is still wanted, so it lives in ⋯.
    bar.addMenuItem({ id: "copymin", group: "export", label: "⧉ Copy minified", onClick: async () => {
      if (!hasDoc) { bar.setFlash("Nothing to copy"); return; }
      try { await navigator.clipboard.writeText(minified); bar.setFlash("Copied minified ✓"); }
      catch { bar.setFlash("Copy blocked"); }
    } });

    // feature 3: Schema / TypeScript export + Schema validation. Lives in export-panel.js now; it
    // reads the live document through getters so an edit is reflected without re-wiring the menu.
    JK.exportPanel.wire({
      host: wrapEl, bar, download,
      getDisplay: () => displayValue, getTree, renderTree, jumpToPath,
    });

    // ---- per-node copy (value / path / subtree) + breadcrumb (delegated) ----
    prettyEl.addEventListener("click", async (e) => {
      const act = e.target.closest(".jk-act");
      if (act) {
        e.stopPropagation();
        const r = act.closest(".jk-row");
        let text, label;
        if (act.dataset.t === "path") { text = r._apath; label = "path"; }
        else {
          const v = r._val;
          text = typeof v === "string" ? v : isContainer(v) ? JSONBig.stringify(v, 2) : JSONBig.stringify(v);
          label = isContainer(v) ? "subtree" : "value";
        }
        try { await navigator.clipboard.writeText(text); bar.setFlash("Copied " + label + " ✓"); }
        catch { bar.setFlash("Copy blocked"); }
        if (act.dataset.t === "path" && r._trail) showCrumb(r._trail);
        return;
      }
      const r = e.target.closest(".jk-row");
      if (r && r._trail) showCrumb(r._trail);
    });

    // The breadcrumb is where you are; its ancestors are how you get back up. Every segment but the
    // last is a button that jumps to that ancestor; the last is the current node, so it's plain text.
    let crumbTrail = [];
    function showCrumb(trail) {
      crumbTrail = trail;
      crumbEl.textContent = "";
      trail.forEach((t, i) => {
        if (t.sep) crumbEl.appendChild(document.createTextNode(t.sep));
        if (i === trail.length - 1) {
          const span = document.createElement("span");
          span.className = "jk-crumb-cur"; span.textContent = t.label;
          crumbEl.appendChild(span);
        } else {
          const b = document.createElement("button");
          b.className = "jk-crumb-i"; b.dataset.i = i; b.textContent = t.label;
          crumbEl.appendChild(b);
        }
      });
    }
    crumbEl.addEventListener("click", (e) => {
      const b = e.target.closest(".jk-crumb-i");
      if (b) jumpToPath(crumbTrail[+b.dataset.i].apath);
    });

    search = JK.search.mount(rootEl, {
      scrollEl, getTree, renderTree,
      ensurePretty: () => { if (bar.currentView() !== "pretty") setView("pretty", false); },
      onExpandAll: () => bar.resetFold(),
      revealCrumb: (row) => { if (row && row._trail) showCrumb(row._trail); },
    });

    query = JK.query.mount(rootEl, {
      getValue: () => displayValue,
      onResult: showQuery,
      onClear: clearQuery,
    });

    // ---- initial content ----
    srcEl.value = blank ? "" : rawText.trim();
    if (initialError) {
      // Viewer page, bad paste: show it in the editor with the error under it. No status "valid"
      // line — the document isn't valid — the editor is the repair surface.
      srcEl.classList.add("jk-bad"); setSrcErr(initialError.message);
      bar.setMeta(""); bar.setRailAvailable(false); updateTableAvail(); renderStatus();
      showEmptyRight("This isn't valid JSON yet — fix it on the left and the tree appears here.");
    } else if (blank) {
      bar.setMeta(""); bar.setRailAvailable(false); updateTableAvail(); renderStatus();
      showEmptyRight("Paste or type JSON on the left to see it as a tree.");
    } else {
      adopt(value, diag, rawText);
      bar.setMeta(docSize() + " · " + topInfo);
      bar.setChip(diag.bigInts ? "✓ " + diag.bigInts + " big-ints exact" : "✓ big-ints precise");
      updateTableAvail();
      renderStatus();
      store.get("jk:sort", (v) => { if (v) { sorted = true; applySort(); } });
      // Large files show the build offer (there's no Raw view to fall back to anymore). Otherwise the
      // saved view — but an old "raw"/"min" preference maps to Pretty, and "table" only if it fits.
      // persist=false on restore too: re-opening a document shouldn't re-write the preference it's
      // reading (a no-op for pretty/table, but for a retired "raw"/"min" it would silently migrate
      // the stored value on open). Only an explicit view-tab click states a preference.
      if (heavy) setView("pretty", false);
      else store.get("jk:view", (v) => setView(v === "table" && tableOk.ok ? "table" : "pretty", false));
    }

    return true;
  }

  // Merge, don't assign. `global.JK = {...}` here would erase the modules loaded before it.
  JK.mountViewer = mountViewer;
})(typeof window !== "undefined" ? window : globalThis);
