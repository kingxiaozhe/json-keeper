// 防护网 — 树空态与搜索无结果态（T-009）。
//
// 这两个状态的共同病根：**产品用"少画一点"来表达"什么都没有"**，而"少画一点"和"画坏了"
// 在用户眼里长得一样。
//   · 搜索无结果 → 把**全部 7/7 行**加 jk-dim（opacity .26）+ 工具栏一个光秃秃的 "0"
//   · 空容器     → `{ 0 keys }`，和 `{ 8 keys }` 同一个待遇
// 两条都是实测的现状，不是假想。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM();
const JK = loadJK();
const buildTree = JK.tree.build;

const text = (el) => el.collectHTML().replace(/<[^>]*>/g, "");

test("空容器明说自己是空的 —— 不能和渲染失败长一样", async (t) => {
  await t.test("空对象", () => {
    const m = makeMount();
    buildTree({}, m);
    assert.match(text(m), /empty object/);
    assert.ok(!/0 keys/.test(text(m)), '"0 keys" 与 "8 keys" 同一个待遇，一眼分不出是空的还是坏的');
  });

  await t.test("空数组", () => {
    const m = makeMount();
    buildTree([], m);
    assert.match(text(m), /empty array/);
    assert.ok(!/0 items/.test(text(m)));
  });

  await t.test("嵌套的空容器同样明说", () => {
    const m = makeMount();
    buildTree({ data: [], meta: {} }, m);
    assert.match(text(m), /empty array/);
    assert.match(text(m), /empty object/);
  });

  await t.test("非空容器照旧报数（别把正常情况也改了）", () => {
    const m = makeMount();
    buildTree({ a: { x: 1, y: 2 }, b: [1, 2, 3] }, m);
    assert.match(text(m), /2 keys/);
    assert.match(text(m), /3 items/);
    assert.ok(!/empty/.test(text(m)));
  });

  // 设计写的是"空态说明**行**"，实现是就地替换头行上的计数。偏离的理由不是"搜 empty 会命中
  // 非数据行" —— 审查实测打脸：就地替换照样命中 1 条非数据行（计数文本本来就在 rows 里，
  // 搜 "keys" 一直都能命中）。那个理由只是把 2 减成 1，没消除任何东西。
  // 真实理由：计数位置本来就在头行上，空态是同一个信息的不同措辞，不该为它多造一行结构。
  await t.test("空态说明就在头行上，不多造一行结构", () => {
    const tr = buildTree({ data: [] }, makeMount());
    const hits = tr.rows.filter((r) => r.textContent.toLowerCase().includes("empty"));
    assert.equal(hits.length, 1);
    assert.equal(hits[0], tr.byPath.get("data"), "说明该长在 data 那行上，而不是它下面新增的一行");
  });
});

