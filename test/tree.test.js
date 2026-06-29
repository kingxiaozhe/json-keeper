// tree.test.js — smoke tests for buildTree, the DOM-rendering core. Uses the
// dom-stub so the real render path runs under node: we assert on the returned
// {counts, nodes, topLevel} and on the rendered row tree (collapse behavior,
// embedded-JSON expansion). This is the coverage the tree path lacked.
const fs = require("fs");
const path = require("path");
const { makeDocument } = require("./dom-stub");

// buildTree references the global `document` only at call time, so install the
// stub before invoking it.
globalThis.document = makeDocument();

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
eval(read("jsonbig.js"));
eval(read("core.js"));
const { buildTree } = globalThis.JK;

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passed++; }
  else { failed++; console.error("  ✗ " + name + "\n      got:  " + JSON.stringify(actual) + "\n      want: " + JSON.stringify(expected)); }
}
function ok(name, cond) { if (cond) passed++; else { failed++; console.error("  ✗ " + name); } }

const render = (value) => { const mount = document.createElement("div"); const meta = buildTree(value, mount); return { mount, meta }; };
// head carets (collapsible) carry a _collapse fn; leaf carets don't.
const heads = (mount) => mount.querySelectorAll(".jk-caret").filter((c) => typeof c._collapse === "function");

// ---- plain document: counts, node total, top-level entries ----
(() => {
  const { mount, meta } = render({ a: 1, b: [2, 3], c: "x" });
  eq("object count (root only here)", meta.counts.object, 1);
  eq("array count", meta.counts.array, 1);
  eq("number count (a + 2 + 3)", meta.counts.number, 3);
  eq("string count", meta.counts.string, 1);
  eq("node total", meta.nodes, 6);
  eq("three top-level keys", meta.topLevel.length, 3);
  ok("rendered some rows", mount.querySelectorAll(".jk-row").length > 0);
})();

// ---- collapse hides the block's rows; expand restores them ----
(() => {
  const { mount } = render({ b: [2, 3] });
  const caret = heads(mount)[0];
  ok("one collapsible head", heads(mount).length === 1);
  caret._collapse(true);
  ok("collapsed class set", caret.classList.contains("jk-collapsed"));
  const hiddenRows = mount.querySelectorAll(".jk-row").filter((r) => r.style.display === "none");
  ok("collapsing hides child rows", hiddenRows.length > 0);
  caret._collapse(false);
  ok("expand clears collapsed class", !caret.classList.contains("jk-collapsed"));
  ok("expand restores rows", mount.querySelectorAll(".jk-row").filter((r) => r.style.display === "none").length === 0);
})();

// ---- embedded JSON string expands inline, badged, starting collapsed ----
(() => {
  const { mount, meta } = render({ payload: '{"x":1,"y":2}' });
  ok("embed badge rendered", mount.querySelector(".jk-embed") !== null);
  eq("parsed as object, not string", meta.counts.string, 0);
  eq("two objects (root + parsed payload)", meta.counts.object, 2);
  eq("parsed members counted (x, y)", meta.counts.number, 2);
  eq("node total (root, parsed, x, y)", meta.nodes, 4);
  ok("embedded block starts collapsed", heads(mount).some((c) => c.classList.contains("jk-collapsed")));
})();

// ---- a plain string that only looks structural is NOT expanded ----
(() => {
  const { mount, meta } = render({ note: "not json {really}" });
  eq("plain string stays a string", meta.counts.string, 1);
  ok("no embed badge", mount.querySelector(".jk-embed") === null);
})();

console.log((failed ? "\n" : "") + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
