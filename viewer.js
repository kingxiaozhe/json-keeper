// viewer.js — the standalone paste-and-format page. It mounts the viewer full-height into the tab
// and hands it whatever JSON the popup stashed. The viewer's own left pane is the editor now, so
// there's no separate paste box to manage here — an empty handoff just opens an empty, typable box.
(function () {
  "use strict";
  const app = document.getElementById("app");

  // showErrors:true — this is the repair surface. Bad JSON opens IN the editor with the error under
  // it (mountViewer handles that), rather than the silent bail content.js uses on live pages.
  chrome.storage.local.get("jk:pending", (res) => {
    const pending = (res && res["jk:pending"]) || "";
    if (pending) chrome.storage.local.remove("jk:pending"); // used once; don't leave it lying around
    window.JK.mountViewer(app, pending, { showErrors: true });
  });
})();