test("搜索无结果 —— 别把整棵树变暗", async (t) => {
  const mountViewer = (json) => {
    const root = makeMount();
    JK.mountViewer(root, JSON.stringify(json), { showErrors: false });
    return root;
  };
  const searchInput = (root) => root.querySelector(".jk-search input");
  // jk-dim 是 classList.add 加的，**不进 innerHTML** —— 拿 collectHTML().match(/jk-dim/) 数
  // 永远得 0，那条断言恒真、什么都没验（L-012 又一次）。必须走真实的行对象。
  const rows = (root) => {
    const pretty = root.querySelector("[data-pretty]");
    const treeDiv = pretty.children[0];
    return treeDiv ? treeDiv.children : [];
  };
  const dimCount = (root) => rows(root).filter((r) => r.classList.contains("jk-dim")).length;
  const typeSearch = (root, q) => {
    const inp = searchInput(root);
    inp.value = q;
    (inp._ls.input || []).forEach((f) => f({ target: inp }));
  };

  // 下面三条测的是**从没被看过的三根轴**：DOM 顺序、mount 初始态、findN。
  // 我自选的 6 个变异全落在 sayNoHits 的调用路径上（我的测试恰好覆盖的那部分），
  // 于是"6/6 全抓"是循环论证 —— 对抗审查用 3 个存活变异证明了这点（L-009 第四次）。
  // 「条必须挂在树区**顶部**」这条轴，本套网**够不到**，别装作够得到：
  // 真实 DOM 里 scrollEl 有两个孩子（[data-pretty] / [data-raw]，来自 SHELL 的 innerHTML 串）；
  // 桩不解析 innerHTML，scrollEl 是个没有孩子的哑元件 —— 于是 insertBefore(noHits, firstChild=null)
  // 与 appendChild 产出完全一样，把条挂到底部的变异**存活**。恒真的断言比没有断言更坏（L-010）。
  // → 冒烟清单第 26 条：长树搜无结果，条必须立刻可见，不用滚到底。

  // hidden 默认 false，而 .jk-nohits 有 padding + border-bottom + background。
  // 只在同步 storage 下测，这行 init 是**冗余**的：core 的 store.get("jk:view") 回调会 setView
  // → onViewChange → 把 hidden 设回 true。但真实 chrome.storage 是**异步**的 —— 回调到达之前
  // 那条空白灰条就挂在树顶上了。假 storage 的同步送达把这个窗口整个盖住（T-007 主题闪白同款）。
  await t.test("刚 mount 时结果条就是藏着的 —— 不等 storage 回调（异步窗口里也不许闪）", async () => {
    const c = installChrome({}, { async: true });
    try {
      const root = mountViewer({ a: 1 });
      const bar = root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      assert.ok(bar, "前提：条已经建出来了（不然下面这句恒真）");
      assert.equal(bar.hidden, true, "storage 回调还没到，树顶不该已经挂着一条空白灰条");
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(bar.hidden, true, "回调到达后仍然藏着");
    } finally { c.uninstall(); }
  });

  await t.test("零命中时计数报 0/0 —— 不许还挂着上一次的 1/1", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ alpha: 1, beta: 2 });
      const findN = root.querySelector("[data-find]");
      typeSearch(root, "alpha");
      assert.equal(findN.textContent, "1/1", "前提：先搜出一个有结果态");
      typeSearch(root, "alphaz");   // 再敲一个字符 → 0 命中，真人就是这么搜的
      assert.equal(findN.textContent, "0/0", "工具栏还写着 1/1 就是在撒谎（T-003 那类）");
    } finally { c.uninstall(); }
  });

  await t.test("零命中时一行都不该变暗（此前是 7/7 全暗 = 看起来坏了）", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ a: 1, b: 2, c: { d: 3 } });
      assert.ok(rows(root).length > 0, "前提：树真的建出来了（不然下面数 0 毫无意义）");
      typeSearch(root, "zzzz");
      assert.equal(dimCount(root), 0, "什么都没找到，就不该把任何东西降调 —— 那是坏了的样子");
    } finally { c.uninstall(); }
  });

  await t.test("零命中时出现明说的结果条，且带上搜的词", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ a: 1 });
      typeSearch(root, "zzzz");
      const bar = root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      assert.ok(bar, "该有一条 jk-nohits");
      assert.equal(bar.hidden, false);
      assert.match(bar.textContent, /zzzz/, "该告诉用户是哪个词没找到");
    } finally { c.uninstall(); }
  });

  await t.test("有命中时结果条隐藏，非命中行照旧变暗", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ alpha: 1, beta: 2, gamma: 3 });
      typeSearch(root, "alpha");
      const bar = root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      assert.equal(bar.hidden, true, "找到了就不该还挂着没找到");
      assert.ok(dimCount(root) > 0, "非命中行仍该降调 —— 那是有结果时的正常表达");
    } finally { c.uninstall(); }
  });

  await t.test("从无结果改到有结果，结果条要撤掉", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ alpha: 1 });
      const bar = () => root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      typeSearch(root, "zzzz");
      assert.equal(bar().hidden, false);
      typeSearch(root, "alpha");
      assert.equal(bar().hidden, true);
    } finally { c.uninstall(); }
  });

  await t.test("清空搜索框，结果条也要撤掉", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ alpha: 1 });
      const bar = () => root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      typeSearch(root, "zzzz");
      assert.equal(bar().hidden, false);
      typeSearch(root, "");
      assert.equal(bar().hidden, true);
    } finally { c.uninstall(); }
  });

  // ⇅ Sort 会把整棵树扔掉重建，而 search.reset() 负责收拾残局。一条描述旧树的"没找到"
  // 继续挂着，就和 T-003 里那个"计数还报 1/1 而高亮打在废弃行上"是同一类谎。
  await t.test("排序后结果条要撤掉（树都换了，旧结论说的不是这棵树）", () => {
    const c = installChrome({ "jk:sort": true });
    try {
      const root = mountViewer({ alpha: 1 });
      const bar = () => root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      typeSearch(root, "zzzz");
      assert.equal(bar().hidden, false, "前提：先搜出一个无结果态");
      // 点 ⋯ 菜单里的 Sort
      const pop = root.querySelector("[data-menu-pop]");
      const sortItem = pop.children.flatMap((g) => g.children).find((b) => b.dataset.id === "sort");
      sortItem._click();
      assert.equal(bar().hidden, true, "排序重建了树，旧的没找到必须撤掉");
      assert.equal(searchInput(root).value, "", "搜索框也该清空 —— 它描述的是上一棵树");
    } finally { c.uninstall(); }
  });

  // 结果条说的是**树**。v0.10 Raw 视图退役后，右栏仅剩的非树视图是 Table —— 切到 Table 时
  // 「No match for "zzzz"」同样必须撤掉（它描述的是树，不是表格；从别处搜索也会被 ensurePretty
  // 拽回 Pretty）。search.onViewChange 只在 view==="pretty" 时留住这条。
  await t.test("切到 Table 时结果条要撤掉 —— 它说的是树，不是表格", () => {
    const c = installChrome({});
    try {
      const root = mountViewer([{ alpha: 1 }]);   // 对象数组：Table 可用
      const bar = () => root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      typeSearch(root, "zzzz");
      assert.equal(bar().hidden, false, "前提：Pretty 下先有个无结果态");
      root.querySelector('[data-act="table"]')._click();
      assert.equal(bar().hidden, true, "Table 上方不该挂着关于树的结论");
    } finally { c.uninstall(); }
  });

  await t.test("切回 Pretty 时结果条要回来（结论仍然成立）", () => {
    const c = installChrome({});
    try {
      const root = mountViewer([{ alpha: 1 }]);
      const bar = () => root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      typeSearch(root, "zzzz");
      root.querySelector('[data-act="table"]')._click();
      root.querySelector('[data-act="pretty"]')._click();
      assert.equal(bar().hidden, false, "树回来了，那条结论也该回来");
    } finally { c.uninstall(); }
  });

  await t.test("没搜过时切 Raw/Pretty 都不该冒出结果条", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ alpha: 1 });
      const bar = () => root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      root.querySelector('[data-act="raw"]')._click();
      assert.equal(bar().hidden, true);
      root.querySelector('[data-act="pretty"]')._click();
      assert.equal(bar().hidden, true, "没搜过就没有结论可说");
    } finally { c.uninstall(); }
  });

  await t.test("搜的词走 textContent —— 它是用户输入，不该被当标记解析", () => {
    const c = installChrome({});
    try {
      const root = mountViewer({ a: 1 });
      typeSearch(root, "<img src=x onerror=alert(1)>");
      const bar = root.querySelector(".jk-scroll").children.find((x) => x.className === "jk-nohits");
      assert.equal(bar.innerHTML, "", "用 textContent 就不会有 innerHTML —— 没有解析的地方就没有注入面");
      assert.match(bar.textContent, /<img/, "但文字本身要照实显示出来");
    } finally { c.uninstall(); }
  });
});
