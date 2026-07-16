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

    mount.innerHTML = "";
    const tree = document.createElement("div");
    tree.className = "jk-tree";
    const rows = [], topLevel = [], carets = [];
    const byPath = new Map();
    const counts = { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 };
    let line = 1, nodes = 0;

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
          '<span class="jk-count">' + entries.length + (arr ? " items" : " keys") + "</span>" +
          '<span class="jk-prev" hidden> … ' + close + comma + "</span>", crumb, apath, val, true);
        const startIdx = rows.length;
        entries.forEach(([k, v], i) => walk(arr ? null : k, v, depth + 1, i === entries.length - 1,
          crumb + (arr ? "[" + k + "]" : " › " + k), childAccessor(apath, k, arr)));
        row(depth, '<span class="jk-caret jk-leaf">▾</span><span class="jk-pun">' + close + "</span>" + comma);
        const blockRows = rows.slice(startIdx);
        const caret = head.querySelector(".jk-caret"), prev = head.querySelector(".jk-prev"), count = head.querySelector(".jk-count");
        caret._collapse = (on) => { caret.classList.toggle("jk-collapsed", on); blockRows.forEach((r) => (r.style.display = on ? "none" : "")); prev.hidden = !on; count.hidden = on; };
        caret._depth = depth;
        carets.push(caret);
        caret.addEventListener("click", (e) => { e.stopPropagation(); caret._collapse(!caret.classList.contains("jk-collapsed")); });
        if (depth === 1) topLevel.push({ key: arr ? "[" + key + "]" : key, head, n: entries.length });
      } else {
        const r = row(depth, '<span class="jk-caret jk-leaf">▾</span>' + keyHTML + valueHTML(val) + comma, crumb, apath, val, true);
        if (depth === 1) topLevel.push({ key: key === null ? "·" : key, head: r, leaf: true });
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
        '<span class="jk-count">' + entries.length + (arr ? " items" : " keys") + "</span>", "root", basePath, value, false);
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

    const setAll = (on) => carets.forEach((c) => c._collapse(on));

    return {
      mount, rows, topLevel, counts, nodes, byPath,
      hasContainers: carets.length > 0,
      expandAll: () => setAll(false),
      collapseAll: () => setAll(true),
      // Expand every ancestor of a row, so a jump target inside a collapsed block is actually
      // on screen. Ancestors are the carets above it with a smaller depth — cheap to find by
      // walking back through rows rather than threading parent links through the build.
      expandTo(rowEl) {
        const idx = rows.indexOf(rowEl);
        if (idx < 0) return;
        let want = rowEl._depth;
        for (let k = idx; k >= 0 && want > 0; k--) {
          const c = rows[k].querySelector(".jk-caret");
          if (c && c._collapse && rows[k]._depth < want) { c._collapse(false); want = rows[k]._depth; }
        }
      },
      destroy() { mount.innerHTML = ""; },
    };
  }

  JK.tree = { build, valueHTML, childAccessor };
})(typeof window !== "undefined" ? window : globalThis);
