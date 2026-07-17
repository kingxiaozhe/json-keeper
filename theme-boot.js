// theme-boot.js — apply the remembered theme to the extension's own pages.
//
// tokens.css keys the manual override off data-jk-theme on <html>. The toolbar sets that, but
// only once a viewer is mounted — so the popup and the empty viewer page followed the OS alone.
// Force ☾ under a light system and you got a dark takeover page, a white popup, and a white
// paste box that flipped only after you pressed Format.
//
// Shared rather than copied into each page: two copies of the theme rule is how the popup and
// the viewer drifted apart in the first place.
//
// It flashes, and can't not. chrome.storage has no synchronous read, so the attribute always
// lands after the first frame. Hiding the page until the callback would trade one frame for a
// blank window whenever storage misbehaves, and showing nothing is the complaint this product
// exists to answer. Only users whose forced theme differs from their OS see it.
(function () {
  "use strict";
  try {
    chrome.storage.local.get("jk:theme", (r) => {
      const t = r && r["jk:theme"];
      // "auto" must not be written: tokens.css keys its follow-the-OS layer off
      // :root:not([data-jk-theme]), so any value there — including "auto" — disables it.
      if (t === "light" || t === "dark") document.documentElement.setAttribute("data-jk-theme", t);
    });
  } catch {
    // No storage access here — tokens.css still follows the OS, which is the right fallback.
  }
})();
