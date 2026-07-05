// harness.js — shared runner for the zero-dependency suites: one set of
// assertion helpers with uniform failure output, pass/fail counters, engine
// loaders, and the chrome.storage mock. Each suite stays a plain
// `node test/x.test.js` script; call summary() last.
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗ " + name); }
}
const ok = check;

function eq(name, actual, expected) {
  if (actual === expected) { passed++; }
  else { failed++; console.error("  ✗ " + name + "\n      got:  " + JSON.stringify(actual) + "\n      want: " + JSON.stringify(expected)); }
}

function throws(name, fn) {
  let threw = false; try { fn(); } catch { threw = true; }
  check(name, threw);
}

function summary() {
  console.log((failed ? "\n" : "") + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

// loadParser() — just jsonbig.js (no DOM needed).
function loadParser() {
  eval(read("jsonbig.js"));
  return globalThis.JSONBig;
}

// loadEngine() — the full stack under the DOM stub, in manifest order.
function loadEngine() {
  const { makeDocument } = require("./dom-stub");
  globalThis.document = makeDocument();
  globalThis.requestAnimationFrame = () => 0; // rail scroll-spy; never fires in tests
  eval(read("jsonbig.js"));
  eval(read("jk-util.js"));
  eval(read("core.js"));
  return globalThis.JK;
}

// installChrome() — a chrome.storage.local mock; returns the array that set()
// writes into so tests can assert what persisted. Pass getImpl to control what
// get() answers (default: nothing saved).
function installChrome(getImpl) {
  const writes = [];
  globalThis.chrome = { storage: { local: {
    get: getImpl || ((k, cb) => cb({})),
    set: (obj) => writes.push(obj),
    remove: () => {},
  } } };
  return writes;
}

module.exports = { check, ok, eq, throws, summary, read, loadParser, loadEngine, installChrome };
