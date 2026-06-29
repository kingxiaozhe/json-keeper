// dom-stub.js — a tiny, dependency-free DOM good enough to exercise buildTree
// (and future tree code) under node. It supports exactly what the renderer
// touches: createElement, className/dataset/style/hidden, textContent,
// innerHTML (parsed into a real child tree), append/appendChild, classList,
// addEventListener, and class-selector querySelector/querySelectorAll. It is
// NOT a spec DOM — just enough to make the render path runnable and assertable.

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

class TextNode {
  constructor(text) { this.textContent = decode(text); this.children = []; this.classList = null; }
}

class El {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.className = "";
    this._text = "";
    this._listeners = {};
  }
  get classList() {
    const self = this;
    const parts = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add: (...c) => { const s = new Set(parts()); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); },
      remove: (...c) => { const s = new Set(parts()); c.forEach((x) => s.delete(x)); self.className = [...s].join(" "); },
      toggle: (c, on) => { const s = new Set(parts()); const want = on === undefined ? !s.has(c) : on; want ? s.add(c) : s.delete(c); self.className = [...s].join(" "); return want; },
      contains: (c) => parts().includes(c),
    };
  }
  set classList(_) {} // className is the source of truth; setter kept for the getter to coexist
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set innerHTML(v) { this.children = parseHTML(String(v)); this._text = ""; }
  append(...nodes) { nodes.forEach((n) => this.children.push(n)); }
  appendChild(n) { this.children.push(n); return n; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  _walk(fn) { for (const ch of this.children) { fn(ch); if (ch._walk) ch._walk(fn); } }
  _find(sel, all) {
    const cls = sel.replace(/^\./, ""), out = [];
    this._walk((n) => { if (n.classList && n.classList.contains(cls)) out.push(n); });
    return all ? out : out[0] || null;
  }
  querySelector(sel) { return this._find(sel, false); }
  querySelectorAll(sel) { return this._find(sel, true); }
}

// Minimal HTML parser: handles nested <span>/<button>/<a> with class="" and a
// bare `hidden` attribute, plus text. The renderer escapes &, <, >, and " in
// all attribute/text content, so no raw markup metacharacters appear in data.
function parseHTML(html) {
  const root = [], stack = [{ children: root }];
  const re = /<(\/?)([a-zA-Z0-9]+)((?:"[^"]*"|[^>])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, attrs, selfClose, text] = m;
    const parent = stack[stack.length - 1];
    if (text != null) { if (text) parent.children.push(new TextNode(text)); continue; }
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const el = new El(tag);
    const cls = attrs.match(/class="([^"]*)"/);
    if (cls) el.className = cls[1];
    if (/(^|\s)hidden(\s|=|$)/.test(attrs)) el.hidden = true;
    parent.children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

function makeDocument() {
  return { createElement: (tag) => new El(tag) };
}

module.exports = { makeDocument, El, parseHTML };
