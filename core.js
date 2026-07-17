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

  const SHELL =
    '<div class="jk-wrap jk-scope">' +
      "{BAR}" +
      '<div class="jk-crumb jk-mono" data-crumb>root</div>' +
      '<div class="jk-main">' +
        '<aside class="jk-rail" data-rail hidden></aside>' +
        '<div class="jk-scroll"><div data-pretty></div><pre class="jk-raw jk-mono" data-raw hidden></pre></div>' +
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

    const original = (opts.originalText != null ? opts.originalText : rawText).trim();
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
    const railEl = $("[data-rail]"), crumbEl = $("[data-crumb]");

    let treeBuilt = false, tree = null, search = null, pendingBuild = false;
    const getTree = () => tree;

    // persist=false: "Build tree" is a remedy for this document, not a statement about every
    // future one. The Pretty tab is right there if the user wants to say that, and it persists.
    const status = JK.status.mount($("[data-status]"), { onBuild: () => setView("pretty", false) });
    const rail = JK.rail.mount(railEl, { scrollEl, jumpTo: jumpToPath });
    const renderStatus = () => status.render({
      dupes, nodes: tree && tree.nodes, counts: tree && tree.counts,
      heavy, size: humanSize(rawText.length), treeBuilt,
    });

    function renderTree() {
      if (treeBuilt) return;
      treeBuilt = true;
      tree = JK.tree.build(displayValue, prettyEl, { scrollEl, dupPaths });
      rail.render(tree.topLevel);
      renderStatus();
      bar.setFoldable(tree.hasContainers);
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
      return tree ? tree.jumpTo(apath, o) : false;
    }

    // persist=false for view changes the user didn't ask for. Jumping to a node has to show the
    // tree, but it's navigation — it shouldn't quietly rewrite which view every future JSON
    // opens in. (The search box has persisted since before the split; left alone here.)
    function setView(v, persist) {
      // Only the large-file path is worth a skeleton — a small tree builds within the frame, and
      // deferring it would just add a flash of skeleton to something that was already instant.
      if (v === "pretty") { if (heavy) buildDeferred(); else renderTree(); }
      bar.setView(v);
      if (v === "pretty") { prettyEl.hidden = false; rawEl.hidden = true; }
      else { prettyEl.hidden = true; rawEl.hidden = false; rawEl.textContent = v === "min" ? minified : original; }
      // search's "no match" bar lives in the scroll container alongside the Raw pane, so it has
      // to know when the tree it describes stops being what's on screen.
      if (search) search.onViewChange(v);
      if (persist !== false) store.set("jk:view", v);
    }

    // Rebuilding the tree strands everything that holds rows from the old one. resetFold and
    // search.reset are not tidiness: without them the Collapse all label lies about a tree
    // that no longer exists, and the match counter keeps reporting hits on detached rows.
    function applySort() {
      bar.setSorted(sorted);
      recompute();
      treeBuilt = false; tree = null; prettyEl.innerHTML = "";
      bar.resetFold();
      if (search) search.reset();
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
    renderStatus();

    search = JK.search.mount(rootEl, {
      scrollEl, getTree, renderTree,
      // persist=false, like every other switch the user didn't ask for by name. Typing in the
      // search box says "find X", not "show me trees from now on" — the tree is the means. Only
      // the view tabs (and nothing else) get to state a preference.
      ensurePretty: () => { if (bar.currentView() !== "pretty") setView("pretty", false); },
      onExpandAll: () => bar.resetFold(),
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
        if (act.dataset.t === "path" && r.dataset.path) crumbEl.textContent = r.dataset.path;
        return;
      }
      const r = e.target.closest(".jk-row");
      if (r && r.dataset.path) crumbEl.textContent = r.dataset.path;
    });

    store.get("jk:sort", (v) => { if (v) { sorted = true; applySort(); } });

    // initial view: large files start in Raw (tree on demand); else saved or Pretty.
    // persist=false: this is our decision, not the user's. Persisting it (shipped behaviour
    // since v0.8.0) means opening one big file silently makes Raw the default for every JSON
    // afterwards — a preference the user never expressed.
    if (heavy) setView("raw", false);
    else store.get("jk:view", (v) => setView(v === "raw" || v === "min" ? v : "pretty"));

    return true;
  }

  // Merge, don't assign. `global.JK = {...}` here would erase the modules loaded before it.
  JK.mountViewer = mountViewer;
  // JK.normalize is set by util.js.
})(typeof window !== "undefined" ? window : globalThis);
