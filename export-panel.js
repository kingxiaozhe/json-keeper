// export-panel.js — the ⋯ menu's "export" group: infer a JSON Schema or TypeScript types from
// the document, and validate the document against a pasted Schema. Lifted out of core.js (feature
// 3 lived inline there and helped push core over its size budget). Loaded after panel.js and the
// schema-* modules, before core.js.
//
// Holds no state of its own. The document changes whenever the user edits the source pane, so
// everything document-specific is read through ctx getters at click time — getDisplay() always
// returns the current value, never a snapshot taken when the menu was first built.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const JSONBig = global.JSONBig;
  const { esc, normalize } = JK.util;

  // ctx: { host, bar, getDisplay, getTree, renderTree, jumpToPath, download }
  function wire(ctx) {
    const { host, bar, getDisplay } = ctx;
    bar.addMenuItem({ id: "exp-schema", group: "export", label: "⬢ Export JSON Schema", onClick: exportSchema });
    bar.addMenuItem({ id: "exp-ts", group: "export", label: "⬢ Export TypeScript", onClick: exportTS });
    bar.addMenuItem({ id: "validate", group: "export", label: "✓ Validate with Schema", onClick: openValidate });

    function codePanel(title, code, uncertainties, filename) {
      const p = JK.panel.open(host, {
        title,
        actions: [
          { label: "Copy", primary: true, onClick: async () => {
            try { await navigator.clipboard.writeText(code); bar.setFlash("Copied ✓"); } catch { bar.setFlash("Copy blocked"); } } },
          { label: "Download", onClick: () => { ctx.download(filename, code); bar.setFlash("Downloaded ✓"); } },
        ],
      });
      const badge = uncertainties.length
        ? '<div class="jk-panel-badge" title="These types were guessed — see the ⚠ notes">' +
          uncertainties.length + " inferred uncertaint" + (uncertainties.length > 1 ? "ies" : "y") + "</div>"
        : "";
      // esc: the code embeds user key names, so it must not reach innerHTML unescaped.
      p.body.innerHTML = badge + '<pre class="jk-panel-code jk-mono">' + esc(code) + "</pre>";
    }
    function exportSchema() {
      const { schema, uncertainties } = JK.schema.infer(getDisplay());
      codePanel("JSON Schema", JSONBig.stringify(schema, 2), uncertainties, "schema.json");
    }
    function exportTS() {
      const { code, uncertainties } = JK.schema.toTypeScript(getDisplay(), {});
      codePanel("TypeScript types", code, uncertainties, "types.ts");
    }
    function openValidate() {
      const tree = ctx.getTree();
      if (tree) tree.clearInvalid();
      const p = JK.panel.open(host, {
        title: "Validate against a JSON Schema",
        actions: [{ label: "Validate", primary: true, onClick: ({ body }) => runValidate(body) }],
        onClose: () => { const t = ctx.getTree(); if (t) t.clearInvalid(); },
      });
      p.body.innerHTML =
        '<textarea class="jk-panel-input jk-mono" placeholder="Paste a JSON Schema to check this document against…" spellcheck="false"></textarea>' +
        '<div class="jk-panel-result" data-result></div>';
    }
    function runValidate(body) {
      const ta = body.querySelector("textarea");
      const out = body.querySelector("[data-result]");
      let schema;
      // JSONBig + normalize, not JSON.parse: a schema's own big-integer bounds must survive parsing,
      // and a pasted XSSI-guarded / JSONP-wrapped schema is tolerated the same as the document.
      try { schema = JSONBig.parse(normalize(ta.value)); }
      catch (e) {
        // In-place error; the document view is untouched. createElement + textContent rather than
        // innerHTML: the message quotes the pasted schema, so there is no place to inject into.
        out.innerHTML = "";
        const errDiv = document.createElement("div");
        errDiv.className = "jk-panel-err";
        errDiv.textContent = "Schema isn't valid JSON: " + e.message;
        out.appendChild(errDiv);
        return;
      }
      const { ok, errors } = JK.schema.validate(schema, getDisplay());
      ctx.renderTree();
      const tree = ctx.getTree();
      if (tree) tree.markInvalid(errors.map((e) => e.apath).filter((a) => a !== undefined));
      out.innerHTML = "";
      if (ok) {
        const okDiv = document.createElement("div");
        okDiv.className = "jk-panel-ok";
        okDiv.textContent = "✓ Document matches the schema";
        out.appendChild(okDiv);
        return;
      }
      const count = document.createElement("div");
      count.className = "jk-panel-count";
      count.textContent = errors.length + " problem" + (errors.length > 1 ? "s" : "");
      out.appendChild(count);
      // createElement, not an innerHTML string: these are clickable, and the keyword/path/message
      // all embed the schema and doc, so textContent keeps them from being markup.
      errors.forEach((e) => {
        const btn = document.createElement("button");
        btn.className = "jk-panel-issue";
        const kw = document.createElement("span"); kw.className = "jk-panel-kw"; kw.textContent = e.keyword;
        const at = document.createElement("span"); at.className = "jk-panel-at jk-mono"; at.textContent = " " + (e.apath || "(root)");
        const msg = document.createElement("div"); msg.textContent = e.msg;
        btn.append(kw, at, msg);
        btn.addEventListener("click", () => { if (e.apath !== undefined) ctx.jumpToPath(e.apath); });
        out.appendChild(btn);
      });
    }
  }

  JK.exportPanel = { wire };
})(typeof window !== "undefined" ? window : globalThis);
