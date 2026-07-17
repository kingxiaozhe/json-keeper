// query.js — the JSONPath filter bar. Loaded after jsonpath.js (evaluator) and before core.js.
//
// Enter runs the query; it is NOT run-as-you-type. JSONPath evaluation costs more than a string
// includes(), and a half-typed path is always a syntax error, so per-keystroke errors would be
// pure noise (design decision). A syntax error keeps the last good result on screen (F-103) —
// you don't lose what you found because you fat-fingered the next keystroke.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});

  function mount(rootEl, ctx) {
    const $ = (s) => rootEl.querySelector(s);
    const input = $(".jk-query-in");
    const nEl = $("[data-query-n]");
    const clearBtn = $("[data-query-clear]");
    const errEl = $("[data-query-err]");

    let showing = false; // a result is currently on screen (so clear() knows to restore)

    // textContent, not innerHTML: the message quotes what the user typed (e.g. Unquoted key —
    // use ["users"]), and the cheapest way to have no injection hole is to have no place to
    // inject into. Same call the popup makes (L-014).
    function fail(error) {
      input.classList.add("bad");
      errEl.hidden = false;
      errEl.textContent = error.msg + (error.pos != null ? "  (position " + error.pos + ")" : "");
      // Deliberately does NOT touch the current result — F-103 keeps it on screen.
    }

    function run(expr) {
      expr = String(expr).trim();
      if (!expr) { clear(); return; }
      const parsed = JK.jsonpath.parse(expr);
      if (!parsed.ok) return fail(parsed.error);
      let matches;
      try { matches = JK.jsonpath.evalPath(parsed.ast, ctx.getValue()); }
      catch (e) { return fail({ msg: "Query failed: " + e.message }); }
      input.classList.remove("bad");
      errEl.hidden = true;
      nEl.hidden = false;
      nEl.textContent = matches.length + (matches.length === 1 ? " match" : " matches");
      clearBtn.hidden = false;
      showing = true;
      ctx.onResult(matches);
    }

    function clear() {
      input.value = "";
      input.classList.remove("bad");
      errEl.hidden = true;
      nEl.hidden = true;
      clearBtn.hidden = true;
      if (showing) { showing = false; ctx.onClear(); } // only restore if we had replaced the view
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); run(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); clear(); }
    });
    clearBtn.addEventListener("click", clear);

    return { run, clear, input };
  }

  JK.query = { mount };
})(typeof window !== "undefined" ? window : globalThis);
