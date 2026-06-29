// dom-stub.js — a tiny, dependency-free DOM good enough to exercise buildTree
// and the search-highlight surgery under node. It supports exactly what those
// paths touch: createElement/createTextNode/createDocumentFragment,
// className/dataset/style/hidden, textContent, innerHTML (parsed into a real
// child tree), append/appendChild, classList, addEventListener, class-selector
// querySelector/All, and the node ops highlighting needs — childNodes,
// nodeType/nodeValue, parentNode, replaceChild (incl. fragments) and normalize.
// It is NOT a spec DOM, just enough to make the real code runnable + assertable.

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

class TextNode {
  constructor(text) { this.nodeType = 3; this.nodeValue = String(text); this.children = []; this.classList = null; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
}

class Frag {
  constructor() { this.nodeType = 11; this.children = []; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
}

class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = (tag || "div").toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.className = "";
    this.parentNode = null;
    this._text = "";
    this._listeners = {};
  }
  get childNodes() { return this.children; }
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
  set classList(_) {}
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set innerHTML(v) { const kids = parseHTML(String(v)); kids.forEach((k) => (k.parentNode = this)); this.children = kids; this._text = ""; }
  append(...nodes) { nodes.forEach((n) => { n.parentNode = this; this.children.push(n); }); }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  replaceChild(newNode, oldNode) {
    const i = this.children.indexOf(oldNode);
    if (i < 0) return oldNode;
    const ins = newNode.nodeType === 11 ? newNode.children.slice() : [newNode];
    ins.forEach((n) => (n.parentNode = this));
    this.children.splice(i, 1, ...ins);
    oldNode.parentNode = null;
    if (newNode.nodeType === 11) newNode.children = [];
    return oldNode;
  }
  normalize() {
    const out = [];
    for (const ch of this.children) {
      if (ch.nodeType === 3) {
        if (ch.nodeValue === "") continue;
        const last = out[out.length - 1];
        if (last && last.nodeType === 3) last.nodeValue += ch.nodeValue;
        else out.push(ch);
      } else { if (ch.normalize) ch.normalize(); out.push(ch); }
    }
    out.forEach((n) => (n.parentNode = this));
    this.children = out;
  }
  _walk(fn) { for (const ch of this.children) { fn(ch); if (ch._walk) ch._walk(fn); } }
  _find(sel, all) {
    const cls = sel.replace(/^\./, ""), out = [];
    this._walk((n) => { if (n.classList && n.classList.contains(cls)) out.push(n); });
    return all ? out : out[0] || null;
  }
  querySelector(sel) { return this._find(sel, false); }
  querySelectorAll(sel) { return this._find(sel, true); }
}

// Minimal HTML parser: handles nested <span>/<button>/<a>/<mark> with class=""
// and a bare `hidden` attribute, plus text. The renderer escapes &, <, >, and "
// in all attribute/text content, so no raw markup metacharacters appear in data.
function parseHTML(html) {
  const root = [], stack = [{ children: root, _sentinel: true }];
  const re = /<(\/?)([a-zA-Z0-9]+)((?:"[^"]*"|[^>])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, attrs, selfClose, text] = m;
    const parent = stack[stack.length - 1];
    if (text != null) {
      if (text) { const t = new TextNode(decode(text)); if (!parent._sentinel) t.parentNode = parent; parent.children.push(t); }
      continue;
    }
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const el = new El(tag);
    const cls = attrs.match(/class="([^"]*)"/);
    if (cls) el.className = cls[1];
    if (/(^|\s)hidden(\s|=|$)/.test(attrs)) el.hidden = true;
    if (!parent._sentinel) el.parentNode = parent;
    parent.children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

function makeDocument() {
  return {
    createElement: (tag) => new El(tag),
    createTextNode: (s) => new TextNode(s),
    createDocumentFragment: () => new Frag(),
  };
}

module.exports = { makeDocument, El, TextNode, Frag, parseHTML };
