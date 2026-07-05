// jsonbig.test.js — zero-dependency tests for the core parse/stringify.
// Run with `node test/jsonbig.test.js` (or `npm test`). The parser is the
// product's correctness moat, so it gets a safety net before any refactor.
const fs = require("fs");
const path = require("path");
const { check, eq, throws, summary, loadParser } = require("./harness");
const { parse, stringify } = loadParser();

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
throws("malformed float '1e' rejected", () => parse("1e"));
throws("malformed float '1e+' rejected", () => parse("1e+"));
throws("malformed float inside array rejected", () => parse("[1e]"));
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  try { parse("1e", d); } catch {}
  eq("malformed float is not miscounted as nonFinite", d.nonFinite, 0);
})();

// ---- precisionLoss ignores trailing zeros (round numbers aren't lossy) ----
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  parse("[1.00000000000000000, 1000000000000000000.0, 2.5]", d);
  eq("round numbers with long zero runs not flagged", d.precisionLoss, 0);
})();

// ---- \u escapes are validated (no silent NUL / quote-eating) ----
eq("valid \\u escape decodes", parse('"\\u0041"'), "A");
throws("non-hex \\u escape rejected", () => parse('"\\uZZZZ"'));
throws("truncated \\u escape rejected", () => parse('"\\u12"'));

// ---- "__proto__" key is a real own property (no silent drop / proto pollution) ----
(() => {
  const o = parse('{"__proto__":{"polluted":true},"a":1}');
  check("__proto__ is an own property", Object.prototype.hasOwnProperty.call(o, "__proto__"));
  eq("Object.keys includes it", Object.keys(o).join(","), "__proto__,a");
  check("prototype NOT replaced (polluted not inherited)", !("polluted" in Object.getPrototypeOf(o) || {}) || Object.prototype.hasOwnProperty.call(o, "__proto__"));
  eq("prototype is still Object.prototype", Object.getPrototypeOf(o), Object.prototype);
  eq("round-trips through stringify", stringify(o), '{"__proto__":{"polluted":true},"a":1}');
})();
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  parse('{"__proto__":1,"__proto__":2}', d);
  eq("duplicate __proto__ detected", d.dupKeys.join(","), "__proto__");
})();

// ---- strict JSON number grammar (silent normalization would betray the paste) ----
throws("leading zero '01' rejected", () => parse("01"));
throws("'-00' rejected", () => parse("-00"));
throws("no integer digits '-.5' rejected", () => parse("-.5"));
throws("trailing dot '1.' rejected", () => parse("1."));
eq("'0' still fine", parse("0"), 0);
eq("'-0' still fine", parse("-0"), -0);
eq("'0.5' still fine", parse("0.5"), 0.5);
eq("'1e2' still fine", parse("1e2"), 100);

// ---- raw control characters in strings rejected (escaped forms still fine) ----
throws("raw newline in string rejected", () => parse('"a\nb"'));
throws("raw tab in string rejected", () => parse('"a\tb"'));
eq("escaped \\n still fine", parse('"a\\nb"'), "a\nb");

// ---- unterminated block comment errors instead of overrunning ----
throws("unterminated /* rejected", () => parse("/*"));
throws("unterminated /* before value rejected", () => parse("/* note 42"));
eq("terminated comment still fine", parse("/* c */ 42"), 42);

// ---- precisionLoss: exact round-trip detection (16-digit losses caught) ----
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  parse("9007199254740993.0", d);
  eq("16-digit float loss flagged", d.precisionLoss, 1);
})();
(() => {
  const d = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  parse("[0.1, 1.00000000000000000, 1e2, 123.456e2, 2.5]", d);
  eq("exact/round-tripping floats not flagged", d.precisionLoss, 0);
})();

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

// ---- source hygiene: no raw control bytes in any shipped file ----
// (a stray NUL once made git/grep treat jsonbig.js as binary, hiding its diffs)
["jsonbig.js", "jk-util.js", "core.js", "content.js", "viewer.js", "popup.js"].forEach((f) => {
  const buf = fs.readFileSync(path.join(__dirname, "..", f));
  let bad = -1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) { bad = i; break; }
  }
  check(f + " has no raw control bytes" + (bad >= 0 ? " (byte at offset " + bad + ")" : ""), bad === -1);
});

summary();
