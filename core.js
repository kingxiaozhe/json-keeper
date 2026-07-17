// core.js — the orchestrator. Owns the parsed value and the view state; everything visual
// lives in toolbar / tree / rail / search / status. window.JK.mountViewer.
//
// Layout: toolbar · breadcrumb · [structure rail | tree] · status bar.
// All parsing/serializing goes through JSONBig so big integers stay exact.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const JSONBig = global.JSONBig;
  const { esc, isContainer, humanSize, store, normalize, LARGE } = JK.util;

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Query bar is its own row, not merged into the toolbar search box: the two are different
  // acts (search = full-text highlight, query = structural filter), and the toolbar is a nowrap
  // flex row that already truncates under pressure (see the status-bar fix). A separate row keeps
  // /-to-focus-search intact and gives the error line somewhere to live.
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

  const SHELL =
    '<div class="jk-wrap jk-scope">' +
      "{BAR}" +
      QUERY +
      '<div class="jk-crumb jk-mono" data-crumb>root</div>' +
      '<div class="jk-main">' +
        '<aside class="jk-rail" data-rail hidden></aside>' +
        '<div class="jk-scroll"><div data-pretty></div><div class="jk-table-wrap" data-table hidden></div><pre class="jk-raw jk-mono" data-raw hidden></pre></div>' +
      "</div>" +
      '<div class="jk-status jk-mono" data-status></div>' +
    "</div>";

  // Placeholder rows shown while a large tree builds. Deliberately not a spinner: a spinner says
  // "wait", these say "a tree is coming, and roughly this shape". Widths vary so it reads as
  // content rather than as a progress bar — we have no progress to report (see buildDeferred).
  const SKELETON =
    '<div class="jk-skel" aria-hidden="true">' +
    [72, 48, 60, 36, 66, 42, 54, 30].map((w, i) =>
      '<div class="jk-skel-row" style="width:' + w + "%;margin-left:" + (i % 3) * 14 + 'px"></div>').join("") +
    "</div>";

  function mountViewer(rootEl, rawText, opts) {
    opts = opts || {};
    // Fail before the caller commits. content.js wipes the host page the moment this returns
    // true, but the tree is built later, from an async storage callback — so a missing module
    // used to mean: page erased, then a TypeError nobody catches, then a blank panel. Its
    // `!window.JK` guard can't help; util.js defines JK, so the guard passes regardless.
    for (const m of ["tree", "toolbar", "search", "rail", "status"]) {
      if (!JK[m]) return false;
    }

    let value;
    const diag = { dupKeys: [], bigInts: 0, lossy: [], dupPaths: [] };
    try { value = JSONBig.parse(normalize(rawText), diag); }
    catch (e) {
      if (!opts.showErrors) return false;
      rootEl.innerHTML = '<div class="jk-wrap jk-scope"><div class="jk-error">Not valid JSON: ' + esc(e.message) + "</div></div>";
      return false;
    }

    // Sort-keys (recursive, arrays keep order) toggles a sorted copy used by the tree AND by
    // copy/pretty/min, so what you see equals what you copy.
    const sortValue = (v) => {
      if (Array.isArray(v)) return v.map(sortValue);
      if (v && typeof v === "object" && typeof v !== "bigint") {
        const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]); return o;
      }
      return v;
    };
    let sorted = false, displayValue = value, pretty, minified;
    const recompute = () => {
      displayValue = sorted ? sortValue(value) : value;
      pretty = JSONBig.stringify(displayValue, 2);
      minified = JSONBig.stringify(displayValue);
    };
    recompute();

    // Raw shows the source as it arrived (XSSI prefix and all); parsing works off normalize().
    const original = rawText.trim();
    const topInfo = isContainer(value) ? (Array.isArray(value) ? value.length + " items" : Object.keys(value).length + " keys") : "value";
    const heavy = rawText.length > LARGE;
    const dupes = [...new Set(diag.dupKeys)];
    const dupPaths = diag.dupPaths.map(JK.tree.trailToPath);

    // Function form, not the string: in a replacement string `$&`, `$'` and `` $` `` are
    // substitution patterns, so a toolbar label containing one would silently eat part of the
    // markup. Today's BAR_HTML has no `$`; T-004 rewrites it.
    rootEl.innerHTML = SHELL.replace("{BAR}", () => JK.toolbar.BAR_HTML);

    const $ = (s) => rootEl.querySelector(s);
    const prettyEl = $("[data-pretty]"), rawEl = $("[data-raw]"), scrollEl = $(".jk-scroll");
    const tableEl = $("[data-table]"), railEl = $("[data-rail]"), crumbEl = $("[data-crumb]");

    let treeBuilt = false, tree = null, search = null, query = null, pendingBuild = false;
    let tableHandle = null;
    const getTree = () => tree;

    // persist=false: "Build tree" is a remedy for this document, not a statement about every
    // future one. The Pretty tab is right there if the user wants to say that, and it persists.
    const status = JK.status.mount($("[data-status]"), { onBuild: () => setView("pretty", false) });
    const rail = JK.rail.mount(railEl, { scrollEl, jumpTo: jumpToPath });
    const renderStatus = () => status.render({
      dupes, nodes: tree && tree.nodes, counts: tree && tree.counts,
      heavy, size: humanSize(rawText.length), treeBuilt,
    });

    // When a query is active, the Pretty pane shows the matched subset instead of the whole doc.
    // queryValue is a synthetic object keyed by each match's JSONPath ($.users[0].email) with the
    // matched value — one render path, one flag. Building the matches as N top-level entries of a
    // plain array would give them apaths of [0]/[1] (design's basePath trap); keying by path keeps
    // each result labelled by where it actually came from, and needs no dupPaths (keys are unique).
    let queryValue = null; // non-null ⇒ query mode
    function renderTree() {
      if (treeBuilt) return;
      treeBuilt = true;
      const value = queryValue == null ? displayValue : queryValue;
      tree = JK.tree.build(value, prettyEl, queryValue == null ? { scrollEl, dupPaths } : { scrollEl });
      rail.render(tree.topLevel);
      renderStatus();
      bar.setFoldable(tree.hasContainers);
    }

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

    // Building a 20MB tree blocks the thread for seconds. Showing a skeleton first is the whole
    // point — and doing it in ONE rAF would not work: that callback runs inside the same frame's
    // rendering step, *before* paint. The skeleton DOM would exist, the build would block, and
    // the browser would paint once, with the finished tree. The user would see a frozen tab and
    // no skeleton, while the code plainly "has a rAF in it".
    // Two frames deep: frame 1 paints the skeleton, frame 2 does the work. The thread still
    // blocks — that limit is real and this does not pretend otherwise; feature 5's chunked
    // buildModel is what fixes it. Do not collapse this to a single rAF.
    function buildDeferred() {
      if (treeBuilt || pendingBuild) return;
      pendingBuild = true;
      prettyEl.innerHTML = SKELETON;
      // The skeleton needs no cleanup here: tree.build() clears its mount first thing.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pendingBuild = false;
        renderTree();
      }));
    }

    // The single entry point for jumping to a node. The tree can expand and scroll itself, but
    // only core knows the tree might not be built (large files open in Raw) or that the view
    // isn't showing it — the rail stays visible in Raw, so clicking an outline entry used to
    // scroll a hidden element and appear to do nothing at all.
    // The table's cell clicks (feature 2) and the validator's error list (feature 3) land here.
    function jumpToPath(apath, o) {
      renderTree();
      if (bar.currentView() !== "pretty") setView("pretty", false);
      const row = tree ? tree.jumpTo(apath, o) : false;
      // The breadcrumb is where you are, so a jump (rail, search, a crumb ancestor, feature 2's
      // cell clicks) has to move it too. Without this it kept naming the last row you *clicked*,
      // which — now that its segments are clickable — pointed you somewhere unrelated to the
      // highlighted row.
      if (row && row._trail) showCrumb(row._trail);
      return row;
    }

    // persist=false for view changes the user didn't ask for. Jumping to a node has to show the
    // tree, but it's navigation — it shouldn't quietly rewrite which view every future JSON
    // opens in. (The search box has persisted since before the split; left alone here.)
    // The table shows the whole array (a tree-level query filters the Pretty tree, not this). Built
    // lazily and cached; recompute()/Sort invalidate it by nulling tableHandle.
    function renderTable() {
      if (tableHandle) return;
      tableHandle = JK.table.mount(tableEl, displayValue, { onJump: jumpToPath });
    }

    function setView(v, persist) {
      // Only the large-file path is worth a skeleton — a small tree builds within the frame, and
      // deferring it would just add a flash of skeleton to something that was already instant.
      if (v === "pretty") { if (heavy) buildDeferred(); else renderTree(); }
      else if (v === "table") renderTable();
      bar.setView(v);
      prettyEl.hidden = v !== "pretty";
      tableEl.hidden = v !== "table";
      rawEl.hidden = v === "pretty" || v === "table";
      if (v === "raw" || v === "min") rawEl.textContent = v === "min" ? minified : original;
      // search's "no match" bar lives in the scroll container alongside the Raw pane, so it has
      // to know when the tree it describes stops being what's on screen.
      if (search) search.onViewChange(v);
      if (persist !== false) store.set("jk:view", v);
    }

    // The reason strings a disabled Table segment shows (F-106) — specific, not a generic "n/a".
    const TABLE_REASON = {
      "not an array": "Table view is for JSON arrays",
      "empty array": "Empty array — nothing to tabulate",
      "some elements aren't objects": "Table view needs an array of objects",
    };
    let tableOk = { ok: false };
    function updateTableAvail() {
      tableOk = JK.table.canRender(displayValue);
      if (bar) bar.setTableAvailable(tableOk.ok, tableOk.ok ? "" : (TABLE_REASON[tableOk.reason] || "Table view unavailable"));
    }

    // Rebuilding the tree strands everything that holds rows from the old one. resetFold and
    // search.reset are not tidiness: without them the Collapse all label lies about a tree
    // that no longer exists, and the match counter keeps reporting hits on detached rows.
    function applySort() {
      bar.setSorted(sorted);
      recompute();
      treeBuilt = false; tree = null; prettyEl.innerHTML = "";
      // Sort changes displayValue, so the cached table is now built from the wrong array — drop
      // it so the next Table view rebuilds. (Availability can't change: sorting keeps the shape.)
      if (tableHandle) { tableHandle.destroy(); tableHandle = null; }
      bar.resetFold();
      if (search) search.reset();
      // Sort re-sorts the whole document; a filtered result left on screen would name paths into
      // a tree that no longer matches. clear() resets the query bar UI and drops query mode.
      if (query) query.clear();
      // persist=false: re-showing the view the user is already looking at says nothing new about
      // their preference. It matters because jk:sort arrives from an async callback, i.e. *after*
      // the heavy branch has deliberately not persisted "raw" — so persisting here would write
      // it back and hand anyone who has ever used Sort the exact bug that branch avoids.
      setView(bar.currentView(), false);
    }

    // Declared after renderTree/setView because its ctx needs them, and read from inside them
    // — safe only because nothing calls either until after this line. Anything that invokes a
    // callback during mount() would hit the temporal dead zone.
    const bar = JK.toolbar.mount(rootEl, {
      onView: setView,
      onCopy: async () => {
        try { await navigator.clipboard.writeText(pretty); bar.setFlash("Copied valid JSON ✓"); }
        catch { bar.setFlash("Select & ⌘C to copy"); }
      },
      onDownload: () => { download("data.json", pretty); bar.setFlash("Downloaded ✓"); },
      onFold: (on) => { if (tree) on ? tree.collapseAll() : tree.expandAll(); },
      onSort: () => { sorted = !sorted; store.set("jk:sort", sorted); applySort(); },
    });

    bar.setMeta(humanSize(rawText.length) + " · " + topInfo);
    bar.setChip(diag.bigInts ? "✓ " + diag.bigInts + " big-ints exact" : "✓ big-ints precise");
    updateTableAvail();
    renderStatus();

    search = JK.search.mount(rootEl, {
      scrollEl, getTree, renderTree,
      // persist=false, like every other switch the user didn't ask for by name. Typing in the
      // search box says "find X", not "show me trees from now on" — the tree is the means. Only
      // the view tabs (and nothing else) get to state a preference.
      ensurePretty: () => { if (bar.currentView() !== "pretty") setView("pretty", false); },
      onExpandAll: () => bar.resetFold(),
      // A search hit is a jump too: without this the (now clickable) breadcrumb keeps naming the
      // last row you clicked, not the match you're looking at. search bypasses jumpToPath (it does
      // its own scroll + jk-current), so it reveals the crumb itself.
      revealCrumb: (row) => { if (row && row._trail) showCrumb(row._trail); },
    });

    query = JK.query.mount(rootEl, {
      getValue: () => displayValue,
      onResult: showQuery,
      onClear: clearQuery,
    });

    // ---- per-node copy (value / path / subtree) + breadcrumb (delegated) ----
    // core keeps this rather than tree emitting onCrumb: the copy buttons live inside rows, and
    // one handler that can stopPropagation before the row-click fallback is what keeps clicking
    // ⧉ from also moving the breadcrumb.
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

    // The breadcrumb is where you are; its ancestors are how you get back up. It used to be inert
    // text — a path that names nodes you can't act on, the same dead affordance this project keeps
    // finding (the viewer's Format button, the rail while in Raw). Every segment but the last is a
    // button that jumps to that ancestor; the last is the current node, so it's plain text.
    let crumbTrail = [];
    function showCrumb(trail) {
      crumbTrail = trail;
      crumbEl.textContent = "";
      trail.forEach((t, i) => {
        if (t.sep) crumbEl.appendChild(document.createTextNode(t.sep));
        if (i === trail.length - 1) {
          const span = document.createElement("span");
          span.className = "jk-crumb-cur";
          span.textContent = t.label;
          crumbEl.appendChild(span);
        } else {
          const b = document.createElement("button");
          b.className = "jk-crumb-i";
          b.dataset.i = i;
          b.textContent = t.label;
          crumbEl.appendChild(b);
        }
      });
    }
    crumbEl.addEventListener("click", (e) => {
      const b = e.target.closest(".jk-crumb-i");
      if (b) jumpToPath(crumbTrail[+b.dataset.i].apath);
    });

    store.get("jk:sort", (v) => { if (v) { sorted = true; applySort(); } });

    // initial view: large files start in Raw (tree on demand); else saved or Pretty.
    // persist=false: this is our decision, not the user's. Persisting it (shipped behaviour
    // since v0.8.0) means opening one big file silently makes Raw the default for every JSON
    // afterwards — a preference the user never expressed.
    if (heavy) setView("raw", false);
    // "table" is honoured only when this document can actually be a table — an old preference of
    // "table" opening on a non-array doc must fall back to pretty, not show an empty/broken pane.
    else store.get("jk:view", (v) =>
      setView(v === "raw" || v === "min" || (v === "table" && tableOk.ok) ? v : "pretty"));

    return true;
  }

  // Merge, don't assign. `global.JK = {...}` here would erase the modules loaded before it.
  JK.mountViewer = mountViewer;
  // JK.normalize is set by util.js.
})(typeof window !== "undefined" ? window : globalThis);
