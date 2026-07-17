// Honour the theme the viewer remembers. tokens.css keys the manual override off
// data-jk-theme on <html>; without this the popup only ever follows the OS, so choosing ☾ in
// the viewer under a light system gave you a dark viewer and a white popup.
//
// This flashes. chrome.storage has no synchronous read, so the attribute always lands after
// first paint — being at the end of <body> changes when this runs, not when the callback does.
// Only affects users who forced a theme that differs from their OS; the alternative (hiding
// <html> until the callback) trades a one-frame flash for a blank popup whenever anything goes
// wrong with storage, and "the popup showed me nothing" is the complaint this product exists
// to fix.
try {
  chrome.storage.local.get("jk:theme", (r) => {
    const t = r && r["jk:theme"];
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-jk-theme", t);
  });
} catch { /* no storage access — fall back to the OS preference, which tokens.css handles */ }

// Stash the pasted JSON and open the full viewer tab.
document.getElementById("go").addEventListener("click", async () => {
  const text = document.getElementById("in").value;
  if (!text.trim()) return;
  await chrome.storage.local.set({ "jk:pending": text });
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
  window.close();
});
