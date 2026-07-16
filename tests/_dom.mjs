// 最小 DOM 桩 —— 只为让 buildTree 跑起来并**捕获它生成的 HTML 字符串**。
//
// 为什么不用 jsdom：零依赖是本项目的硬约束（coding-style.md），且我们要验的不是浏览器行为，
// 是"拼进 innerHTML 的那串文本有没有被转义"。捕获字符串就够了。
//
// buildTree 的用法：createElement → 设 className/textContent/innerHTML → append/appendChild
// → 对容器行 querySelector('.jk-caret'/'.jk-prev'/'.jk-count') 拿句柄挂 _collapse。
// 因为内容是 innerHTML **字符串**（不是真元素），querySelector 无从查起 —— 返回哑元件即可，
// buildTree 只是给它们赋属性和挂监听，不读回内容。
// 从 innerHTML 串里剥标签取可见文本 —— 树的行内容是 HTML 字符串，不剥就永远搜不到东西。
// 真 DOM 的 textContent 会聚合子树；桩不聚合的话 search.run() 恒 0 命中，而它看起来是绿的。
const stripTags = (h) =>
  String(h).replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this._text = "";
    this._html = "";
    this.dataset = {};
    this.style = {};
    this._attrs = {};
    this._q = new Map();
    this._ls = {};
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
  set innerHTML(v) { this._html = String(v); this.children.length = 0; }
  get innerHTML() { return this._html; }
  // 聚合自身 HTML 的文本 + 全部子节点 —— 与真 DOM 的 textContent 语义一致。
  set textContent(v) { this._text = String(v); this._html = ""; this.children.length = 0; }
  get textContent() {
    return (this._text || stripTags(this._html)) +
      this.children.map((c) => (c.textContent === undefined ? "" : c.textContent)).join("");
  }
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
  addEventListener(t, fn) { this._on(t, fn); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  removeAttribute(k) { delete this._attrs[k]; }
  getAttribute(k) { return this._attrs[k] ?? null; }
  closest() { return null; }
  // 记住监听器并提供 _click —— 空的 addEventListener 会把回调全丢掉，
  // 于是「点了会怎样」这类断言永远测不到（L-007：桩留不住的状态 = 测不到的行为）。
  _on(type, fn) { (this._ls[type] || (this._ls[type] = [])).push(fn); }
  _click() { const e = { target: this, stopPropagation() {}, preventDefault() {} };
    (this._ls.click || []).forEach((f) => f(e)); }
  // 把整棵桩树的 innerHTML 拼起来 —— 断言就对着这串文本做。
  collectHTML() {
    return this._html + this.children.map((c) => (c.collectHTML ? c.collectHTML() : "")).join("");
  }
}

export function installDOM() {
  // document 不是 El，得有自己的监听器表 —— 溢出菜单靠 document 上的 click 来关闭。
  const docLs = {};
  globalThis.document = {
    createElement: (t) => new El(t),
    addEventListener(type, fn) { (docLs[type] || (docLs[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      const a = docLs[type]; if (!a) return;
      const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    documentElement: new El("html"),
    _fire(type) { (docLs[type] || []).forEach((f) => f({ target: null, stopPropagation() {} })); },
    _count(type) { return (docLs[type] || []).length; },
  };
  return { El };
}

// 假 chrome.storage.local —— 不是锦上添花，是必需的。
// 没有它，util.js 的 store.get 会走 catch → cb(undefined) → 所有 "if (v) 恢复设置" 分支
// 全部不可达 → applySort / 主题恢复 / 排序恢复 在测试里**一次都不执行**。
// 对抗审查证明：正因如此，把 applySort 整个改成空操作，141 条测试照样全绿。
//
// deliver 可切同步/异步：真实 Chrome 是异步的，而 catch 兜底路径是同步的 —— 这个差异
// 本身就能造成"测试通过但线上炸"，所以两种都要能测。
export function installChrome(initial, opts) {
  const data = Object.assign({}, initial);
  const async = !!(opts && opts.async);
  const deliver = (fn) => (async ? setTimeout(fn, 0) : fn());
  globalThis.chrome = {
    storage: {
      local: {
        get(k, cb) { deliver(() => cb({ [k]: data[k] })); },
        set(obj, cb) { Object.assign(data, obj); if (cb) deliver(cb); },
        remove(k, cb) { delete data[k]; if (cb) deliver(cb); },
      },
    },
  };
  return { data, uninstall() { delete globalThis.chrome; } };
}

export function makeMount() {
  return new El("div");
}
