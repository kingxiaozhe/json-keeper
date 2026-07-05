// viewer.test.js — smoke tests for mountViewer, the full view-assembly layer
// (toolbar + tree + status + all wiring). Previously untested because it is
// DOM-heavy; the upgraded dom-stub (with a small selector engine) lets it run
// under Node. We assert it assembles without throwing and that core controls
// are wired — the crash/regression surface, not pixel layout.
const { eq, ok, summary, loadEngine, installChrome } = require("./harness");
const storageWrites = installChrome(); // records set() writes; get() answers "nothing saved"
const { mountViewer } = loadEngine();
const mount = () => document.createElement("div");

// ---- a valid document assembles the full viewer ----
(() => {
  const root = mount();
  const okRet = mountViewer(root, '{"a":{"x":1},"b":[1,2],"c":"hi","d":{"deep":{"v":1}}}', { showErrors: true });
  ok("returns true for valid JSON", okRet === true);
  ok("builds the viewer shell (.jk-wrap)", root.querySelector(".jk-wrap") !== null);
  ok("renders tree rows", root.querySelectorAll(".jk-row").length > 0);
  ok("toolbar has a Copy button", root.querySelector('[data-act="copy"]') !== null);
  ok("has a search input", root.querySelector(".jk-search input") !== null);
  ok("has the scope selector", root.querySelector("[data-find-scope]") !== null);
  ok("status reports valid JSON", /valid JSON/.test(root.querySelector("[data-status]").textContent));
  ok("structure rail shown for a nested doc", root.querySelector("[data-rail]").hidden === false);
  ok("depth control shown when nesting > 1 level", root.querySelector('[data-act="depth"]').style.display === "");
})();

// ---- view toggle (Pretty/Raw) is wired ----
(() => {
  const root = mount();
  mountViewer(root, '{"a":1,"b":2}', {});
  const pretty = root.querySelector("[data-pretty]"), raw = root.querySelector("[data-raw]");
  ok("starts in Pretty (raw hidden)", raw.hidden === true && pretty.hidden === false);
  root.querySelector('[data-act="raw"]').click();
  ok("clicking Raw shows the raw pane", raw.hidden === false && pretty.hidden === true);
  ok("raw pane shows the original text", raw.textContent.includes('"a"'));
  root.querySelector('[data-act="pretty"]').click();
  ok("clicking Pretty returns to the tree", pretty.hidden === false && raw.hidden === true);
})();

// ---- a caret collapses its block ----
(() => {
  const root = mount();
  mountViewer(root, '{"obj":{"x":1,"y":2}}', {});
  const caret = root.querySelectorAll(".jk-caret").filter((c) => typeof c._collapse === "function")[0];
  ok("found a collapsible caret", !!caret);
  caret.click();
  ok("clicking a caret collapses it", caret.classList.contains("jk-collapsed"));
})();

// ---- CSV export wired only for a top-level array ----
(() => {
  const root = mount();
  mountViewer(root, '[{"a":1},{"a":2}]', {});
  ok("CSV button shown for an array", root.querySelector('[data-act="csv"]').style.display === "");
})();

// ---- error paths don't throw ----
(() => {
  const root = mount();
  eq("invalid JSON with showErrors returns false", mountViewer(root, "{bad", { showErrors: true }), false);
  ok("renders an error message", root.querySelector(".jk-error") !== null);
  const root2 = mount();
  eq("invalid JSON without showErrors returns false", mountViewer(root2, "{bad", { showErrors: false }), false);
})();

// ---- view preference persists ONLY on user clicks, never programmatically ----
(() => {
  storageWrites.length = 0;
  const root = mount();
  mountViewer(root, '{"a":1}', {}); // initial view is programmatic (saved/default)
  ok("mounting alone writes no jk:view", !storageWrites.some((w) => "jk:view" in w));
  root.querySelector('[data-act="raw"]').click(); // a real user click
  ok("clicking Raw persists jk:view", storageWrites.some((w) => w["jk:view"] === "raw"));
})();

// ---- re-mounting into the same root replaces (not stacks) the '/' handler ----
(() => {
  const root = mount();
  mountViewer(root, '{"a":1}', {});
  mountViewer(root, '{"a":2}', {});
  mountViewer(root, '{"a":3}', {});
  eq("one keydown listener after three mounts", (root._listeners.keydown || []).length, 1);
})();

// ---- sorting re-runs the active search against the rebuilt tree ----
(() => {
  const root = mount();
  mountViewer(root, '{"banana":1,"apple":2}', {});
  const input = root.querySelector(".jk-search input");
  input.value = "apple";
  root.querySelector('[data-act="sort"]').click(); // rebuild + rerun
  const marks = root.querySelectorAll(".jk-mark");
  eq("highlight re-applied on the new tree", marks.length, 1);
  eq("highlight covers the query", marks[0].textContent, "apple");
  ok("stale-count cleared to fresh 1/1", root.querySelector("[data-find]").textContent === "1/1");
})();

// ---- embedded-JSON diagnostics reach the chip, without double-counting on rebuild ----
(() => {
  const root = mount();
  mountViewer(root, '{"payload":"{\\"id\\":136986234663732436}"}', {});
  const chip = root.querySelector("[data-chip]");
  ok("chip counts the embedded big-int", /1 big-int/.test(chip.textContent));
  root.querySelector('[data-act="sort"]').click(); // rebuild re-parses embedded JSON
  ok("rebuild does not double-count", /1 big-int/.test(chip.textContent));
})();

// ---- pre-parsed handoff (opts.value/diag) renders without re-parsing ----
(() => {
  const diag = { dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 };
  const value = globalThis.JSONBig.parse('{"id":136986234663732436}', diag);
  const root = mount();
  ok("mounts from a pre-parsed value", mountViewer(root, '{"id":136986234663732436}', { value, diag }) === true);
  ok("tree rendered from the handed-off value", root.querySelectorAll(".jk-row").length > 0);
  ok("handed-off diag drives the chip", /1 big-int/.test(root.querySelector("[data-chip]").textContent));
})();

// ---- saved sort restores on mount, even with a SYNCHRONOUS storage callback ----
// (chrome storage is async in real Chrome; a sync callback once hit a TDZ on the
// later-declared search `rerun` — this locks in the fix, and the hardened
// store.get now propagates any callback error instead of swallowing it)
(() => {
  const origGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = (k, cb) => cb(k === "jk:sort" ? { "jk:sort": true } : {});
  try {
    const root = mount();
    mountViewer(root, '{"banana":1,"apple":2}', {}); // any throw fails the suite
    const firstKey = root.querySelectorAll(".jk-key")[0];
    eq("saved sort applied on mount (keys A→Z)", firstKey && firstKey.textContent, '"apple"');
    ok("sort button reflects the restored state", root.querySelector('[data-act="sort"]').classList.contains("on"));
  } finally {
    globalThis.chrome.storage.local.get = origGet;
  }
})();

summary();
