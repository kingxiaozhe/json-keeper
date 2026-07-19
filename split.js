// split.js — the draggable divider between the source editor (left) and the tree view (right).
// Split out of core.js so the two-pane layout mechanics don't push core further over its size
// budget. Loaded after util.js, before core.js.
//
// The divider adjusts the LEFT pane's flex-basis as a PERCENTAGE of the row, not a pixel width:
// a percentage survives a window resize (a viewer takes over a whole tab, which gets resized),
// while a pixel basis would leave the split lopsided the moment the window changed. The ratio is
// remembered (jk:split) because a viewer kept open all day shouldn't forget how you sized it.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { store } = JK.util;

  // Percent bounds: never let a drag collapse either pane to an unrecoverable sliver — a 0%-wide
  // editor has no grab handle left to drag back out with.
  const MIN = 14, MAX = 86;

  // mount(mainEl) — mainEl is .jk-main holding .jk-edit-pane · .jk-splitter · .jk-view-pane.
  function mount(mainEl) {
    const edit = mainEl.querySelector(".jk-edit-pane");
    const handle = mainEl.querySelector(".jk-splitter");
    if (!edit || !handle) return { setRatio() {} };

    const apply = (pct) => { edit.style.flex = "0 0 " + pct + "%"; };
    store.get("jk:split", (v) => { if (typeof v === "number" && v >= MIN && v <= MAX) apply(v); });

    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const r = mainEl.getBoundingClientRect();
      const pct = Math.max(MIN, Math.min(MAX, ((e.clientX - r.left) / r.width) * 100));
      apply(pct);
      e.preventDefault();
    };
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      mainEl.classList.remove("jk-dragging");
      const r = mainEl.getBoundingClientRect();
      store.set("jk:split", Math.round((edit.getBoundingClientRect().width / r.width) * 100));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };
    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      // jk-dragging kills pointer-events on both panes mid-drag: without it, dragging the divider
      // over the editor textarea starts selecting its text instead of resizing.
      mainEl.classList.add("jk-dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      e.preventDefault();
    });
    handle.addEventListener("dblclick", () => { apply(50); store.set("jk:split", 50); });

    return { setRatio: apply };
  }

  JK.split = { mount };
})(typeof window !== "undefined" ? window : globalThis);
