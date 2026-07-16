// 最小 DOM 桩 —— 只为让 buildTree 跑起来并**捕获它生成的 HTML 字符串**。
//
// 为什么不用 jsdom：零依赖是本项目的硬约束（coding-style.md），且我们要验的不是浏览器行为，
// 是"拼进 innerHTML 的那串文本有没有被转义"。捕获字符串就够了。
//
// buildTree 的用法：createElement → 设 className/textContent/innerHTML → append/appendChild
// → 对容器行 querySelector('.jk-caret'/'.jk-prev'/'.jk-count') 拿句柄挂 _collapse。
// 因为内容是 innerHTML **字符串**（不是真元素），querySelector 无从查起 —— 返回哑元件即可，
// buildTree 只是给它们赋属性和挂监听，不读回内容。
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.textContent = "";
    this._html = "";
    this.dataset = {};
    this.style = {};
    this._attrs = {};
    this._q = new Map();
    this.hidden = false;
    this.value = "";
    this.children = [];
    this.offsetTop = 0;
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      contains: (c) => this.classList._s.has(c),
      toggle: (c, on) => (on === undefined ? (this.classList._s.has(c) ? this.classList._s.delete(c) : this.classList._s.add(c)) : on ? this.classList._s.add(c) : this.classList._s.delete(c)),
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  append(...kids) { this.children.push(...kids); }
  appendChild(k) { this.children.push(k); return k; }
  // 按 (元素, 选择器) 记忆化 —— 必须的，不是优化。
  // 每次返回新元素时，caret 上挂的 _collapse 会立刻被丢弃，于是 expandTo/collapseAll
  // 在测试里永远空转、变异永远抓不到。对抗审查用 5 个存活变异证明了这一点（L-001 重演）。
  querySelector(sel) {
    if (!this._q.has(sel)) this._q.set(sel, new El("span"));
    return this._q.get(sel);
  }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute(k, v) { this._attrs[k] = String(v); }
  removeAttribute(k) { delete this._attrs[k]; }
  getAttribute(k) { return this._attrs[k] ?? null; }
  closest() { return null; }
  // 把整棵桩树的 innerHTML 拼起来 —— 断言就对着这串文本做。
  collectHTML() {
    return this._html + this.children.map((c) => (c.collectHTML ? c.collectHTML() : "")).join("");
  }
}

export function installDOM() {
  globalThis.document = { createElement: (t) => new El(t) };
  return { El };
}

export function makeMount() {
  return new El("div");
}
