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
    this._cls = new Set();
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
      _s: this._cls,
      // add/remove 都是可变参数的 —— search.js 就在用 remove("jk-dim","jk-current")，
      // 只收一个的桩会让 jk-current 永远清不掉，下一条关于它的断言会假红或假绿（L-007）。
      add: (...cs) => cs.forEach((c) => this._cls.add(c)),
      remove: (...cs) => cs.forEach((c) => this._cls.delete(c)),
      contains: (c) => this._cls.has(c),
      toggle: (c, on) => (on === undefined ? (this._cls.has(c) ? this._cls.delete(c) : this._cls.add(c)) : on ? this._cls.add(c) : this._cls.delete(c)),
    };
  }
  // className 与 classList 是**同一份状态**（真实 DOM 里 classList 就是 className 的活视图）。
  // 桩里各存一份的话，`el.className = "jk-row"` 之后 `classList.contains("jk-row")` 是 false ——
  // 于是"这一行是不是树的行"这类断言恒假、恒绿，而产品里两种写法混用（建树用 className，
  // 高亮/降调用 classList）。L-007：桩留不住的等价关系 = 测不到的行为。
  set className(v) { this._cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this._cls.add(c)); }
  get className() { return [...this._cls].join(" "); }
  // innerHTML 赋值会销毁旧子树 —— 所以记忆化的查询结果也必须一起失效，否则
  // 反复 mount 时桩会把每次都是新元素演成同一个元素被塞了很多次，
  // 凭空造出一个产品并不存在的泄漏（L-007：桩的保真度决定网说的是真话还是假话）。
  set innerHTML(v) { this._html = String(v); this.children.length = 0; this._q.clear(); }
  get innerHTML() { return this._html; }
  // 聚合自身 HTML 的文本 + 全部子节点 —— 与真 DOM 的 textContent 语义一致。
  set textContent(v) { this._text = String(v); this._html = ""; this.children.length = 0; }
  get textContent() {
    return (this._text || stripTags(this._html)) +
      this.children.map((c) => (c.textContent === undefined ? "" : c.textContent)).join("");
  }
  append(...kids) { this.children.push(...kids); }
  appendChild(k) { this.children.push(k); return k; }
  insertBefore(k, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(k); else this.children.splice(i, 0, k);
    return k;
  }
  get firstChild() { return this.children[0] || null; }
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
  // 只自匹配，不向上走（桩没有 parent 链）—— 真实 closest() 也是从自身开始查的。
  // 支持 [data-x] 与 .cls 两种最简选择器：产品里的委托处理器全是这两种形状。
  // 恒返回 null 的版本会让每个"点了会怎样"的委托分支静默不可达（L-007）。
  closest(sel) {
    const d = /^\[data-([\w-]+)\]$/.exec(sel);
    if (d) return this.dataset[d[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] !== undefined ? this : null;
    const c = /^\.([\w-]+)$/.exec(sel);
    if (c) return this.className.split(/\s+/).includes(c[1]) || this.classList.contains(c[1]) ? this : null;
    return null;
  }
  // 记住监听器并提供 _click —— 空的 addEventListener 会把回调全丢掉，
  // 于是「点了会怎样」这类断言永远测不到（L-007：桩留不住的状态 = 测不到的行为）。
  _on(type, fn) { (this._ls[type] || (this._ls[type] = [])).push(fn); }
  // 真浏览器对 disabled 元素**根本不派发 click**。桩无条件派发的话，"按钮在不该禁用的时候
  // 禁用了"这类 bug 结构上就抓不到 —— T-008 的防抖回归正好落在这个盲区里（L-007）。
  _click() {
    if (this.disabled) return;
    const e = { target: this, stopPropagation() {}, preventDefault() {} };
    (this._ls.click || []).forEach((f) => f(e));
  }
  // 把整棵桩树的 innerHTML 拼起来 —— 断言就对着这串文本做。
  collectHTML() {
    return this._html + this.children.map((c) => (c.collectHTML ? c.collectHTML() : "")).join("");
  }
}

export function installDOM() {
  // document 不是 El，得有自己的监听器表 —— 溢出菜单靠 document 上的 click 来关闭。
  const docLs = {};
  // 假 requestAnimationFrame，必须能**逐帧步进**：T-010 的全部意义就是"骨架先画出来"，
  // 而单层 rAF 的回调跑在本帧 paint **之前** —— 骨架一帧都不会出现。这根轴是时序轴，
  // 立即执行的假 rAF 会把双层和单层演成一模一样，那根轴就废了。
  // （rail.js 也用 rAF，但在 scroll 回调里，测试从不触发 —— 此前桩里压根没有它也没炸。）
  let frameQ = [];
  globalThis.requestAnimationFrame = (fn) => frameQ.push(fn);
  globalThis.cancelAnimationFrame = () => {};
  // 跑一帧：只跑**当前排队的**回调；帧内新排的留到下一帧（真实浏览器就是这样，
  // 也正是双层 rAF 能跨帧的原因 —— 一次跑光就等于单层）。
  const frame = () => { const q = frameQ; frameQ = []; q.forEach((f) => f(0)); };
  const pendingFrames = () => frameQ.length;
  // 帧队列是全局的：上一条测试没跑完的回调会漏进下一条，pendingFrames 就开始数别人的帧。
  const resetFrames = () => { frameQ = []; };
  // popup.js 靠 getElementById 取元素，而那些元素来自 popup.html（桩不解析 HTML）。
  // 测试自己建元素、注册进来 —— 验的仍是 popup.js 的真实逻辑，只是把 DOM 递给它。
  const byId = new Map();
  globalThis.document = {
    getElementById: (id) => byId.get(id) || null,
    _register(id, el) { byId.set(id, el); return el; },
    _clearIds() { byId.clear(); },
    createElement: (t) => new El(t),
    // 文本节点：贡献 textContent、不贡献 innerHTML（真实 DOM 里文本节点没有标记）。
    // 面包屑用它做段间分隔符 —— 分隔符不该是可点的按钮，纯文本最忠实。
    createTextNode: (v) => ({ textContent: String(v) }),
    addEventListener(type, fn) { (docLs[type] || (docLs[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      const a = docLs[type]; if (!a) return;
      const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    documentElement: new El("html"),
    _fire(type) { (docLs[type] || []).forEach((f) => f({ target: null, stopPropagation() {} })); },
    _count(type) { return (docLs[type] || []).length; },
  };
  return { El, frame, pendingFrames, resetFrames };
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
