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
eval(read("jk-util.js"));
eval(read("core.js"));
const { buildTree, applyDepth, applySearch } = globalThis.JK;

// container carets (they carry _collapse / _rows / _headRow); leaf carets don't.
const caretsOf = (mount) => mount.querySelectorAll(".jk-caret").filter((c) => typeof c._collapse === "function");

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

// ---- depth: maxDepth reported, carets tagged, applyDepth folds by level ----
(() => {
  const { mount, meta } = render({ a: { b: { c: { d: 1 } } }, e: 2 });
  eq("maxDepth reported", meta.maxDepth, 3); // container heads: a(1) > b(2) > c(3)
  const hs = heads(mount);
  eq("three collapsible containers", hs.length, 3);
  ok("carets tagged with their depth", hs.every((c) => typeof c._depth === "number"));
  eq("depths are 1,2,3", hs.map((c) => c._depth).sort().join(","), "1,2,3");

  applyDepth(hs, 2); // open depth 1, collapse depth >= 2
  eq("depth-1 container open", hs.find((c) => c._depth === 1).classList.contains("jk-collapsed"), false);
  eq("depth-2 container collapsed", hs.find((c) => c._depth === 2).classList.contains("jk-collapsed"), true);
  eq("depth-3 container collapsed", hs.find((c) => c._depth === 3).classList.contains("jk-collapsed"), true);

  applyDepth(hs, Infinity); // expand all
  ok("expand-all opens every container", hs.every((c) => !c.classList.contains("jk-collapsed")));

  applyDepth(hs, 1); // collapse everything
  ok("level 1 collapses all containers", hs.every((c) => c.classList.contains("jk-collapsed")));
})();

// flat values: only the root is a container (rendered outside container()), so
// no nested heads -> maxDepth 0. Top-level containers alone give maxDepth 1.
eq("all-leaf object has maxDepth 0", render({ a: 1, b: 2 }).meta.maxDepth, 0);
eq("top-level containers give maxDepth 1", render({ a: [1], b: [2] }).meta.maxDepth, 1);

// ---- applySearch: scope, match-aware expand, filter, and the gutter/acts fix ----
const rowWith = (mount, s) => mount.querySelectorAll(".jk-row").filter((r) => r.textContent.includes(s))[0];
const SAMPLE = { name: "Ada", city: "name-town", info: { name: "Bob" } };

(() => {
  const { mount } = render(SAMPLE);
  eq("scope=keys matches key occurrences", applySearch(mount, caretsOf(mount), "name", "keys", false).length, 2);   // "name" key + info.name key
  eq("scope=values matches value occurrences", applySearch(mount, caretsOf(mount), "name", "values", false).length, 1); // "name-town" value
  eq("scope=both is the union", applySearch(mount, caretsOf(mount), "name", "both", false).length, 3);
  eq("empty query clears matches", applySearch(mount, caretsOf(mount), "", "both", false).length, 0);
})();

// the bug fix: a query that only appears on the copy-path button / gutter must NOT match
(() => {
  const { mount } = render(SAMPLE);
  eq("'path' (a hover-button label) matches nothing", applySearch(mount, caretsOf(mount), "path", "both", false).length, 0);
})();

// match-aware expand: a collapsed ancestor of a match is revealed
(() => {
  const { mount } = render(SAMPLE);
  const info = caretsOf(mount).find((c) => c._headRow.textContent.includes('"info"'));
  info._collapse(true);
  ok("ancestor starts collapsed", info.classList.contains("jk-collapsed"));
  applySearch(mount, caretsOf(mount), "name", "keys", false); // info.name is a match
  ok("collapsed ancestor of a match is re-expanded", !info.classList.contains("jk-collapsed"));
})();

// filter: keep matches + their ancestor path, hide the rest
(() => {
  const { mount } = render(SAMPLE);
  applySearch(mount, caretsOf(mount), "name", "keys", true);
  ok("ancestor header of a match is kept", !rowWith(mount, '"info"').classList.contains("jk-filtered"));
  ok("an unrelated row is filtered out", rowWith(mount, '"city"').classList.contains("jk-filtered"));
})();

console.log((failed ? "\n" : "") + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
