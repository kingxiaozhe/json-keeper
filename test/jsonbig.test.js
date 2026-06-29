// jsonbig.test.js — zero-dependency tests for the core parse/stringify.
// Run with `node test/jsonbig.test.js` (or `npm test`). The parser is the
// product's correctness moat, so it gets a safety net before any refactor.
const fs = require("fs");
const path = require("path");

// jsonbig.js is an IIFE that assigns JSONBig onto the global object.
eval(fs.readFileSync(path.join(__dirname, "..", "jsonbig.js"), "utf8"));
const { parse, stringify } = globalThis.JSONBig;

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗ " + name); }
}
function eq(name, actual, expected) {
  check(name + "  (got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected) + ")", actual === expected);
}
function throws(name, fn) {
  let threw = false; try { fn(); } catch { threw = true; }
  check(name, threw);
}

// ---- big integers stay exact ----
eq("big int preserved as BigInt", typeof parse("136986234663732436"), "bigint");
eq("big int value exact", parse("136986234663732436").toString(), "136986234663732436");
eq("big int re-stringifies bare (no quotes)", stringify(parse("136986234663732436")), "136986234663732436");
eq("safe int stays Number", typeof parse("42"), "number");
eq("negative big int", parse("-90071992547409920").toString(), "-90071992547409920");

// ---- big-int diagnostic count ----
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  parse("[1, 136986234663732436, 2, 90071992547409920000]", d);
  eq("bigInts counted", d.bigInts, 2);
})();

// ---- duplicate keys surfaced, last wins ----
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  const v = parse('{"a":1,"a":2,"b":3}', d);
  eq("duplicate key recorded", d.dupKeys.join(","), "a");
  eq("duplicate key last-wins", v.a, 2);
})();

// ---- overflow → Infinity flagged (silent null on serialize) ----
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  const v = parse("1e999", d);
  eq("nonFinite flagged", d.nonFinite, 1);
  eq("Infinity serializes to null", stringify(v), "null");
})();

// ---- float precision loss flagged ----
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  parse("12345678901234567890.5", d);
  eq("precisionLoss flagged", d.precisionLoss, 1);
})();
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  parse("[0.1, 3.14159, 2.5]", d);
  eq("ordinary floats not flagged", d.precisionLoss, 0);
})();

// ---- malformed numbers raise a positioned SyntaxError ----
throws("lone '-' rejected", () => parse("-"));
throws("bare NaN rejected", () => parse("NaN"));

// ---- JSONC tolerance: comments + trailing commas ----
eq("trailing comma in array", JSON.stringify(parse("[1,2,]")), "[1,2]");
eq("trailing comma in object", JSON.stringify(parse('{"a":1,}')), '{"a":1}');
eq("line comment skipped", parse("// hi\n42"), 42);
eq("block comment skipped", parse("/* x */ 42"), 42);
eq("comment marker inside string preserved", parse('"a//b"'), "a//b");

// ---- string escaping round-trips and stays valid JSON ----
(() => {
  const s = 'tab\tnewline\nquote"backslash\\unicodeend';
  const out = stringify(s);
  eq("escaped string is valid JSON", JSON.parse(out), s);
  check("control chars escaped (no raw newline in output)", !/\n/.test(out));
})();
eq("space and dash NOT over-escaped", stringify("a b-c"), '"a b-c"');

// ---- pretty vs minified ----
eq("minified has no spaces", stringify({ a: 1, b: [2, 3] }), '{"a":1,"b":[2,3]}');
check("pretty indents", stringify({ a: 1 }, 2).includes('\n  "a": 1\n'));

// ---- empty containers ----
eq("empty object", stringify(parse("{}")), "{}");
eq("empty array", stringify(parse("[]")), "[]");

console.log((failed ? "\n" : "") + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
