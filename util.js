// util.js — shared helpers with no DOM and no chrome API of their own (beyond `store`).
// Split out of core.js so the escaping helpers have one home instead of a copy per module,
// and so normalize() can be had without the whole viewer stack. Note popup does NOT load
// this yet — it will when it starts validating pastes in place (T-008); until then, don't
// write JK.normalize in popup.js expecting it to resolve.
//
// Namespace rule for every JK module: MERGE, never assign. `global.JK = {...}` would wipe
// whatever loaded first, and content.js's `!window.JK` guard would still pass — the failure
// surfaces later as `JK.tree is undefined` with the page already committed.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});

  // esc() for text-node content; escAttr() also neutralizes quotes for use inside
  // double-quoted HTML attributes (without it, a crafted JSON key could break out
  // of a title="" attribute and inject markup — an XSS in the viewed page).
  // Quotes are deliberately left alone by esc(): in text position they are harmless,
  // and keeping the two functions distinct is what makes the attribute case explicit.
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

  const isContainer = (v) => v && typeof v === "object" && typeof v !== "bigint";
  const humanSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const idKey = (k) => /^[A-Za-z_$][\w$]*$/.test(k);

  // Number.isInteger(1n) is false — it does not throw, it just answers wrong for the one
  // value this project exists to handle. Anything routing big integers by isInteger sends
  // them down the float path and loses the precision we went to such lengths to keep.
  const isIntegerLike = (v) => typeof v === "bigint" || Number.isInteger(v);

  // Above this the viewer opens in Raw and builds the tree only when asked. Shared because it's
  // a promise across modules, not a local tuning knob: popup tells you "this opens in raw mode",
  // core decides whether it actually does. Two copies drifting apart means the popup lies.
  const LARGE = 1_000_000; // chars (UTF-16 code units, same unit humanSize reports)

  const store = {
    get(k, cb) { try { chrome.storage.local.get(k, (r) => cb(r && r[k])); } catch { cb(undefined); } },
    set(k, v) { try { chrome.storage.local.set({ [k]: v }); } catch {} },
  };

  // Strip XSSI guard prefixes ( )]}' , while(1); , for(;;); ) and unwrap JSONP
  // ( callback({...}) ) so real-world API responses parse instead of erroring.
  // Lives here rather than in core because content.js uses it as the takeover gate and
  // popup needs it before it can tell a hostile paste from a guarded API response.
  function normalize(text) {
    let t = String(text).trim();
    t = t.replace(/^(\)\]\}'?,?|while\s*\(1\);?|for\s*\(;;\);?)\s*/, "").trim();
    const m = t.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?\s*$/);
    if (m) { const inner = m[1].trim(); if (/^[[{"]/.test(inner)) return inner; }
    return t;
  }

  // Both paste surfaces (popup and the viewer page) own a box and a button that does nothing
  // useful with an empty box. A live button that silently ignores you IS the complaint this
  // product is built against, so neither surface may ship one — and the two must say the same
  // thing when they refuse, which is why the wording lives here rather than in each of them.
  // (popup and viewer each grew their own theme code once; the tokens drifted within a version.)
  const EMPTY_HINT = "Paste some JSON first";
  function guardEmpty(input, btn) {
    const empty = !input.value.trim();
    btn.disabled = empty;
    btn.title = empty ? EMPTY_HINT : "";
    return !empty;
  }

  JK.util = { esc, escAttr, isContainer, humanSize, idKey, isIntegerLike, store, normalize, LARGE, guardEmpty, EMPTY_HINT };
  JK.normalize = normalize; // content.js and the viewer page reach for it at the top level
})(typeof window !== "undefined" ? window : globalThis);
