// jsonpath.js — a hand-written JSONPath subset for the query bar. Loaded after tree.js
// (it reuses childAccessor/trailToPath) and util.js (idKey), before the UI modules.
//
// Why hand-written: security.md forbids eval / new Function, and a query language is the classic
// place people reach for them. There is no compiled expression here — the parser builds a small
// step list and evalPath walks the data by reference. Values are NEVER passed through Number() /
// parseInt / JSON.parse, so a BigInt in the data comes out of a query exactly as it went in;
// the only numbers we parse are indices from the *expression* string, which is not user data in
// the tainted sense (it's what the user typed into the query box).
//
// Supported (first version): $  .key  ['key']  ..key  [*]  .*  [n]  [-n]  [a:b]  [a,b]  ['a','b']
// Not supported: filter ?(...) and script () — evalPath never sees them; parse() returns a
// specific "filter not supported" error rather than a bare syntax error, so the query bar can
// say something useful.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { idKey } = JK.util;
  const trailToPath = JK.tree.trailToPath;   // trail (string|number)[] -> accessor apath

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const isArr = Array.isArray;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ---- parse: expression string -> { ok, ast:{steps} } | { ok:false, error:{msg,pos} } ----

  function parse(expr) {
    const s = String(expr);
    let i = 0;
    const err = (msg, pos) => ({ ok: false, error: { msg, pos: pos == null ? i : pos } });

    if (s[i] !== "$") return err("Path must start with $", 0);
    i++;

    const steps = [];
    while (i < s.length) {
      const c = s[i];
      if (c === ".") {
        if (s[i + 1] === ".") {
          // Recursive descent. `..` is a descendant-or-self step (RFC 9535): it emits the current
          // node AND every descendant, then the following selector applies. Modelling it that way
          // — rather than folding the child into the descent — is what makes $..[0] include the
          // root's own [0], not just its descendants'. ..name / ..* / ..['k'] all decompose into
          // descend + a normal step.
          i += 2;
          steps.push({ op: "descend" });
          if (s[i] === "*") { steps.push({ op: "wild" }); i++; }
          else if (s[i] === "[") { /* bracket becomes the next step */ }
          else {
            const name = readName(s, i);
            if (!name.length) return err("Expected a name after ..", i);
            steps.push({ op: "child", name });
            i += name.length;
          }
        } else {
          i++;
          if (s[i] === "*") { steps.push({ op: "wild" }); i++; }
          else {
            const name = readName(s, i);
            if (!name.length) return err("Expected a name after .", i);
            steps.push({ op: "child", name });
            i += name.length;
          }
        }
      } else if (c === "[") {
        const r = parseBracket(s, i);
        if (!r.ok) return r;
        steps.push(r.step);
        i = r.next;
      } else {
        return err('Unexpected "' + c + '" — expected . or [', i);
      }
    }
    return { ok: true, ast: { steps } };
  }

  // A bare name after . or .. — identifier-ish, up to the next . or [ or end.
  function readName(s, i) {
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[" && s[j] !== "]") j++;
    return s.slice(i, j);
  }

  // parseBracket: s[start] === "[". Returns { ok, step, next } | { ok:false, error }.
  function parseBracket(s, start) {
    let i = start + 1;
    const err = (msg, pos) => ({ ok: false, error: { msg, pos: pos == null ? i : pos } });
    const skipWs = () => { while (s[i] === " ") i++; };
    skipWs();

    if (s[i] === "?") return err("Filter expressions ?() are not supported yet", i);
    if (s[i] === "*") { i++; skipWs(); if (s[i] !== "]") return err("Expected ] after *", i); return { ok: true, step: { op: "wild" }, next: i + 1 }; }

    // quoted keys: 'a' | "a" , possibly a union 'a','b'
    if (s[i] === "'" || s[i] === '"') {
      const keys = [];
      for (;;) {
        const q = readQuoted(s, i);
        if (!q.ok) return err(q.msg, i);
        keys.push({ kind: "name", name: q.value });
        i = q.next; skipWs();
        if (s[i] === ",") { i++; skipWs(); continue; }
        break;
      }
      if (s[i] !== "]") return err("Expected ] after key", i);
      const step = keys.length === 1 ? { op: "child", name: keys[0].name } : { op: "union", keys };
      return { ok: true, step, next: i + 1 };
    }

    // numeric: index | slice | index-union. Read the raw body up to ].
    let j = i;
    while (j < s.length && s[j] !== "]") j++;
    if (s[j] !== "]") return err("Unclosed [", start);
    const body = s.slice(i, j).trim();
    const next = j + 1;
    if (!body.length) return err("Empty []", i);

    if (body.indexOf(":") >= 0) {
      const parts = body.split(":");
      if (parts.length !== 2) return err("Bad slice (want [a:b])", i);
      const start2 = parseSliceInt(parts[0]);
      const end2 = parseSliceInt(parts[1]);
      if (start2 === undefined || end2 === undefined) return err("Slice bounds must be integers", i);
      return { ok: true, step: { op: "slice", start: start2, end: end2 }, next };
    }
    if (body.indexOf(",") >= 0) {
      const keys = [];
      for (const part of body.split(",")) {
        const n = parseIntStrict(part.trim());
        if (n === undefined) return err("Index union must be integers", i);
        keys.push({ kind: "index", i: n });
      }
      return { ok: true, step: { op: "union", keys }, next };
    }
    const n = parseIntStrict(body);
    if (n === undefined) return err('Unquoted key — use ["' + body + '"]', i);
    return { ok: true, step: { op: "index", i: n }, next };
  }

  // "" -> null (open slice bound); "3"/"-1" -> number; anything else -> undefined
  function parseSliceInt(t) {
    t = t.trim();
    if (t === "") return null;
    return parseIntStrict(t);
  }
  // strict integer (optional leading -), else undefined. Not parseInt: "3x" must fail.
  function parseIntStrict(t) {
    if (!/^-?\d+$/.test(t)) return undefined;
    return Number(t);
  }

  function readQuoted(s, i) {
    const quote = s[i];
    let j = i + 1, out = "";
    while (j < s.length) {
      const c = s[j];
      if (c === "\\") { out += s[j + 1] || ""; j += 2; continue; }
      if (c === quote) return { ok: true, value: out, next: j + 1 };
      out += c; j++;
    }
    return { ok: false, msg: "Unclosed quote" };
  }

  // ---- evalPath: ast + value -> [{ path, apath, value }] ----
  // Nodes flow through the steps as { value, trail }. trail entries are numbers for array indices
  // and strings for object keys — trailToPath depends on that distinction.

  function evalPath(ast, root) {
    let nodes = [{ value: root, trail: [] }];
    for (const step of ast.steps) {
      const out = [];
      for (const node of nodes) applyStep(step, node, out);
      nodes = out;
    }
    return nodes.map((n) => ({ path: jsonPath(n.trail), apath: trailToPath(n.trail), value: n.value }));
  }

  function applyStep(step, node, out) {
    const v = node.value, t = node.trail;
    switch (step.op) {
      case "child":
        if (isObj(v) && has(v, step.name)) out.push({ value: v[step.name], trail: t.concat(step.name) });
        else if (isArr(v) && /^\d+$/.test(step.name) && +step.name < v.length) out.push({ value: v[+step.name], trail: t.concat(+step.name) });
        return;
      case "wild":
        if (isArr(v)) v.forEach((el, k) => out.push({ value: el, trail: t.concat(k) }));
        else if (isObj(v)) for (const k of Object.keys(v)) out.push({ value: v[k], trail: t.concat(k) });
        return;
      case "index": {
        if (!isArr(v)) return;
        const idx = step.i < 0 ? v.length + step.i : step.i;
        if (idx >= 0 && idx < v.length) out.push({ value: v[idx], trail: t.concat(idx) });
        return;
      }
      case "slice": {
        if (!isArr(v)) return;
        const n = v.length;
        let a = step.start == null ? 0 : (step.start < 0 ? n + step.start : step.start);
        let b = step.end == null ? n : (step.end < 0 ? n + step.end : step.end);
        a = Math.max(0, Math.min(a, n)); b = Math.max(0, Math.min(b, n));
        for (let k = a; k < b; k++) out.push({ value: v[k], trail: t.concat(k) });
        return;
      }
      case "union":
        for (const sel of step.keys) {
          if (sel.kind === "name") {
            if (isObj(v) && has(v, sel.name)) out.push({ value: v[sel.name], trail: t.concat(sel.name) });
          } else {
            if (isArr(v)) {
              const idx = sel.i < 0 ? v.length + sel.i : sel.i;
              if (idx >= 0 && idx < v.length) out.push({ value: v[idx], trail: t.concat(idx) });
            }
          }
        }
        return;
      case "descend":
        descend(v, t, out);
        return;
    }
  }

  // descendant-or-self: emit this node, then every descendant, depth-first. The next step in the
  // path filters this set — so $..author is descend + child(author), $..[0] is descend + index(0),
  // and both see the starting node itself, not only what's under it.
  function descend(v, trail, out) {
    out.push({ value: v, trail });
    if (isArr(v)) v.forEach((el, k) => descend(el, trail.concat(k), out));
    else if (isObj(v)) for (const k of Object.keys(v)) descend(v[k], trail.concat(k), out);
  }

  // trail -> "$.users[0].email" style string (for display / copy). Distinct from apath, which is
  // the childAccessor form without the $ (that one comes from trailToPath).
  function jsonPath(trail) {
    let out = "$";
    for (const k of trail) {
      if (typeof k === "number") out += "[" + k + "]";
      else if (idKey(k)) out += "." + k;
      else out += "['" + k.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "']";
    }
    return out;
  }

  JK.jsonpath = { parse, evalPath };
})(typeof window !== "undefined" ? window : globalThis);
