// viewer.js — the standalone paste-and-format workbench.
//
// This file owns ONLY the page shell: the left editor, its validity/error
// affordance, auto-format, and the draggable split. All JSON rendering lives in
// the shared engine (core.js `JK.mountViewer`), which also powers the in-page
// takeover — so the two entry points stay in sync and this file has no tree,
// search, or parsing logic of its own.
(function () {
  "use strict";
  const { JK, JSONBig } = window;
  const $ = (id) => document.getElementById(id);
  const input = $("in"), out = $("out"), validEl = $("valid"), autoBox = $("auto");

  const EMPTY = '<div class="jk-empty">Paste JSON on the left, then Format (⌘/Ctrl+Enter).</div>';

  // Parse the text the way the viewer will read it, ONCE — the result is handed
  // to mountViewer (opts.value/diag) so a keystroke never parses twice. We try
  // the raw text first so an error's position maps straight to the textarea;
  // only if that fails do we fall back to the normalized form (XSSI/JSONP
  // unwrapping) — so an XSSI-wrapped paste still counts as valid.
  function check(text) {
    const freshDiag = () => ({ dupKeys: [], bigInts: 0, nonFinite: 0, precisionLoss: 0 });
    let diag = freshDiag();
    try { return { value: JSONBig.parse(text, diag), diag }; }
    catch (rawErr) {
      const norm = JK.normalize(text);
      if (norm !== text) {
        diag = freshDiag(); // discard partial counts from the failed raw parse
        try { return { value: JSONBig.parse(norm, diag), diag }; } catch (_) { /* fall through */ }
      }
      return { err: rawErr };
    }
  }

  function showValid() { validEl.className = "jk-valid ok"; validEl.textContent = "● Valid JSON"; validEl.onclick = null; }
  function showError(text, err) {
    const pos = err && typeof err.position === "number" ? err.position : 0;
    const { line, col } = JK.posToLineCol(text, pos);
    validEl.className = "jk-valid bad";
    validEl.textContent = "✕ Line " + line + ", Col " + col + " — " + (err ? err.message.replace(/ at position \d+$/, "") : "invalid JSON");
    validEl.title = "Jump to the problem";
    // Click the message to drop the caret on the offending character.
    validEl.onclick = () => { input.focus(); input.setSelectionRange(pos, Math.min(pos + 1, text.length)); };
  }

  function render() {
    const text = input.value;
    if (!text.trim()) { validEl.className = "jk-valid"; validEl.textContent = ""; validEl.onclick = null; out.innerHTML = EMPTY; return; }
    const res = check(text);
    if (res.err) { showError(text, res.err); return; }  // keep the last good output visible while fixing
    showValid();
    JK.mountViewer(out, text, { showErrors: true, originalText: text, value: res.value, diag: res.diag });
  }

  // ---- auto-format (debounced) + manual triggers ----
  let t = 0;
  input.addEventListener("input", () => {
    if (!autoBox.checked) return;
    clearTimeout(t);
    t = setTimeout(render, 300);
  });
  autoBox.addEventListener("change", () => { if (autoBox.checked) render(); });
  $("go").addEventListener("click", render);
  $("clear").addEventListener("click", () => { input.value = ""; render(); input.focus(); });
  input.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); render(); } });

  // ---- draggable split ----
  const divider = $("divider"), split = $("split"), inPane = $("inPane");
  let dragging = false;
  divider.addEventListener("mousedown", (e) => { e.preventDefault(); dragging = true; divider.classList.add("jk-drag"); document.body.style.cursor = "col-resize"; });
  window.addEventListener("mouseup", () => { dragging = false; divider.classList.remove("jk-drag"); document.body.style.cursor = ""; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = split.getBoundingClientRect();
    inPane.style.flexBasis = Math.min(70, Math.max(20, ((e.clientX - r.left) / r.width) * 100)) + "%";
  });

  // ---- pick up JSON the popup stashed, then clear it ----
  chrome.storage.local.get("jk:pending", (res) => {
    const pending = res && res["jk:pending"];
    if (pending) { input.value = pending; chrome.storage.local.remove("jk:pending"); }
    render();
    input.focus();
  });
})();
