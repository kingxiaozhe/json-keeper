// highlight.test.js — search highlight surgery (markText / clearMarks) run
// against the dom-stub. Verifies marks wrap matches without disturbing element
// structure, that clearing restores the original text, and the subtle bit:
// after a clear, a query spanning a previously-split boundary still matches
// (i.e. text nodes were normalized back together).
const fs = require("fs");
const path = require("path");
const { makeDocument } = require("./dom-stub");

globalThis.document = makeDocument();
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
eval(read("jsonbig.js"));
eval(read("jk-util.js"));
eval(read("core.js"));
const { markText, clearMarks } = globalThis.JK;

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passed++; }
  else { failed++; console.error("  ✗ " + name + "\n      got:  " + JSON.stringify(actual) + "\n      want: " + JSON.stringify(expected)); }
}
function ok(name, cond) { if (cond) passed++; else { failed++; console.error("  ✗ " + name); } }

const make = (html) => { const el = document.createElement("div"); el.innerHTML = html; return el; };
const marks = (el) => el.querySelectorAll(".jk-mark");

// ---- basic wrap + count, text preserved ----
(() => {
  const el = make('<span class="jk-str">"foo bar foo"</span>');
  markText(el, "foo");
  eq("two occurrences marked", marks(el).length, 2);
  eq("each mark holds the matched text", marks(el).map((m) => m.textContent).join("|"), "foo|foo");
  eq("textContent unchanged by marking", el.textContent, '"foo bar foo"');
})();

// ---- case-insensitive match keeps original casing in output ----
(() => {
  const el = make("<span>Hello HELLO hello</span>");
  markText(el, "hello");
  eq("all three cases matched", marks(el).length, 3);
  eq("original casing preserved", marks(el).map((m) => m.textContent).join(","), "Hello,HELLO,hello");
})();

// ---- element structure (nested spans) survives; matches found across spans ----
(() => {
  const el = make('<span class="jk-key">"name"</span><span class="jk-pun">: </span><span class="jk-str">"named"</span>');
  markText(el, "nam");
  ok("matches in both the key span and value span", marks(el).length === 2);
  ok("key span still present", el.querySelector(".jk-key") !== null);
  ok("value span still present", el.querySelector(".jk-str") !== null);
})();

// ---- clearMarks restores: no marks left, text identical ----
(() => {
  const el = make('<span class="jk-str">"foo bar foo"</span>');
  const before = el.textContent;
  markText(el, "foo");
  clearMarks(el);
  eq("no marks remain after clear", marks(el).length, 0);
  eq("text identical after clear", el.textContent, before);
})();

// ---- the tricky one: after clear, a query crossing an old split still matches ----
(() => {
  const el = make("<span>foobar</span>");
  markText(el, "foo");          // splits "foobar" into [mark foo][text bar]
  clearMarks(el);               // must re-merge into a single "foobar" text node
  markText(el, "oba");          // spans the old boundary
  eq("cross-boundary match after re-merge", marks(el).length, 1);
  eq("matched the spanning substring", marks(el)[0].textContent, "oba");
})();

// ---- no match: nothing changes ----
(() => {
  const el = make("<span>abc</span>");
  markText(el, "zzz");
  eq("no marks when query absent", marks(el).length, 0);
  eq("text untouched", el.textContent, "abc");
})();

console.log((failed ? "\n" : "") + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
