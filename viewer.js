// viewer.js — standalone paste-and-format page. Loads any pending JSON handed
// over by the popup, and re-renders on demand.
(function () {
  const { guardEmpty } = window.JK.util;
  const input = document.getElementById("in");
  const out = document.getElementById("out");
  const go = document.getElementById("go");

  function render() {
    const text = input.value;
    if (!text.trim()) { out.innerHTML = ""; return; }
    window.JK.mountViewer(out, text, { showErrors: true });
  }

  // Empty box + live Format button = click, nothing happens, no reason given. That is the
  // complaint the popup spent a whole task killing, and this is the other paste box — the one
  // popup.js sends you to. Bad JSON still goes through: the error lands under an editable copy
  // of your text, which is the repair path, not a dead end.
  const sync = () => guardEmpty(input, go);
  input.addEventListener("input", sync);

  go.addEventListener("click", render);
  input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") render();
  });

  // Pick up JSON the popup stashed, then clear it.
  chrome.storage.local.get("jk:pending", (res) => {
    const pending = res && res["jk:pending"];
    if (pending) {
      input.value = pending;
      chrome.storage.local.remove("jk:pending");
      render();
    }
    sync();   // the handoff fills the box without firing input; the button must not stay dead
  });

  sync();
})();
