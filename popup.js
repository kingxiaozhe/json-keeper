// Stash the pasted JSON and open the full viewer tab.
document.getElementById("go").addEventListener("click", async () => {
  const text = document.getElementById("in").value;
  if (!text.trim()) return;
  await chrome.storage.local.set({ "jk:pending": text });
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
  window.close();
});
