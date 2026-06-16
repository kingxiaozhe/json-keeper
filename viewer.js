// viewer.js — standalone paste-and-format page. Loads any pending JSON handed
// over by the popup, and re-renders on demand.
(function () {
  const input = document.getElementById("in");
  const out = document.getElementById("out");

  function render() {
    const text = input.value;
    if (!text.trim()) { out.innerHTML = ""; return; }
    window.JK.mountViewer(out, text, { showErrors: true, originalText: text });
  }

  document.getElementById("go").addEventListener("click", render);
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
  });
})();
