// content.js — auto-format a page that IS a JSON document.
// Conservative on purpose: we only take over when we're confident it's JSON, and
// we PARSE FIRST into a detached node — only replacing the page on success — so we
// never wipe a normal HTML page. (jsonbig.js + core.js load before this.)
(function () {
  if (window.__jkActivated) return;

  const ct = (document.contentType || "").toLowerCase();
  const body = document.body;
  if (!body || !window.JK) return;

  // A real JSON document is either served as application/json (Chrome wraps it in
  // a lone <pre>) or a NON-HTML page (text/plain etc.) whose whole content is one
  // JSON value. Requiring non-HTML for the lone-<pre> path keeps us from wiping a
  // legitimate HTML page that merely displays a JSON snippet in a single <pre>.
  const onlyPre =
    body.children.length === 1 && body.firstElementChild.tagName === "PRE"
      ? body.firstElementChild
      : null;
  const isJsonCT = ct.includes("json");
  // Cheap O(1) gate FIRST: on ordinary web pages we must bail before touching
  // body.textContent, which serializes the page's entire text.
  if (!isJsonCT && !(onlyPre && !ct.includes("html"))) return;

  const rawText = (onlyPre ? onlyPre.textContent : body.textContent || "").trim();
  // Gate on the normalized text so XSSI-prefixed / JSONP-wrapped docs are detected too.
  const cleaned = window.JK.normalize(rawText);
  const looksJson = /^[[{]/.test(cleaned) && /[\]}]$/.test(cleaned);
  if (!rawText || (!isJsonCT && !looksJson)) return;

  // Parse into a detached container first; bail untouched if it isn't valid JSON.
  const root = document.createElement("div");
  root.className = "jk-root";
  const ok = window.JK.mountViewer(root, rawText, { showErrors: false, originalText: rawText });
  if (!ok) return;

  window.__jkActivated = true;
  document.documentElement.classList.add("jk-active");
  body.textContent = "";
  body.appendChild(root);
})();
