// table.js — array-of-objects as a table. Loaded after tree.js (reuses valueHTML/childAccessor)
// and jsonpath.js; mounted by core when the view is Table.
//
// The reason this exists beyond "a table": a missing field and a field whose value is null are
// DIFFERENT facts about an API response, and every other viewer renders both as blank. Conflating
// them makes people misread what the server actually returned — so this draws them apart (F-104).
//
// Everything from the JSON is untrusted: cell values AND column headers (headers are the user's
// keys, which feel like "our UI text" and are the easiest place to forget to escape — that is the
// XSS door). Text positions go through esc(), attribute positions through escAttr().
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { esc, escAttr, isContainer } = JK.util;
  const valueHTML = JK.tree.valueHTML;
  const childAccessor = JK.tree.childAccessor;

  const isPlainObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const MAX_ROWS = 1000;

  // Table only makes sense for a non-empty array of plain objects. Anything else disables the
  // segment with a specific reason (F-106) rather than rendering something misleading.
  function canRender(value) {
    if (!Array.isArray(value)) return { ok: false, reason: "not an array" };
    if (value.length === 0) return { ok: false, reason: "empty array" };
    if (!value.every(isPlainObj)) return { ok: false, reason: "some elements aren't objects" };
    return { ok: true };
  }

  // Column = union of every row's keys, in first-appearance order. Not sorted: reordering columns
  // is a data-presentation change the user didn't ask for, and ⇅ Sort is where that lives.
  function columns(arr) {
    const cols = [], seen = new Set();
    for (const row of arr) for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return cols;
  }

  function cellHTML(row, col, apath) {
    if (!has(row, col)) {
      // MISSING — the moat point. Faint em dash + a tooltip that says the field isn't there,
      // deliberately unlike the null cell below.
      return '<td class="jk-td jk-missing" title="' + escAttr("no “" + col + "” field on this record") + '">—</td>';
    }
    const v = row[col];
    if (isContainer(v)) {
      // Nested value: a chip, not a flattened column (F-107). T-106 makes it open a subtree.
      const label = Array.isArray(v) ? "[" + v.length + "]" : "{…}";
      return '<td class="jk-td"><button class="jk-cell-nested" data-apath="' + escAttr(apath) + '">' + esc(label) + "</button></td>";
    }
    // Scalars (incl. null and bigint) reuse the tree's valueHTML so colour + precision match.
    return '<td class="jk-td" data-apath="' + escAttr(apath) + '">' + valueHTML(v) + "</td>";
  }

  // base is the accessor path of the array itself ("" when the whole doc is the array). Cell apath
  // = base[i].col, identical to what the tree would give the same node — so jumpTo lands right.
  function tableHTML(arr, base) {
    const cols = columns(arr);
    const shown = Math.min(arr.length, MAX_ROWS);
    let h = '<table class="jk-table"><thead><tr><th class="jk-th jk-th-idx">#</th>';
    for (const c of cols) h += '<th class="jk-th">' + esc(c) + "</th>";
    h += "</tr></thead><tbody>";
    for (let i = 0; i < shown; i++) {
      const row = arr[i];
      const rowBase = childAccessor(base, i, true);
      h += '<tr><td class="jk-td jk-td-idx">' + i + "</td>";
      for (const c of cols) h += cellHTML(row, c, childAccessor(rowBase, c, false));
      h += "</tr>";
    }
    h += "</tbody></table>";
    if (arr.length > MAX_ROWS) {
      // Honest truncation, not silent. No pagination/virtual scroll here — that's feature 5's
      // range, and doing a second long-list strategy would just fork.
      h += '<div class="jk-table-more">Showing first ' + MAX_ROWS + " of " + arr.length +
        " rows — " + (arr.length - MAX_ROWS) + " more not shown</div>";
    }
    return h;
  }

  function mount(el, arr, ctx) {
    const base = (ctx && ctx.base) || "";
    el.innerHTML = tableHTML(arr, base);
    const onCell = (e) => {
      const cell = e.target.closest("[data-apath]");
      if (cell && ctx && ctx.onJump) ctx.onJump(cell.dataset.apath);
    };
    el.addEventListener("click", onCell);
    return { destroy() { el.removeEventListener("click", onCell); el.innerHTML = ""; } };
  }

  JK.table = { canRender, columns, mount };
})(typeof window !== "undefined" ? window : globalThis);
