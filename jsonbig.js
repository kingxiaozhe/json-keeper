// jsonbig.js — JSON parse/stringify that preserves big integer precision.
// The incumbent (JSONVue) loses precision because native JSON.parse coerces
// every number to a float64. Here, integer literals that can't be represented
// exactly as a JS number become BigInt, so 136986234663732436 stays itself —
// in the tree AND when you copy. Exposed as a global (content scripts can't
// easily ES-import). Floats keep native Number (the complaints are all about
// integers/longs, where exactness matters).
(function (global) {
  "use strict";

  // parse(text[, diag]) — diag is an optional collector:
  //   { dupKeys: string[], bigInts: number, nonFinite: number, precisionLoss: number }
  // dupKeys records keys that appeared more than once in the same object (JSON
  // spec says last-wins and silently drops the rest — we surface it); bigInts
  // counts integers beyond JS safe range that we keep exact (would round
  // elsewhere); nonFinite counts numbers that overflow float64 to ±Infinity
  // (these serialize back to null — a silent data loss we flag); precisionLoss
  // counts floats with more significant digits than a float64 can hold (the
  // copied value is no longer the value you pasted). Integers never lose
  // precision here (they become BigInt); only fractional/huge floats can.
  function parse(text, diag) {
    let i = 0;
    const n = text.length;

    // Skip whitespace AND comments (// line, /* block */) — JSONC tolerance.
    // Only called between tokens, so comment markers inside strings are never seen here.
    function ws() {
      for (;;) {
        const c = text[i];
        if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
        if (c === "/" && text[i + 1] === "/") { i += 2; while (i < n && text[i] !== "\n") i++; continue; }
        if (c === "/" && text[i + 1] === "*") {
          i += 2;
          while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
          if (i >= n) err("Unterminated comment"); // don't run i past the input
          i += 2; continue;
        }
        break;
      }
    }
    function err(msg) { const e = new SyntaxError(msg + " at position " + i); e.position = i; throw e; }

    // canonNum(s) — canonical form of a decimal numeric string: sign + mantissa
    // digits (leading/trailing zeros stripped) + decimal exponent. Two strings
    // canonicalize equal iff they denote the same decimal value, so comparing
    // canonNum(literal) with canonNum(String(parsedFloat)) detects exactly the
    // losses that matter to the user: the copied text differing from the pasted
    // text. This flags 16–17-digit losses a digit-count heuristic misses
    // (9007199254740993.0 → stored ...992) without false-positives on round
    // numbers (1.00000000000000000) or on inexact-but-round-tripping 0.1.
    function canonNum(s) {
      let neg = s[0] === "-";
      if (neg || s[0] === "+") s = s.slice(1);
      const [mant, expPart] = s.split(/[eE]/);
      const dot = mant.indexOf(".");
      const digitsRaw = dot === -1 ? mant : mant.slice(0, dot) + mant.slice(dot + 1);
      const fracLen = dot === -1 ? 0 : mant.length - dot - 1;
      let exp = (expPart ? parseInt(expPart, 10) : 0) - fracLen;
      let digits = digitsRaw.replace(/^0+/, "");
      const trimmed = digits.replace(/0+$/, "");
      exp += digits.length - trimmed.length;
      digits = trimmed;
      if (!digits) return "0"; // zero (sign dropped: -0 stringifies as "0" everywhere)
      return (neg ? "-" : "") + digits + "e" + exp;
    }

    function value() {
      ws();
      const c = text[i];
      if (c === "{") return object();
      if (c === "[") return array();
      if (c === '"') return string();
      if (c === "-" || (c >= "0" && c <= "9")) return number();
      if (text.startsWith("true", i)) { i += 4; return true; }
      if (text.startsWith("false", i)) { i += 5; return false; }
      if (text.startsWith("null", i)) { i += 4; return null; }
      err("Unexpected token");
    }

    function object() {
      const obj = {};
      i++; ws();
      if (text[i] === "}") { i++; return obj; }
      for (;;) {
        ws();
        if (text[i] !== '"') err("Expected key string");
        const key = string();
        ws();
        if (text[i] !== ":") err("Expected ':'");
        i++;
        if (diag && Object.prototype.hasOwnProperty.call(obj, key)) diag.dupKeys.push(key);
        const val = value();
        // Plain obj[key]=... would invoke the prototype setter for "__proto__":
        // the key silently vanishes from Object.keys/stringify AND the parsed
        // object's prototype gets replaced. defineProperty always creates a real
        // own property, like native JSON.parse does.
        if (key === "__proto__") Object.defineProperty(obj, key, { value: val, writable: true, enumerable: true, configurable: true });
        else obj[key] = val;
        ws();
        if (text[i] === ",") { i++; ws(); if (text[i] === "}") { i++; return obj; } continue; } // trailing comma ok
        if (text[i] === "}") { i++; return obj; }
        err("Expected ',' or '}'");
      }
    }

    function array() {
      const arr = [];
      i++; ws();
      if (text[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(value());
        ws();
        if (text[i] === ",") { i++; ws(); if (text[i] === "]") { i++; return arr; } continue; } // trailing comma ok
        if (text[i] === "]") { i++; return arr; }
        err("Expected ',' or ']'");
      }
    }

    function string() {
      let s = "";
      i++; // opening quote
      while (i < n) {
        const c = text[i++];
        if (c === '"') return s;
        if (c === "\\") {
          const e = text[i++];
          if (e === '"') s += '"';
          else if (e === "\\") s += "\\";
          else if (e === "/") s += "/";
          else if (e === "b") s += "\b";
          else if (e === "f") s += "\f";
          else if (e === "n") s += "\n";
          else if (e === "r") s += "\r";
          else if (e === "t") s += "\t";
          else if (e === "u") {
            // Require exactly four hex digits: parseInt would otherwise turn
            // "\uZZZZ" or a truncated "\u12 (EOF) into NaN -> a NUL char, silently
            // corrupting the string and skipping past the closing quote.
            const hex = text.substr(i, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) err("Bad \\u escape");
            s += String.fromCharCode(parseInt(hex, 16)); i += 4;
          }
          else err("Bad escape");
        } else if (c < "\x20") {
          // Raw control characters (an actual newline/tab inside a string) are
          // invalid JSON; accepting them would silently alter what re-stringify
          // emits vs what was pasted. Point at the offending character.
          i--; err("Bad control character in string");
        } else s += c;
      }
      err("Unterminated string");
    }

    function number() {
      const start = i;
      if (text[i] === "-") i++;
      const intStart = i;
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
      // Enforce JSON's number grammar instead of silently normalizing: "-.5"
      // (no integer digits) and "01" (leading zero) are invalid JSON, and
      // accepting them would quietly show a different value than was pasted.
      if (i === intStart) err("Invalid number");
      if (text[intStart] === "0" && i > intStart + 1) err("Invalid number (leading zero)");
      let isFloat = false;
      if (text[i] === ".") {
        isFloat = true; i++;
        const fracStart = i;
        while (i < n && text[i] >= "0" && text[i] <= "9") i++;
        if (i === fracStart) err("Invalid number (missing digits after '.')"); // "1." is not JSON
      }
      if (text[i] === "e" || text[i] === "E") { isFloat = true; i++; if (text[i] === "+" || text[i] === "-") i++; while (i < n && text[i] >= "0" && text[i] <= "9") i++; }
      const lit = text.slice(start, i);
      if (isFloat) {
        const f = Number(lit);
        // A malformed float literal ("1e", "1e+") parses to NaN — that's invalid
        // JSON, not an overflow, so reject it rather than counting it or returning NaN.
        if (Number.isNaN(f)) err("Invalid number");
        if (diag) {
          // Overflow to ±Infinity round-trips to null on stringify — flag the loss.
          if (!Number.isFinite(f)) diag.nonFinite++;
          // Exact round-trip check: flag when what stringify will emit (String(f))
          // denotes a different decimal value than the literal that was pasted.
          else if (canonNum(lit) !== canonNum(String(f))) diag.precisionLoss++;
        }
        return f;
      }
      const num = Number(lit);
      // Reject malformed numbers (a lone "-", etc.) with a positioned error
      // instead of letting BigInt() throw an opaque message.
      if (Number.isNaN(num)) err("Invalid number");
      // If a plain integer can't round-trip as a JS number, keep it as BigInt.
      if (Number.isSafeInteger(num)) return num;
      if (diag) diag.bigInts++;
      return BigInt(lit);
    }

    const result = value();
    ws();
    if (i < n) err("Unexpected trailing characters");
    return result;
  }

  const ESC = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
  // Escape only what JSON requires: backslash, double-quote, and control chars.
  const NEEDS_ESCAPE = /[\\"\u0000-\u001f]/g;
  function quote(s) {
    return '"' + s.replace(NEEDS_ESCAPE, (c) => ESC[c] || "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + '"';
  }

  // Valid-JSON serializer. BigInt prints as bare digits (no quotes) so the
  // copied text is real, precise JSON.
  function stringify(value, indent) {
    const pad = indent ? (typeof indent === "number" ? " ".repeat(indent) : indent) : "";
    // Memoize per-depth indent strings: pad.repeat() ran once per container node,
    // O(n·depth) character work on big documents.
    const pads = [""];
    const padAt = (d) => pads[d] || (pads[d] = pad.repeat(d));
    function go(v, depth) {
      if (v === null) return "null";
      const t = typeof v;
      if (t === "bigint") return v.toString();
      if (t === "number") return Number.isFinite(v) ? String(v) : "null";
      if (t === "boolean") return String(v);
      if (t === "string") return quote(v);
      const nl = pad ? "\n" : "";
      const cur = pad ? padAt(depth + 1) : "";
      const close = pad ? padAt(depth) : "";
      const sep = pad ? ": " : ":";
      if (Array.isArray(v)) {
        if (!v.length) return "[]";
        return "[" + nl + v.map((x) => cur + go(x, depth + 1)).join("," + nl) + nl + close + "]";
      }
      if (t === "object") {
        const keys = Object.keys(v);
        if (!keys.length) return "{}";
        return "{" + nl + keys.map((k) => cur + quote(k) + sep + go(v[k], depth + 1)).join("," + nl) + nl + close + "}";
      }
      return "null";
    }
    return go(value, 0);
  }

  global.JSONBig = { parse, stringify };
})(typeof window !== "undefined" ? window : globalThis);
