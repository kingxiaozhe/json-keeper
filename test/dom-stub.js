// dom-stub.js — a tiny, dependency-free DOM good enough to run the real
// buildTree / applySearch / markText AND the full mountViewer under Node. It is
// NOT a spec DOM — just the surface those paths touch: element creation, class/
// dataset/attribute/style/hidden, textContent, innerHTML (parsed into a real
// child tree with attributes), append/appendChild, addEventListener + click(),
// node ops for highlight surgery (childNodes, nodeType/nodeValue, parentNode,
// replaceChild incl. fragments, normalize), and a small CSS selector engine
// (tag, .class, [attr], [attr="v"], :not(.class), and one descendant combinator).

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
const VOID = new Set(["input", "img", "br", "hr", "meta", "link", "col", "source"]);

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
    this.attrs = {};
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
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "class") this.className = String(v); }
  removeAttribute(k) { delete this.attrs[k]; if (k === "class") this.className = ""; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set innerHTML(v) { const kids = parseHTML(String(v)); kids.forEach((k) => (k.parentNode = this)); this.children = kids; this._text = ""; }
  append(...nodes) { nodes.forEach((n) => { n.parentNode = this; this.children.push(n); }); }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { const l = this._listeners[t]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  // test helper: fire a listener (no real event system)
  dispatch(type, ev) { (this._listeners[type] || []).forEach((fn) => fn(ev || { preventDefault() {}, stopPropagation() {} })); }
  click() { this.dispatch("click"); }
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
  _eachEl(fn) { for (const ch of this.children) { if (ch.nodeType === 1) { fn(ch); ch._eachEl(fn); } } }
  querySelector(sel) { return this._find(sel, false); }
  querySelectorAll(sel) { return this._find(sel, true); }
  _find(sel, all) {
    const groups = sel.split(",").map((s) => s.trim()).filter(Boolean);
    const out = [], seen = new Set();
    for (const g of groups) {
      const steps = g.split(/\s+/).filter(Boolean).map(parseCompound);
      const last = steps[steps.length - 1], ancestry = steps.slice(0, -1);
      this._eachEl((node) => {
        if (!matchCompound(node, last)) return;
        if (!ancestorsMatch(node, ancestry)) return;
        if (!seen.has(node)) { seen.add(node); out.push(node); }
      });
    }
    return all ? out : out[0] || null;
  }
}

// ---- selector matching ----
function parseCompound(str) {
  const not = [];
  str = str.replace(/:not\(\.([\w-]+)\)/g, (_, c) => { not.push(c); return ""; });
  const attrs = [];
  str = str.replace(/\[([\w:-]+)(?:="([^"]*)")?\]/g, (_, k, v) => { attrs.push({ k, v: v === undefined ? null : v }); return ""; });
  const classes = [];
  str = str.replace(/\.([\w-]+)/g, (_, c) => { classes.push(c); return ""; });
  const tag = (str.match(/^[a-zA-Z][\w-]*/) || [""])[0];
  return { tag, classes, attrs, not };
}
function matchCompound(node, c) {
  if (node.nodeType !== 1) return false;
  if (c.tag && node.tagName !== c.tag.toUpperCase()) return false;
  if (!c.classes.every((cl) => node.classList.contains(cl))) return false;
  if (c.not.some((cl) => node.classList.contains(cl))) return false;
  return c.attrs.every((a) => (a.v === null ? a.k in node.attrs : node.attrs[a.k] === a.v));
}
function ancestorsMatch(node, priors) {
  // loose descendant: each prior compound (outer→inner) must match some ancestor
  let p = node.parentNode;
  for (let i = priors.length - 1; i >= 0; i--) {
    while (p && !matchCompound(p, priors[i])) p = p.parentNode;
    if (!p) return false;
    p = p.parentNode;
  }
  return true;
}

// ---- HTML parsing ----
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
    let a; const areg = /([a-zA-Z_:][\w:.-]*)(?:="([^"]*)")?/g;
    while ((a = areg.exec(attrs))) {
      const name = a[1], val = a[2] === undefined ? "" : decode(a[2]);
      el.attrs[name] = val;
      if (name === "class") el.className = val;
      else if (name === "hidden") el.hidden = true;
      else if (name.startsWith("data-")) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    }
    if (!parent._sentinel) el.parentNode = parent;
    parent.children.push(el);
    if (!selfClose && !VOID.has(tag.toLowerCase())) stack.push(el);
  }
  return root;
}

function makeDocument() {
  return {
    createElement: (tag) => new El(tag),
    createTextNode: (s) => new TextNode(s),
    createDocumentFragment: () => new Frag(),
    documentElement: null,
    addEventListener() {},
    querySelector() { return null; },
  };
}

module.exports = { makeDocument, El, TextNode, Frag, parseHTML };
