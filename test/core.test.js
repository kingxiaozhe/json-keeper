// core.test.js — zero-dependency tests for the pure view helpers exposed on
// window.JK (linkify, epochHint). core.js touches the DOM only inside
// mountViewer, so loading it under node is safe for these helpers.
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
eval(read("jsonbig.js")); // defines globalThis.JSONBig (core.js reads it)
eval(read("core.js"));    // defines globalThis.JK
const { linkify, epochHint, embeddedJSON, groupDigits } = globalThis.JK;

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passed++; }
  else { failed++; console.error("  ✗ " + name + "\n      got:  " + JSON.stringify(actual) + "\n      want: " + JSON.stringify(expected)); }
}
function ok(name, cond) { if (cond) passed++; else { failed++; console.error("  ✗ " + name); } }

// ---- linkify: links http(s), escapes everything, refuses other schemes ----
eq("plain text is escaped, unlinked",
  linkify('a & b < c'), "a &amp; b &lt; c");
eq("http URL becomes a safe anchor",
  linkify("see http://x.com/p"),
  'see <a class="jk-link" href="http://x.com/p" target="_blank" rel="noopener noreferrer">http://x.com/p</a>');
ok("https URL linked", linkify("https://a.b/c").includes('href="https://a.b/c"'));
ok("javascript: scheme NOT linked", !linkify("javascript:alert(1)").includes("<a "));
ok("data: scheme NOT linked", !linkify("data:text/html,x").includes("<a "));
ok("ftp: scheme NOT linked", !linkify("ftp://h/f").includes("<a "));
// An attacker-crafted value can't break out of the href attribute: the URL
// regex stops at the quote, so the payload lands outside the tag as plain text.
eq("quote terminates the URL; payload is inert text",
  linkify('http://x.com/"onmouseover=alert(1)'),
  '<a class="jk-link" href="http://x.com/" target="_blank" rel="noopener noreferrer">http://x.com/</a>"onmouseover=alert(1)');
ok("angle brackets after URL stay escaped",
  linkify("http://x.com <b>").includes("&lt;b&gt;"));
eq("URL stops at a JSON closing quote (quotes safe as text content)",
  linkify('"http://x.com"'),
  '"<a class="jk-link" href="http://x.com" target="_blank" rel="noopener noreferrer">http://x.com</a>"');

// ---- epochHint: plausible Unix timestamps only, UTC formatted ----
eq("epoch seconds -> UTC", epochHint(1718800000), "Unix time: 2024-06-19 12:26:40 UTC");
eq("epoch milliseconds -> UTC", epochHint(1718800000000), "Unix time: 2024-06-19 12:26:40 UTC");
eq("small counts are not timestamps", epochHint(42), null);
eq("year/age-like small ints are not timestamps", epochHint(2024), null);
eq("negative is not a timestamp", epochHint(-1718800000), null);
eq("microseconds (too big) not matched", epochHint(1718800000000000), null);
eq("non-number ignored", epochHint("1718800000"), null);

// ---- embeddedJSON: detect a JSON object/array carried inside a string ----
ok("object string detected", (() => { const v = embeddedJSON('{"a":1}'); return v && v.a === 1; })());
ok("array string detected", (() => { const v = embeddedJSON("[1,2,3]"); return Array.isArray(v) && v.length === 3; })());
ok("surrounding whitespace tolerated", (() => { const v = embeddedJSON('  {"a":1}  '); return v && v.a === 1; })());
ok("empty object string detected", (() => { const v = embeddedJSON("{}"); return v && typeof v === "object"; })());
eq("plain string not detected", embeddedJSON("hello"), null);
eq("number-like string not detected", embeddedJSON("12345"), null);
eq("quoted-string content not detected", embeddedJSON('"just text"'), null);
eq("unbalanced (no closing) rejected fast", embeddedJSON('{"a":1'), null);
eq("invalid JSON-looking string rejected", embeddedJSON("{not json}"), null);
eq("non-string input ignored", embeddedJSON(42), null);
eq("oversized string skipped", embeddedJSON("[" + "1,".repeat(60000) + "1]"), null);

// ---- groupDigits: thousands separators, sign-aware, safe on non-integers ----
eq("groups thousands", groupDigits("1234567"), "1,234,567");
eq("under 1000 unchanged", groupDigits("999"), "999");
eq("exact thousand", groupDigits("1000"), "1,000");
eq("negative keeps sign", groupDigits("-1234567"), "-1,234,567");
eq("big-int string grouped", groupDigits("136986234663732436"), "136,986,234,663,732,436");
eq("non-digits returned as-is", groupDigits("12ab"), "12ab");
eq("float string returned as-is (not all digits)", groupDigits("1234.5"), "1234.5");

console.log((failed ? "\n" : "") + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
