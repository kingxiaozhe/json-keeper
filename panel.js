// panel.js — a slide-in side panel. Loaded before core.js. Deliberately generic: feature 3 uses
// it for Schema/TypeScript export and Schema validation, and feature 4 reuses it for history and
// diff. Everything specific (what's in the body, which buttons) is passed in, so there's one
// panel implementation rather than one per feature.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { esc } = JK.util;

  // open(host, { title, actions }) -> { el, body, footer, close }
  //   host    — element the panel is appended into (the viewer wrap)
  //   title   — header text (escaped)
  //   actions — [{ label, primary, onClick }] rendered as footer buttons
  // The caller fills `.body` itself (it owns what goes there) and can put a status line in
  // `.footer`. close() removes the panel and runs opts.onClose if given.
  function open(host, opts) {
    opts = opts || {};
    const el = document.createElement("div");
    el.className = "jk-panel";
    el.innerHTML =
      '<div class="jk-panel-card">' +
        '<div class="jk-panel-head"><span class="jk-panel-title">' + esc(opts.title || "") + "</span>" +
          '<button class="jk-panel-close" title="Close (Esc)">✕</button></div>' +
        '<div class="jk-panel-body" data-panel-body></div>' +
        '<div class="jk-panel-foot" data-panel-foot></div>' +
      "</div>";
    const body = el.querySelector("[data-panel-body]");
    const foot = el.querySelector("[data-panel-foot]");

    const close = () => { el.remove(); if (opts.onClose) opts.onClose(); };
    el.querySelector(".jk-panel-close").addEventListener("click", close);
    // Click the backdrop (outside the card) closes; clicks inside the card don't bubble out to it.
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    for (const a of opts.actions || []) {
      const b = document.createElement("button");
      b.className = "jk-panel-btn" + (a.primary ? " jk-primary" : "");
      b.textContent = a.label;
      b.addEventListener("click", () => a.onClick({ body, foot, close }));
      foot.appendChild(b);
    }

    host.appendChild(el);
    return { el, body, footer: foot, close };
  }

  JK.panel = { open };
})(typeof window !== "undefined" ? window : globalThis);
