// tree.js — the collapsible JSON tree. Split out of core.js; loaded after util.js.
//
// build() returns an INSTANCE handle, not bare data: the viewer runs more than one tree at
// once (query results, a nested-cell subtree, and Diff's two panes), so anything module-level
// would act on whichever tree happened to be built last.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const JSONBig = global.JSONBig;
  const { esc, escAttr, isContainer, idKey } = JK.util;

  function valueHTML(v) {
    if (v === null) return '<span class="jk-null">null</span>';
    const t = typeof v;
    if (t === "bigint") return '<span class="jk-num jk-precise" title="kept as an exact integer — never rounded to a float">' + v.toString() + "</span>";
    if (t === "number") return '<span class="jk-num">' + String(v) + "</span>";
    if (t === "boolean") return '<span class="jk-bool">' + v + "</span>";
    if (t === "string") return '<span class="jk-str">' + esc(JSONBig.stringify(v)) + "</span>";
    return "";
  }

  // accessor path segment (valid-ish JS): .key for identifiers, ["..."] (JSON-escaped) otherwise
  function childAccessor(parent, key, arr) {
    if (arr) return parent + "[" + key + "]";
    if (idKey(key)) return parent ? parent + "." + key : key;
    return parent + "[" + JSON.stringify(key) + "]";
  }

  // jsonbig reports duplicate positions as neutral key trails (["users",0,"id"]); accessor
  // strings are this module's format, so the conversion belongs here rather than at the call
  // site. Numbers only ever come from array indices — object keys arrive from the parser's
  // string(), so {"0":1} trails as the string "0" and renders as ["0"], not [0].
  const trailToPath = (trail) =>
    trail.reduce((acc, k) => childAccessor(acc, k, typeof k === "number"), "");

  // build(value, mount, { basePath, onCrumb }) -> instance handle
  //
  // basePath prefixes every accessor path. Query results are a synthetic array whose members
  // live at users[0].email and such in the real document; without a base the rows would claim
  // to be [0] and [1], so "copy path" would hand back a lie and jumpTo would land on the root
  // array's first element — a real node, just the wrong one.
  function build(value, mount, opts) {
    opts = opts || {};
    const basePath = opts.basePath || "";
    const onCrumb = opts.onCrumb;
    const scrollEl = opts.scrollEl;
    // Accessor paths whose row had a duplicated key. The status bar can only say how many and
    // what they were called; in a thousand-line document that isn't something you can act on.
    // Survives ⇅ Sort because it keys on path, not on object identity — sorting rebuilds the
    // values but a key's path is the same either way.
    const dupSet = opts.dupPaths ? new Set(opts.dupPaths) : null;

    mount.innerHTML = "";
    const tree = document.createElement("div");
    tree.className = "jk-tree";
    const rows = [], topLevel = [], carets = [];
    const byPath = new Map();
    const counts = { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 };
    let line = 1, nodes = 0;
    // Suppresses the re-hide pass during expandAll/collapseAll, where every caret is being set
    // anyway and the pass would only fight the loop.
    let bulk = false;
    const reassertCollapsed = () =>
      carets.forEach((c) => { if (c.classList.contains("jk-collapsed")) c._collapse(true); });

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
      r._depth = depth;
      if (crumb) r.dataset.path = crumb;
      if (apath !== undefined) {
        r._apath = apath;
        r._val = val;
        byPath.set(apath, r); // closing rows pass no apath, so a container maps to its head row
      }
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

    // "0 keys" reads exactly like "8 keys" — same treatment, so an empty container is hard to
    // tell from a render that failed. Say it in words instead. Not as its own row: rows go into
    // `rows`, which search matches against, and a search for "empty" would then hit a line that
    // isn't data.
    const countHTML = (n, arr) =>
      n === 0
        ? '<span class="jk-count jk-empty">' + (arr ? "empty array" : "empty object") + "</span>"
        : '<span class="jk-count">' + n + (arr ? " items" : " keys") + "</span>";

    // The spec says a repeated key keeps the last value and drops the rest, silently. Every
    // other viewer lets that happen quietly; saying so on the row itself is the point.
    const dupTag = (apath) =>
      dupSet && dupSet.has(apath)
        ? '<span class="jk-dup" title="This key appeared more than once in the same object. JSON keeps the last value and drops the rest — this is the one that survived.">⚠ duplicate key</span>'
        : "";

    function walk(key, val, depth, isLast, crumb, apath) {
      tally(val);
      const comma = isLast ? "" : '<span class="jk-pun">,</span>';
      const keyHTML = key !== null ? '<span class="jk-key">"' + esc(key) + '"</span><span class="jk-pun">: </span>' : "";
      if (isContainer(val)) {
        const arr = Array.isArray(val);
        const entries = arr ? val.map((v, i) => [i, v]) : Object.entries(val);
        const open = arr ? "[" : "{", close = arr ? "]" : "}";
        const head = row(depth,
          '<span class="jk-caret">▾</span>' + keyHTML + '<span class="jk-pun">' + open + "</span>" +
          countHTML(entries.length, arr) +
          '<span class="jk-prev" hidden> … ' + close + comma + "</span>" + dupTag(apath), crumb, apath, val, true);
        const startIdx = rows.length;
        entries.forEach(([k, v], i) => walk(arr ? null : k, v, depth + 1, i === entries.length - 1,
          crumb + (arr ? "[" + k + "]" : " › " + k), childAccessor(apath, k, arr)));
        row(depth, '<span class="jk-caret jk-leaf">▾</span><span class="jk-pun">' + close + "</span>" + comma);
        const blockRows = rows.slice(startIdx);
        const caret = head.querySelector(".jk-caret"), prev = head.querySelector(".jk-prev"), count = head.querySelector(".jk-count");
        caret._collapse = (on) => {
          caret.classList.toggle("jk-collapsed", on);
          blockRows.forEach((r) => (r.style.display = on ? "none" : ""));
          prev.hidden = !on;
          count.hidden = on;
          // blockRows is every descendant, so expanding also un-hides rows sitting inside
          // blocks that are themselves still collapsed — a caret claiming to be shut with its
          // contents on display. Put those back.
          if (!on && !bulk) reassertCollapsed();
        };
        caret._depth = depth;
        carets.push(caret);
        caret.addEventListener("click", (e) => { e.stopPropagation(); caret._collapse(!caret.classList.contains("jk-collapsed")); });
        if (depth === 1) topLevel.push({ key: arr ? "[" + key + "]" : key, head, n: entries.length, apath });
      } else {
        const r = row(depth, '<span class="jk-caret jk-leaf">▾</span>' + keyHTML + valueHTML(val) + comma + dupTag(apath), crumb, apath, val, true);
        if (depth === 1) topLevel.push({ key: key === null ? "·" : key, head: r, leaf: true, apath });
      }
    }

    if (isContainer(value)) {
      tally(value);
      const arr = Array.isArray(value);
      const entries = arr ? value.map((v, i) => [i, v]) : Object.entries(value);
      // The container root carries basePath as its own accessor. It used to pass no apath at
      // all, so the root row had none while a scalar root did — and a validator reporting a
      // missing top-level key had no row to point at.
      row(0, '<span class="jk-caret jk-leaf">▾</span><span class="jk-pun">' + (arr ? "[" : "{") + "</span>" +
        countHTML(entries.length, arr), "root", basePath, value, false);
      entries.forEach(([k, v], i) => walk(arr ? null : k, v, 1, i === entries.length - 1,
        arr ? "root[" + k + "]" : "root › " + k, childAccessor(basePath, k, arr)));
      row(0, '<span class="jk-caret jk-leaf">▾</span><span class="jk-pun">' + (arr ? "]" : "}") + "</span>");
    } else {
      tally(value);
      row(0, '<span class="jk-caret jk-leaf">▾</span>' + valueHTML(value), "root", basePath, value, true);
    }
    mount.appendChild(tree);

    if (onCrumb) {
      tree.addEventListener("click", (e) => {
        const r = e.target.closest && e.target.closest(".jk-row");
        if (r && r.dataset.path) onCrumb(r.dataset.path);
      });
    }

    const setAll = (on) => { bulk = true; carets.forEach((c) => c._collapse(on)); bulk = false; };

    // Expand every ancestor of a row, so a jump target inside a collapsed block is actually on
    // screen. Ancestors are the carets above it with a smaller depth — cheap to find by walking
    // back through rows rather than threading parent links through the build.
    function expandTo(rowEl) {
      const idx = rows.indexOf(rowEl);
      if (idx < 0) return;
      let want = rowEl._depth;
      for (let k = idx; k >= 0 && want > 0; k--) {
        const c = rows[k].querySelector(".jk-caret");
        if (c && c._collapse && rows[k]._depth < want) { c._collapse(false); want = rows[k]._depth; }
      }
    }

    // jumpTo(apath) — scroll to a node and flag it.
    //
    // The rail's older `scrollTop = head.offsetTop - 6` only ever worked because its targets are
    // top-level rows, which are never hidden. An arbitrary node can sit inside a collapsed
    // block, and a display:none row reports offsetTop 0 — so without expanding first, a jump
    // lands at the top of the page with the highlight on something invisible. The rail now
    // routes through here too, so there is one implementation rather than two.
    //
    // align "center" suits an arbitrary node; "top" preserves the rail's original framing.
    function jumpTo(apath, o) {
      const row = byPath.get(apath);
      if (!row) return false;
      expandTo(row);
      if (scrollEl) {
        const top = (o && o.align === "top")
          ? row.offsetTop - 6
          : row.offsetTop - scrollEl.clientHeight / 2;
        scrollEl.scrollTop = Math.max(0, top);
      }
      row.classList.add("jk-hit");
      setTimeout(() => row.classList.remove("jk-hit"), 900);
      return true;
    }

    return {
      mount, rows, topLevel, counts, nodes, byPath,
      hasContainers: carets.length > 0,
      expandAll: () => setAll(false),
      collapseAll: () => setAll(true),
      expandTo,
      jumpTo,
      destroy() { mount.innerHTML = ""; },
    };
  }

  JK.tree = { build, valueHTML, childAccessor, trailToPath };
})(typeof window !== "undefined" ? window : globalThis);
