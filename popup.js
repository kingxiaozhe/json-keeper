// popup.js — the paste box. Validates in place, then hands off to the viewer tab.
//
// "Can't work out how to use it" was the biggest complaint about the tool this replaces (44
// reviews), and an empty box with a live button that silently does nothing is that same
// complaint wearing a different hat. So: the button is dead until there's something to format,
// bad JSON says so under the box rather than only after you've spent a tab finding out, and an
// oversized paste warns before it costs anyone a freeze.
//
// Bad JSON does NOT disable the button. The viewer page has its own paste box, so opening it
// with broken input puts your text in an editable field with the error underneath — that's a
// repair path, not a dead end, and blocking it would only mean deciding for you.
(function () {
  "use strict";
  const { normalize, humanSize, LARGE, guardEmpty } = window.JK.util;
  const input = document.getElementById("in");
  const go = document.getElementById("go");
  const say = document.getElementById("say");

  // LARGE comes from util: it's the same threshold core uses to decide Raw, and the popup's
  // promise ("opens in raw mode") is only true while they agree. Trial-parsing above it would
  // block the popup's only thread for seconds per keystroke, and the answer wouldn't change what
  // happens next — oversized input gets handed over either way.
  const DEBOUNCE = 300;

  let timer = 0;

  // textContent, not innerHTML: the message quotes a slice of what was pasted, and the cheapest
  // way not to have an injection hole is not to have a place to inject into. (Today jsonbig's
  // messages can't carry markup anyway — only "Invalid number: <literal>" echoes input, and a
  // number literal holds nothing but digits, e/E and signs. That's an argument for not relying
  // on it, not for trusting it.)
  function setState(cls, text) {
    say.className = "say" + (cls ? " " + cls : "");
    say.textContent = text;
  }

  // Whether there's anything to format is knowable the instant you type it, so it's answered
  // then. Only the parse waits for the debounce.
  //
  // These were one function behind the same 300ms timer, which meant a paste followed by
  // ⌘+Enter — well under 300ms — met a disabled button and did nothing. That is the "clicked it,
  // nothing happened" complaint this whole state exists to kill, reintroduced inside a window
  // the old code didn't even have.
  function setEnabled() {
    const ok = guardEmpty(input, go);   // shared with the viewer page: same refusal, same words
    if (!ok) { input.classList.remove("bad"); setState("", ""); }
    return ok;
  }

  function check() {
    const text = input.value;
    if (!text.trim()) return;

    if (text.length > LARGE) {
      // Trial-parsing this would block the popup's only thread for seconds on every keystroke,
      // and the answer wouldn't change what happens next — oversized input is handed over either
      // way. LARGE is util's, shared with core: the popup's promise that this "opens in raw mode"
      // is only true while both agree.
      input.classList.remove("bad");
      setState("", humanSize(text.length) + " — opens in raw mode");
      return;
    }

    try {
      // normalize first. Real API responses arrive wrapped in XSSI guards ()]}' , while(1);) or
      // JSONP, and tolerating those is a feature this product advertises. Parsing the raw text
      // would reject exactly the payloads it promises to handle — and the viewer, which does
      // normalize, would then open them fine, so the popup would be calling its own viewer a liar.
      window.JSONBig.parse(normalize(text));
      input.classList.remove("bad");
      setState("", "");
    } catch (e) {
      input.classList.add("bad");
      setState("bad", e.message);
    }
  }

  input.addEventListener("input", () => {
    setEnabled();
    clearTimeout(timer);
    timer = setTimeout(check, DEBOUNCE);
  });

  async function submit() {
    const text = input.value;
    if (!text.trim()) return;
    await chrome.storage.local.set({ "jk:pending": text });
    await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
    window.close();
  }

  go.addEventListener("click", submit);
  // The viewer page takes ⌘/Ctrl+Enter; the same keys work where you paste it.
  // No !go.disabled check: submit() already ignores empty input, and bad JSON is allowed
  // through by design — so that guard could only ever fire on a stale disabled flag and eat
  // the keystroke, which is exactly what it did during the debounce window.
  input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
  });

  setEnabled();
  check(); // a restored or pre-filled box shouldn't start out lying about its state
})();
