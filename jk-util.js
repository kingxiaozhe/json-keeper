// jk-util.js — pure, DOM-free value helpers shared by the rendering engine.
// These have no dependency on the DOM or on core.js state (only on JSONBig), so
// they live apart from core.js: smaller units, each independently unit-tested,
// and safe to reuse anywhere. Loaded after jsonbig.js, before core.js. Exposed
// as window.JKUtil; core.js pulls them into scope and re-exports the public ones
// on window.JK.
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

  // embeddedJSON(s[, diag]) — if string `s` is itself a JSON object/array (a very
  // common API-payload shape: an escaped JSON blob inside a field), return the
  // parsed container so it can be expanded inline; otherwise null. Cheap first-
  // char/last-char gate avoids parsing ordinary strings; size-capped so a giant
  // string can't stall the tree. `diag` (optional) collects the inner document's
  // diagnostics — big-int counts, duplicate keys — so the correctness report
  // covers embedded JSON too, not just the outer document.
  const EMBED_MAX = 100_000;
  function embeddedJSON(s, diag) {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (t.length < 2 || t.length > EMBED_MAX) return null;
    const a = t[0], z = t[t.length - 1];
    if (!((a === "{" && z === "}") || (a === "[" && z === "]"))) return null;
    // Parse into a scratch collector and merge only on success, so a string that
    // fails halfway through can't leave partial counts in the caller's diag.
    const scratch = diag ? { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 } : undefined;
    try {
      const v = JSONBig.parse(t, scratch);
      if (!isContainer(v)) return null;
      if (diag) {
        diag.dupKeys.push(...scratch.dupKeys);
        diag.bigInts += scratch.bigInts;
        diag.nonFinite += scratch.nonFinite;
        diag.precisionLoss += scratch.precisionLoss;
      }
      return v;
    } catch { return null; }
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

  // posToLineCol(text, pos) — 1-based line & column for a character offset, so a
  // parse error at "position N" can be shown as "line L, col C" and jumped to.
  function posToLineCol(text, pos) {
    pos = Math.max(0, Math.min(pos | 0, text.length));
    let line = 1, last = -1;
    for (let i = 0; i < pos; i++) if (text[i] === "\n") { line++; last = i; }
    return { line, col: pos - last };
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
      else if (isContainer(cur)) {
        const keys = Object.keys(cur);
        for (let i = 0; i < keys.length; i++) stack.push(cur[keys[i]]);
      }
    }
    return n;
  }

  // toCSV(value) — convert a top-level ARRAY to CSV, or return null when CSV
  // doesn't apply (non-array / empty). An array of objects becomes a table whose
  // columns are the union of keys in first-seen order; anything else becomes a
  // single "value" column. Cells are RFC-4180 quoted only when they contain a
  // comma, quote, or newline; nested objects/arrays are emitted as compact JSON,
  // and BigInt keeps its exact digits.
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    let s;
    if (typeof v === "bigint") s = v.toString();
    else if (typeof v === "object") s = JSONBig.stringify(v);
    else s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(value) {
    if (!Array.isArray(value) || value.length === 0) return null;
    const isRow = (v) => isContainer(v) && !Array.isArray(v);
    if (value.every(isRow)) {
      const cols = [], seen = new Set();
      value.forEach((row) => Object.keys(row).forEach((k) => { if (!seen.has(k)) { seen.add(k); cols.push(k); } }));
      const lines = [cols.map(csvCell).join(",")];
      value.forEach((row) => lines.push(cols.map((c) => csvCell(row[c])).join(",")));
      return lines.join("\r\n");
    }
    return ["value"].concat(value.map(csvCell)).join("\r\n");
  }

  global.JKUtil = { esc, escAttr, isContainer, humanSize, idKey, linkify, embeddedJSON, groupDigits, epochHint, posToLineCol, countNodes, toCSV };
})(typeof window !== "undefined" ? window : globalThis);
