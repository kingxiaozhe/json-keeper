// core.js — shared JSON viewer (content-script takeover + viewer page). window.JK.
//
// Layout: toolbar · breadcrumb · [structure rail | tree] · status bar.
// Features: collapsible tree, per-node hover copy (value / path / subtree),
// real search (highlight + count + jump + auto-expand), manual theme toggle
// (remembered), Pretty/Raw/Min, download, smart rail (scroll-spy, auto-hidden
// for flat JSON), and a large-file guard (tree built on demand). All parsing/
// serializing via JSONBig so big integers stay exact.
(function (global) {
  "use strict";
  const JSONBig = global.JSONBig;
  // esc() for text-node content; escAttr() also neutralizes quotes for use inside
  // double-quoted HTML attributes (without it, a crafted JSON key could break out
  // of a title="" attribute and inject markup — an XSS in the viewed page).
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
  const isContainer = (v) => v && typeof v === "object" && typeof v !== "bigint";
  const humanSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const idKey = (k) => /^[A-Za-z_$][\w$]*$/.test(k);
  const LARGE = 1_000_000; // chars; above this, build the tree on demand to avoid freezing the tab
  const NODE_CAP = 50_000; // nodes; above this, don't auto-build the DOM tree (offer an opt-in instead)

  // linkify(text) — escape `text`, turning http/https URLs into anchors. ONLY
  // http(s) is linked (no javascript:/data: etc.) and the href is attribute-
  // escaped, so a crafted string value can't inject script or break out of the
  // attribute. Non-URL text is plain-escaped exactly as before.
  const URL_RE = /https?:\/\/[^\s"<>]+/g;
  function linkify(text) {
    let out = "", last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
      out += esc(text.slice(last, m.index));
      const url = m[0];
      out += '<a class="jk-link" href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + "</a>";
      last = m.index + url.length;
    }
    return out + esc(text.slice(last));
  }

  // embeddedJSON(s) — if string `s` is itself a JSON object/array (a very common
  // API-payload shape: an escaped JSON blob inside a field), return the parsed
  // container so it can be expanded inline; otherwise null. Cheap first-char/
  // last-char gate avoids parsing ordinary strings; size-capped so a giant
  // string can't stall the tree.
  const EMBED_MAX = 100_000;
  function embeddedJSON(s) {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (t.length < 2 || t.length > EMBED_MAX) return null;
    const a = t[0], z = t[t.length - 1];
    if (!((a === "{" && z === "}") || (a === "[" && z === "]"))) return null;
    try { const v = JSONBig.parse(t); return isContainer(v) ? v : null; }
    catch { return null; }
  }

  // groupDigits(s) — add thousands separators to a plain integer string (keeps a
  // leading minus); returns the input unchanged if it isn't all digits, so it's
  // safe to call on any number/bigint's string form.
  function groupDigits(s) {
    const neg = s[0] === "-", d = neg ? s.slice(1) : s;
    if (!/^\d+$/.test(d)) return s;
    return (neg ? "-" : "") + d.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // epochHint(n) — if `n` plausibly looks like a Unix timestamp (seconds in
  // ~2001–2286, or milliseconds in the same window), return a human-readable
  // UTC string; otherwise null. Tooltip-only, so false positives are harmless.
  function epochHint(n) {
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
    let ms = null;
    if (n >= 1e9 && n < 1e10) ms = n * 1000;       // seconds
    else if (n >= 1e12 && n < 1e13) ms = n;        // milliseconds
    if (ms === null) return null;
    const d = new Date(ms);
    const p = (x, w) => String(x).padStart(w || 2, "0");
    return "Unix time: " + d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
      " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " UTC";
  }

  // markText(scope, q) — wrap each case-insensitive occurrence of `q` (already
  // lowercased) inside <mark class="jk-mark"> within scope's text nodes. It
  // splits TEXT nodes only, never touching element nodes, so syntax-coloring
  // spans, links, and the caret's collapse listener all survive. Existing marks
  // are skipped (clearMarks runs first anyway). Text is collected up front so we
  // don't iterate a list we're mutating.
  function markText(scope, q) {
    if (!q) return;
    const texts = [];
    (function collect(node) {
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) texts.push(n);
        else if (n.nodeType === 1 && !(n.classList && n.classList.contains("jk-mark"))) collect(n);
      });
    })(scope);
    texts.forEach((tn) => {
      const s = tn.nodeValue, low = s.toLowerCase();
      if (!low.includes(q)) return;
      const frag = document.createDocumentFragment();
      let i = 0, idx;
      while ((idx = low.indexOf(q, i)) !== -1) {
        if (idx > i) frag.appendChild(document.createTextNode(s.slice(i, idx)));
        const mark = document.createElement("mark");
        mark.className = "jk-mark";
        mark.textContent = s.slice(idx, idx + q.length);
        frag.appendChild(mark);
        i = idx + q.length;
      }
      if (i < s.length) frag.appendChild(document.createTextNode(s.slice(i)));
      tn.parentNode.replaceChild(frag, tn);
    });
  }

  // clearMarks(scope) — undo markText: replace each mark with its plain text,
  // then normalize so the previously-split text nodes merge back into one. That
  // merge matters: without it a later query spanning an old split boundary
  // wouldn't be found.
  function clearMarks(scope) {
    scope.querySelectorAll(".jk-mark").forEach((m) => m.parentNode.replaceChild(document.createTextNode(m.textContent), m));
    scope.normalize();
  }

  // applyDepth(carets, level) — fold the tree to a given depth: containers at
  // depth >= level collapse, shallower ones open. level = Infinity means "expand
  // all". Each container caret is tagged with caret._depth in buildTree.
  function applyDepth(carets, level) {
    carets.forEach((c) => c._collapse && c._collapse(c._depth >= level));
  }

  // countNodes(v, cap) — total node count of a parsed value, short-circuiting as
  // soon as it passes `cap` (returns cap + 1). Lets us decide whether the full
  // DOM tree is worth building eagerly without paying to count a giant structure.
  function countNodes(v, cap) {
    let n = 0;
    const stack = [v];
    while (stack.length) {
      const cur = stack.pop();
      if (++n > cap) return n;
      if (Array.isArray(cur)) { for (let i = 0; i < cur.length; i++) stack.push(cur[i]); }
      else if (cur && typeof cur === "object" && typeof cur !== "bigint") {
        const keys = Object.keys(cur);
        for (let i = 0; i < keys.length; i++) stack.push(cur[keys[i]]);
      }
    }
    return n;
  }

  const store = {
    get(k, cb) { try { chrome.storage.local.get(k, (r) => cb(r && r[k])); } catch { cb(undefined); } },
    set(k, v) { try { chrome.storage.local.set({ [k]: v }); } catch {} },
  };

  // Strip XSSI guard prefixes ( )]}' , while(1); , for(;;); ) and unwrap JSONP
  // ( callback({...}) ) so real-world API responses parse instead of erroring.
  function normalize(text) {
    let t = String(text).trim();
    t = t.replace(/^(\)\]\}'?,?|while\s*\(1\);?|for\s*\(;;\);?)\s*/, "").trim();
    const m = t.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?\s*$/);
    if (m) { const inner = m[1].trim(); if (/^[[{"]/.test(inner)) return inner; }
    return t;
  }

  function valueHTML(v) {
    if (v === null) return '<span class="jk-null">null</span>';
    const t = typeof v;
    if (t === "bigint") return '<span class="jk-num jk-precise" title="' + escAttr("exact integer (never rounded) · " + groupDigits(v.toString())) + '">' + v.toString() + "</span>";
    if (t === "number") {
      const h = epochHint(v) || (Number.isInteger(v) && Math.abs(v) >= 10000 ? groupDigits(String(v)) : null);
      return '<span class="jk-num"' + (h ? ' title="' + escAttr(h) + '"' : "") + ">" + String(v) + "</span>";
    }
    if (t === "boolean") return '<span class="jk-bool">' + v + "</span>";
    if (t === "string") return '<span class="jk-str">' + linkify(JSONBig.stringify(v)) + "</span>";
    return "";
  }

  // accessor path segment (valid-ish JS): .key for identifiers, ["..."] (JSON-escaped) otherwise
  function childAccessor(parent, key, arr) {
    if (arr) return parent + "[" + key + "]";
    if (idKey(key)) return parent ? parent + "." + key : key;
    return parent + "[" + JSON.stringify(key) + "]";
  }

  function buildTree(value, mount) {
    mount.innerHTML = "";
    const tree = document.createElement("div");
    tree.className = "jk-tree";
    const rows = [], topLevel = [];
    const counts = { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 };
    let line = 1, nodes = 0, maxDepth = 0;

    const tally = (v) => {
      nodes++;
      if (v === null) counts.null++;
      else if (Array.isArray(v)) counts.array++;
      else if (typeof v === "object" && typeof v !== "bigint") counts.object++;
      else if (typeof v === "bigint" || typeof v === "number") counts.number++;
      else counts[typeof v]++;
    };

    function row(depth, inner, crumb, apath, val, actionable) {
      const r = document.createElement("div");
      r.className = "jk-row";
      if (crumb) r.dataset.path = crumb;
      if (apath !== undefined) { r._apath = apath; r._val = val; }
      const g = document.createElement("span");
      g.className = "jk-gutter jk-mono";
      g.textContent = line++;
      const c = document.createElement("span");
      c.className = "jk-content";
      c.innerHTML = '<span class="jk-ind">' + "  ".repeat(depth) + "</span>" + inner;
      r.append(g, c);
      if (actionable) {
        const a = document.createElement("span");
        a.className = "jk-acts";
        a.innerHTML =
          '<button class="jk-act" data-t="copy" title="Copy ' + (isContainer(val) ? "subtree" : "value") + '">⧉</button>' +
          '<button class="jk-act" data-t="path" title="Copy path: ' + escAttr(apath) + '">path</button>';
        r.appendChild(a);
      }
      rows.push(r);
      tree.appendChild(r);
      return r;
    }

    function walk(key, val, depth, isLast, crumb, apath) {
      const comma = isLast ? "" : '<span class="jk-pun">,</span>';
      const keyHTML = key !== null ? '<span class="jk-key">"' + esc(key) + '"</span><span class="jk-pun">: </span>' : "";

      // Render `cval` as a collapsible container. `embedded` flags a value that
      // was a JSON string we parsed for inline display (badge + start collapsed).
      function container(cval, embedded) {
        tally(cval);
        const arr = Array.isArray(cval);
        const entries = arr ? cval.map((v, i) => [i, v]) : Object.entries(cval);
        const open = arr ? "[" : "{", close = arr ? "]" : "}";
        const badge = embedded ? '<span class="jk-embed" title="This value is a JSON string — expanded inline; copy gives the parsed JSON">{ } JSON string</span>' : "";
        const head = row(depth,
          '<span class="jk-caret">▾</span>' + keyHTML + badge + '<span class="jk-pun">' + open + "</span>" +
          '<span class="jk-count">' + entries.length + (arr ? " items" : " keys") + "</span>" +
          '<span class="jk-prev" hidden> … ' + close + comma + "</span>", crumb, apath, cval, true);
        const startIdx = rows.length;
        entries.forEach(([k, v], i) => walk(arr ? null : k, v, depth + 1, i === entries.length - 1,
          crumb + (arr ? "[" + k + "]" : " › " + k), childAccessor(apath, k, arr)));
        row(depth, '<span class="jk-caret jk-leaf">▾</span><span class="jk-pun">' + close + "</span>" + comma);
        const blockRows = rows.slice(startIdx);
        const caret = head.querySelector(".jk-caret"), prev = head.querySelector(".jk-prev"), count = head.querySelector(".jk-count");
        caret._depth = depth;
        if (depth > maxDepth) maxDepth = depth;
        caret._collapse = (on) => { caret.classList.toggle("jk-collapsed", on); blockRows.forEach((r) => (r.style.display = on ? "none" : "")); prev.hidden = !on; count.hidden = on; };
        caret.addEventListener("click", (e) => { e.stopPropagation(); caret._collapse(!caret.classList.contains("jk-collapsed")); });
        if (embedded) caret._collapse(true); // embedded JSON starts folded to keep the view tidy
        if (depth === 1) topLevel.push({ key: arr ? "[" + key + "]" : key, head, n: entries.length });
      }

      if (isContainer(val)) { container(val, false); return; }
      const embedded = embeddedJSON(val);
      if (embedded) { container(embedded, true); return; }

      tally(val);
      const r = row(depth, '<span class="jk-caret jk-leaf">▾</span>' + keyHTML + valueHTML(val) + comma, crumb, apath, val, true);
      if (depth === 1) topLevel.push({ key: key === null ? "·" : key, head: r, leaf: true });
    }

    if (isContainer(value)) {
      tally(value);
      const arr = Array.isArray(value);
      const entries = arr ? value.map((v, i) => [i, v]) : Object.entries(value);
      row(0, '<span class="jk-caret jk-leaf">▾</span><span class="jk-pun">' + (arr ? "[" : "{") + "</span>" +
        '<span class="jk-count">' + entries.length + (arr ? " items" : " keys") + "</span>", "root");
      entries.forEach(([k, v], i) => walk(arr ? null : k, v, 1, i === entries.length - 1,
        arr ? "root[" + k + "]" : "root › " + k, childAccessor("", k, arr)));
      row(0, '<span class="jk-caret jk-leaf">▾</span><span class="jk-pun">' + (arr ? "]" : "}") + "</span>");
    } else {
      tally(value);
      row(0, '<span class="jk-caret jk-leaf">▾</span>' + valueHTML(value), "root", "", value, true);
    }
    mount.appendChild(tree);
    return { topLevel, counts, nodes, maxDepth };
  }

  function applyTheme(rootEl, mode) {
    const set = (el) => { if (!el) return; if (mode === "auto") el.removeAttribute("data-jk-theme"); else el.setAttribute("data-jk-theme", mode); };
    set(rootEl.querySelector(".jk-wrap"));
    set(document.documentElement);
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function mountViewer(rootEl, rawText, opts) {
    opts = opts || {};
    let value;
    const diag = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
    try { value = JSONBig.parse(normalize(rawText), diag); }
    catch (e) {
      if (!opts.showErrors) return false;
      rootEl.innerHTML = '<div class="jk-wrap jk-scope"><div class="jk-error">Not valid JSON: ' + esc(e.message) + "</div></div>";
      return false;
    }

    // Sort-keys (recursive, arrays keep order) toggles a sorted copy used by the
    // tree AND by copy/pretty/min so what you see equals what you copy.
    const sortValue = (v) => {
      if (Array.isArray(v)) return v.map(sortValue);
      if (v && typeof v === "object" && typeof v !== "bigint") {
        const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]); return o;
      }
      return v;
    };
    let sorted = false, displayValue = value, pretty, minified;
    const recompute = () => { displayValue = sorted ? sortValue(value) : value; pretty = JSONBig.stringify(displayValue, 2); minified = JSONBig.stringify(displayValue); };
    recompute();
    const original = (opts.originalText != null ? opts.originalText : rawText).trim();
    const topInfo = isContainer(value) ? (Array.isArray(value) ? value.length + " items" : Object.keys(value).length + " keys") : "value";
    const heavy = rawText.length > LARGE;
    // Even a byte-small doc can be a huge *structure* (e.g. a long array of tiny
    // values); building that many DOM rows is what freezes the tab. Guard on node
    // count so Pretty/search don't auto-build an enormous tree without consent.
    const bigStruct = countNodes(value, NODE_CAP) > NODE_CAP;

    // Correctness report — the moat: surface what other viewers silently get wrong.
    const dupes = [...new Set(diag.dupKeys)];
    const chipHTML = diag.bigInts ? "✓ " + diag.bigInts + " big-ints exact" : "✓ big-ints precise";
    const warns = [];
    if (dupes.length)
      warns.push('<span class="jk-warn" title="JSON spec keeps only the last value of a duplicated key; other viewers drop the rest silently">⚠ ' +
        dupes.length + " duplicate key" + (dupes.length > 1 ? "s" : "") + ": " +
        dupes.slice(0, 4).map((k) => '"' + esc(k) + '"').join(", ") + (dupes.length > 4 ? "…" : "") + " — last value shown</span>");
    if (diag.nonFinite)
      warns.push('<span class="jk-warn" title="A number exceeded the float64 range and became Infinity; valid JSON has no Infinity, so it serializes back to null — a silent data loss other viewers don\'t flag">⚠ ' +
        diag.nonFinite + " number" + (diag.nonFinite > 1 ? "s" : "") + " out of range — shown as null</span>");
    if (diag.precisionLoss)
      warns.push('<span class="jk-warn" title="A float carried more significant digits than a float64 can hold, so the stored value differs from the text you pasted; only integers are kept exact (as big-ints)">⚠ ' +
        diag.precisionLoss + " float" + (diag.precisionLoss > 1 ? "s" : "") + " lost precision</span>");
    const warnHTML = warns.join("");

    rootEl.innerHTML =
      '<div class="jk-wrap jk-scope">' +
        '<div class="jk-bar">' +
          '<button class="jk-btn" data-act="copy"><svg class="jk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy JSON</button>' +
          '<div class="jk-seg"><button class="on" data-act="pretty">Pretty</button><button data-act="raw">Raw</button><button data-act="min">Min</button></div>' +
          '<button class="jk-btn" data-act="fold" style="display:none">⤢ Collapse all</button>' +
          '<select class="jk-skin jk-depth" data-act="depth" title="Expand to a fixed depth" style="display:none"></select>' +
          '<button class="jk-btn" data-act="sort" title="Sort keys A→Z (recursive)">⇅ Sort</button>' +
          '<div class="jk-search"><svg class="jk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>' +
            '<input placeholder="Search keys & values"><span class="jk-find-n" data-find hidden></span>' +
            '<button class="jk-find-b" data-find-prev title="Previous (Shift+Enter)" hidden>↑</button><button class="jk-find-b" data-find-next title="Next (Enter)" hidden>↓</button><kbd>/</kbd></div>' +
          '<button class="jk-btn jk-icon" data-act="dl" title="Download .json">⤓</button>' +
          '<button class="jk-btn jk-icon" data-act="theme" title="Theme: auto">◐</button>' +
          '<select class="jk-skin" data-act="skin" title="Color theme"><option value="default">Default</option><option value="solarized">Solarized</option><option value="monokai">Monokai</option><option value="github">GitHub</option></select>' +
          '<div class="jk-meta"><span class="jk-mono">' + humanSize(rawText.length) + " · " + topInfo + '</span><span class="jk-chip">' + chipHTML + "</span></div>" +
          '<span class="jk-flash" data-flash></span>' +
        "</div>" +
        '<div class="jk-crumb jk-mono" data-crumb>root</div>' +
        '<div class="jk-main">' +
          '<aside class="jk-rail" data-rail hidden></aside>' +
          '<div class="jk-scroll"><div data-pretty></div><pre class="jk-raw jk-mono" data-raw hidden></pre></div>' +
        "</div>" +
        '<div class="jk-status jk-mono" data-status></div>' +
      "</div>";

    const $ = (s) => rootEl.querySelector(s);
    const prettyEl = $("[data-pretty]"), rawEl = $("[data-raw]"), scrollEl = $(".jk-scroll");
    const railEl = $("[data-rail]"), crumbEl = $("[data-crumb]"), statusEl = $("[data-status]");
    const flash = $("[data-flash]"), foldBtn = $('[data-act="fold"]'), depthSel = $('[data-act="depth"]');
    const say = (t) => { flash.textContent = t; setTimeout(() => (flash.textContent = ""), 1500); };
    const carets = () => prettyEl.querySelectorAll(".jk-caret:not(.jk-leaf)");

    statusEl.innerHTML = (heavy || bigStruct)
      ? '<span class="jk-ok">● valid JSON</span>' + warnHTML + '<span class="jk-st">' + humanSize(rawText.length) +
        (bigStruct ? " · over " + groupDigits(String(NODE_CAP)) + " nodes — tree on demand" : " — large file, tree built on demand") +
        '</span><span class="jk-spacer"></span><span class="jk-trust">big integers kept exact · no ads · no telemetry</span>'
      : "";

    // ---- tree (built immediately, or lazily/by-consent for large files) ----
    let treeBuilt = false, forced = false;
    // For an enormous structure, don't auto-build the DOM tree — show a guard with
    // an opt-in. Raw/Min stay fast; building only happens when the user asks.
    function renderBigGuard() {
      prettyEl.innerHTML =
        '<div class="jk-big"><p>This document has a very large structure (over ' + groupDigits(String(NODE_CAP)) +
        ' nodes). Building the full interactive tree may briefly freeze the tab.</p>' +
        '<button class="jk-btn" data-act="force-tree">Render tree anyway</button>' +
        '<p class="jk-big-hint">Raw and Min views stay fast, and big integers are still exact.</p></div>';
      prettyEl.querySelector('[data-act="force-tree"]').addEventListener("click", () => {
        forced = true; treeBuilt = false; prettyEl.innerHTML = "";
        renderTree();
        const q = searchInput.value.trim().toLowerCase(); if (q) runSearch(q);
      });
    }
    function renderTree() {
      if (treeBuilt) return;
      if (bigStruct && !forced) { renderBigGuard(); return; }
      treeBuilt = true;
      const { topLevel, counts, nodes, maxDepth } = buildTree(displayValue, prettyEl);

      const hasNested = topLevel.some((t) => !t.leaf);
      if (hasNested && topLevel.length >= 3) {
        railEl.hidden = false;
        railEl.innerHTML = '<div class="jk-rail-h">STRUCTURE</div>' + topLevel.map((t, i) =>
          '<button class="jk-rail-i" data-i="' + i + '"><span class="jk-rail-k">' + esc(String(t.key)) + "</span>" +
          (t.leaf ? "" : '<span class="jk-rail-n">' + t.n + "</span>") + "</button>").join("");
        railEl.querySelectorAll(".jk-rail-i").forEach((b) => b.addEventListener("click", () => {
          const t = topLevel[+b.dataset.i];
          scrollEl.scrollTop = t.head.offsetTop - 6;
          t.head.classList.add("jk-hit"); setTimeout(() => t.head.classList.remove("jk-hit"), 900);
        }));
        let raf = 0;
        scrollEl.addEventListener("scroll", () => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0; const y = scrollEl.scrollTop + 12; let active = 0;
            topLevel.forEach((t, i) => { if (t.head.offsetTop <= y) active = i; });
            railEl.querySelectorAll(".jk-rail-i").forEach((x, i) => x.classList.toggle("on", i === active));
          });
        });
      }

      const seg = (n, label) => (n ? '<span class="jk-st"><b>' + n + "</b> " + label + "</span>" : "");
      statusEl.innerHTML =
        '<span class="jk-ok">● valid JSON</span>' + warnHTML + '<span class="jk-st">' + nodes + " nodes</span>" +
        seg(counts.object, "obj") + seg(counts.array, "arr") + seg(counts.string, "str") +
        seg(counts.number, "num") + seg(counts.boolean, "bool") + seg(counts.null, "null") +
        '<span class="jk-spacer"></span><span class="jk-trust">big integers kept exact · no ads · no telemetry</span>';

      foldBtn.style.display = carets().length ? "" : "none";

      // Depth control only earns its place when there's nesting deeper than one
      // level; otherwise Collapse-all already covers it.
      if (maxDepth >= 2) {
        let opts = '<option value="all">Depth: all</option>';
        for (let d = 1; d <= maxDepth; d++) opts += '<option value="' + d + '">Depth: ' + d + "</option>";
        depthSel.innerHTML = opts;
        depthSel.value = "all";
        depthSel.style.display = "";
      } else {
        depthSel.style.display = "none";
      }
    }

    // ---- per-node copy (value / path / subtree) + breadcrumb (delegated) ----
    prettyEl.addEventListener("click", async (e) => {
      const act = e.target.closest(".jk-act");
      if (act) {
        e.stopPropagation();
        const r = act.closest(".jk-row");
        let text, label;
        if (act.dataset.t === "path") { text = r._apath; label = "path"; }
        else { const v = r._val; text = typeof v === "string" ? v : isContainer(v) ? JSONBig.stringify(v, 2) : JSONBig.stringify(v); label = isContainer(v) ? "subtree" : "value"; }
        try { await navigator.clipboard.writeText(text); say("Copied " + label + " ✓"); } catch { say("Copy blocked"); }
        if (act.dataset.t === "path" && r.dataset.path) crumbEl.textContent = r.dataset.path;
        return;
      }
      const r = e.target.closest(".jk-row");
      if (r && r.dataset.path) crumbEl.textContent = r.dataset.path;
    });

    // ---- view (pretty|raw|min); Pretty builds the tree lazily ----
    const segBtns = { pretty: $('[data-act="pretty"]'), raw: $('[data-act="raw"]'), min: $('[data-act="min"]') };
    function setView(v) {
      if (v === "pretty") renderTree();
      Object.entries(segBtns).forEach(([k, b]) => b.classList.toggle("on", k === v));
      if (v === "pretty") { prettyEl.hidden = false; rawEl.hidden = true; }
      else { prettyEl.hidden = true; rawEl.hidden = false; rawEl.textContent = v === "min" ? minified : original; }
      store.set("jk:view", v);
    }
    Object.keys(segBtns).forEach((k) => segBtns[k].addEventListener("click", () => setView(k)));

    // ---- collapse all / expand to a chosen depth ----
    // `collapsed` tracks only the all-or-nothing state of the fold button. An
    // intermediate depth leaves the tree partly open, so the button stays
    // "Collapse all" (one click then folds everything) rather than mislabeling.
    let collapsed = false;
    const relabelFold = () => { foldBtn.textContent = collapsed ? "⤡ Expand all" : "⤢ Collapse all"; };
    foldBtn.addEventListener("click", () => {
      collapsed = !collapsed;
      carets().forEach((c) => c._collapse && c._collapse(collapsed));
      relabelFold();
      depthSel.value = collapsed ? "1" : "all";
    });
    depthSel.addEventListener("change", () => {
      applyDepth(carets(), depthSel.value === "all" ? Infinity : Number(depthSel.value));
      collapsed = depthSel.value === "1"; // only a full collapse maps to the toggle's collapsed state
      relabelFold();
    });

    // ---- copy whole / download ----
    $('[data-act="copy"]').addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(pretty); say("Copied valid JSON ✓"); } catch { say("Select & ⌘C to copy"); }
    });
    $('[data-act="dl"]').addEventListener("click", () => { download("data.json", pretty); say("Downloaded ✓"); });

    // ---- theme (auto → light → dark), remembered ----
    const themeBtn = $('[data-act="theme"]');
    const order = ["auto", "light", "dark"], glyph = { auto: "◐", light: "☀", dark: "☾" };
    let theme = "auto";
    const renderTheme = () => { themeBtn.textContent = glyph[theme]; themeBtn.title = "Theme: " + theme; applyTheme(rootEl, theme); };
    themeBtn.addEventListener("click", () => { theme = order[(order.indexOf(theme) + 1) % 3]; renderTheme(); store.set("jk:theme", theme); });
    store.get("jk:theme", (t) => { if (t) { theme = t; renderTheme(); } });
    renderTheme();

    // ---- sort keys (recursive), remembered ----
    const sortBtn = $('[data-act="sort"]');
    function applySort() {
      sortBtn.classList.toggle("on", sorted);
      recompute();
      treeBuilt = false; prettyEl.innerHTML = "";
      const cur = Object.keys(segBtns).find((k) => segBtns[k].classList.contains("on")) || "pretty";
      setView(cur);
    }
    sortBtn.addEventListener("click", () => { sorted = !sorted; store.set("jk:sort", sorted); applySort(); });
    store.get("jk:sort", (v) => { if (v) { sorted = true; applySort(); } });

    // ---- color skin (retints syntax colors over the light/dark base), remembered ----
    const skinSel = $('[data-act="skin"]');
    const applySkin = (s) => {
      const set = (el) => { if (!el) return; if (s === "default") el.removeAttribute("data-jk-skin"); else el.setAttribute("data-jk-skin", s); };
      set(rootEl.querySelector(".jk-wrap")); set(document.documentElement);
    };
    skinSel.addEventListener("change", () => { applySkin(skinSel.value); store.set("jk:skin", skinSel.value); });
    store.get("jk:skin", (s) => { if (s) { skinSel.value = s; applySkin(s); } });

    // ---- search (highlight + count + jump + auto-expand) ----
    const searchInput = $(".jk-search input"), findN = $("[data-find]"), prevB = $("[data-find-prev]"), nextB = $("[data-find-next]");
    let matches = [], cur = -1;
    const showFind = (on) => [findN, prevB, nextB].forEach((el) => (el.hidden = !on));
    function goto(i) {
      if (!matches.length) return;
      cur = (i + matches.length) % matches.length;
      matches.forEach((r) => r.classList.remove("jk-current"));
      const r = matches[cur]; r.classList.add("jk-current");
      scrollEl.scrollTop = r.offsetTop - scrollEl.clientHeight / 2;
      findN.textContent = cur + 1 + "/" + matches.length;
    }
    function runSearch(q) {
      renderTree(); // search needs the tree
      if (segBtns.pretty && !segBtns.pretty.classList.contains("on")) setView("pretty");
      clearMarks(prettyEl); // drop highlights from the previous query
      const rows = prettyEl.querySelectorAll(".jk-row");
      rows.forEach((r) => r.classList.remove("jk-dim", "jk-current"));
      if (!q) { matches = []; cur = -1; showFind(false); return; }
      carets().forEach((c) => c._collapse && c._collapse(false));
      // Single pass: partition rows into matches (highlighted) and the rest
      // (dimmed) without a separate O(rows × matches) membership scan.
      matches = [];
      rows.forEach((r) => {
        if (r.textContent.toLowerCase().includes(q)) {
          matches.push(r);
          const c = r.querySelector(".jk-content");
          if (c) markText(c, q);
        } else r.classList.add("jk-dim");
      });
      showFind(true);
      findN.textContent = matches.length ? "1/" + matches.length : "0";
      cur = -1; if (matches.length) goto(0);
    }
    // Debounce keystrokes: runSearch scans every row, so firing it on each
    // keypress jitters on large trees. ~120ms feels instant but coalesces typing.
    let searchT = 0;
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      clearTimeout(searchT);
      searchT = setTimeout(() => runSearch(q), 120);
    });
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); goto(cur + (e.shiftKey ? -1 : 1)); } });
    nextB.addEventListener("click", () => goto(cur + 1));
    prevB.addEventListener("click", () => goto(cur - 1));
    rootEl.addEventListener("keydown", (e) => { if (e.key === "/" && document.activeElement !== searchInput) { e.preventDefault(); searchInput.focus(); } });

    // initial view: large files / huge structures start in Raw (tree on demand);
    // else saved or Pretty
    if (heavy || bigStruct) setView("raw");
    else store.get("jk:view", (v) => setView(v && segBtns[v] ? v : "pretty"));

    return true;
  }

  // mountViewer/normalize are the public surface; the rest is exposed for tests.
  global.JK = { mountViewer, normalize, linkify, epochHint, embeddedJSON, groupDigits, buildTree, markText, clearMarks, applyDepth, countNodes };
})(typeof window !== "undefined" ? window : globalThis);
