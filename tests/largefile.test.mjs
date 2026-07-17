// 防护网 — 大文件降级说明 + 构建树入口 + 建树加载态（T-010）。
//
// 病根：状态栏说 "large file, tree built on demand"，**却不给你一个提出 demand 的地方**。
// Pretty 标签确实会建树，但没有任何东西把那句话和那个标签连起来 —— 句子读起来是个死胡同。
//
// 本套的靶子**先于测试选定**（L-009 的判据）：先列这个模块对外可观察的轴 ——
// 可见性 / 接线 / **时序** / 清理 / 状态同步 —— 再逐轴写断言。没有断言的轴 = 必然存活的靶。
// 其中时序是本任务的全部意义：单层 rAF 的回调跑在本帧 paint **之前**，骨架一帧都不会出现，
// 而代码里"确实有 rAF"。所以桩的假 rAF 必须能逐帧步进，一次跑光就等于把双层演成单层。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

const { El, frame, pendingFrames, resetFrames } = installDOM();
const JK = loadJK();

// LARGE 是 1_000_000（util.js）—— 造一份真的超过它的 JSON，不改产品阈值来迁就测试（L-004）
const BIG = JSON.stringify({ big: "x".repeat(1_100_000), n: 1 });
const SMALL = JSON.stringify({ a: 1, b: { c: 2 } });

const mount = (text) => {
  resetFrames();   // 帧队列全局共用，上一条测试的余帧会被这条数进去
  const root = makeMount();
  JK.mountViewer(root, text, { showErrors: false });
  return root;
};
const statusOf = (root) => root.querySelector("[data-status]");
const prettyOf = (root) => root.querySelector("[data-pretty]");
// 树的行是 `className = "jk-row"` 赋出来的，**不进 innerHTML** —— 拿 collectHTML().match(/jk-row/)
// 数永远得 0，那种断言恒假（"树没建"永远成立），和 T-009 的恒真断言是同一个坑的镜像。
// 必须走真实的子元素。
const treeRows = (root) => {
  const holder = prettyOf(root).children[0];
  return holder ? holder.children.filter((r) => r.classList.contains("jk-row")) : [];
};
const hasTree = (root) => treeRows(root).length > 0;
const hasSkeleton = (root) => /jk-skel/.test(prettyOf(root).innerHTML);
// 状态栏/按钮都是 innerHTML 串，桩不解析 —— 但**处理器逻辑本身是真的**：
// 造一个带 data-build 的元素当 e.target，走的是 status.js 里同一行委托代码。
// 测不到的是"那个按钮在 HTML 里到底有没有 data-build"→ 冒烟兜底。
const clickBuild = (root) => {
  const btn = new El("button");
  btn.dataset.build = "";
  (statusOf(root)._ls.click || []).forEach((f) => f({ target: btn }));
};

test("大文件降级说明给得出一个'提出 demand'的地方", async (t) => {
  await t.test("大文件：状态栏出现 Build tree 入口", () => {
    const c = installChrome({});
    try {
      const html = statusOf(mount(BIG)).innerHTML;
      assert.match(html, /large file, tree built on demand/, "前提：确实进了 heavy 分支");
      assert.match(html, /data-build/, "说了 on demand 就得给个提 demand 的地方，否则是死胡同");
    } finally { c.uninstall(); }
  });

  await t.test("大文件的说明带上体积（用户得知道'大'是多大）", () => {
    const c = installChrome({});
    try {
      assert.match(statusOf(mount(BIG)).innerHTML, /1\.\d+ MB/);
    } finally { c.uninstall(); }
  });

  await t.test("小文件：不该冒出 Build tree（树本来就建好了）", () => {
    const c = installChrome({});
    try {
      const html = statusOf(mount(SMALL)).innerHTML;
      assert.ok(!/data-build/.test(html), "树都建完了还让人点'构建树'，是在演");
    } finally { c.uninstall(); }
  });

  await t.test("建完树后入口消失，换成真实统计", () => {
    const c = installChrome({});
    try {
      const root = mount(BIG);
      clickBuild(root);
      frame(); frame();
      const html = statusOf(root).innerHTML;
      assert.ok(!/data-build/.test(html), "已经建完了还挂着入口 = 状态栏在撒谎");
      assert.ok(!/built on demand/.test(html), "'tree built on demand' 也该撤掉");
      assert.match(html, /nodes/, "该换成真实统计了");
    } finally { c.uninstall(); }
  });
});

test("Build tree 不是死键（T-004 的老病：按钮长得对，点了没用）", async (t) => {
  await t.test("点了真的会建树", () => {
    const c = installChrome({});
    try {
      const root = mount(BIG);
      assert.equal(hasTree(root), false, "前提：一开始没有树");
      clickBuild(root);
      frame(); frame();
      assert.ok(hasTree(root), "点了没树 = 死键");
    } finally { c.uninstall(); }
  });

  await t.test("点了会切到 Pretty（不然树建好了还在看原文）", () => {
    const c = installChrome({});
    try {
      const root = mount(BIG);
      assert.equal(prettyOf(root).hidden, true, "前提：大文件开在 Raw");
      clickBuild(root);
      frame(); frame();
      assert.equal(prettyOf(root).hidden, false);
      assert.equal(root.querySelector("[data-raw]").hidden, true);
    } finally { c.uninstall(); }
  });
});

// ——— 时序轴：本任务的全部意义 ———
test("骨架真的会先出现 —— 单层 rAF 是错的", async (t) => {
  await t.test("点完立刻就有骨架（不是先冻住几秒再说）", () => {
    const c = installChrome({});
    try {
      const root = mount(BIG);
      clickBuild(root);
      assert.ok(hasSkeleton(root), "点完到第一帧之间必须已经有东西可画");
      assert.ok(!hasTree(root), "此刻还不该建树 —— 建了就没人看得见骨架");
    } finally { c.uninstall(); }
  });

  // 这条是单层 rAF 的墓志铭：单层的回调跑在**本帧 paint 之前** —— 骨架 DOM 进了树却从没被画出来，
  // 建树把主线程锁死几秒，浏览器直到建完才画第一帧，一次性画出成品树。用户看到的是纯冻结。
  // 双层意味着：第 1 帧只画骨架，第 2 帧才干活。
  await t.test("第 1 帧不建树 —— 这一帧是留给骨架被画出来的", () => {
    const c = installChrome({});
    try {
      const root = mount(BIG);
      clickBuild(root);
      frame();
      assert.ok(!hasTree(root),
        "第 1 帧就建树 = 单层 rAF = 骨架一帧都不会出现（而代码里'确实有 rAF'）");
      assert.ok(hasSkeleton(root), "第 1 帧结束时骨架还在，它就是这一帧要画的东西");
      assert.equal(pendingFrames(), 1, "并且已经排好了第 2 帧 —— 不然就是永远不建了");
    } finally { c.uninstall(); }
  });

  await t.test("第 2 帧建树，并把骨架收走", () => {
    const c = installChrome({});
    try {
      const root = mount(BIG);
      clickBuild(root);
      frame(); frame();
      assert.ok(hasTree(root), "第 2 帧该干活了");
      assert.ok(!hasSkeleton(root), "树都出来了骨架还留着 = 两份内容并排");
    } finally { c.uninstall(); }
  });

  await t.test("连点两次不建两棵树", () => {
    const c = installChrome({});
    try {
      const root = mount(BIG);
      clickBuild(root);
      clickBuild(root);
      frame(); frame(); frame(); frame();
      const n = prettyOf(root).children.length;
      assert.equal(n, 1, `prettyEl 下挂了 ${n} 棵树 —— 大文件建两次 = 白冻一次`);
    } finally { c.uninstall(); }
  });

  await t.test("小文件不走骨架（本来就是瞬间的，闪一下骨架反而更差）", () => {
    const c = installChrome({});
    try {
      const root = mount(SMALL);
      assert.ok(hasTree(root), "小文件当场就该有树，不用等帧");
      assert.ok(!hasSkeleton(root));
    } finally { c.uninstall(); }
  });
});

// ——— 偏好轴：v0.8.0 就在线上的 bug ———
test("系统替你做的决定，不许写进你的偏好", async (t) => {
  await t.test("打开大文件不把 Raw 写成跨会话默认", () => {
    const c = installChrome({});
    try {
      mount(BIG);
      assert.equal(c.data["jk:view"], undefined,
        "用户从没选过 Raw，是我们替他选的 —— 写进去 = 从此每个小 JSON 都默认 Raw");
    } finally { c.uninstall(); }
  });

  await t.test("打开大文件不覆盖已存的 Pretty 偏好", () => {
    const c = installChrome({ "jk:view": "pretty" });
    try {
      mount(BIG);
      assert.equal(c.data["jk:view"], "pretty", "他的偏好还是 pretty，只是这一份文件开在 Raw");
    } finally { c.uninstall(); }
  });

  await t.test("点 Build tree 也不改偏好 —— 它是这份文件的补救，不是对以后每份的表态", () => {
    const c = installChrome({ "jk:view": "raw" });
    try {
      const root = mount(BIG);
      clickBuild(root);
      frame(); frame();
      assert.equal(c.data["jk:view"], "raw", "想表态有 Pretty 标签在那儿，那个是会存的");
    } finally { c.uninstall(); }
  });

  await t.test("但用户自己点 Pretty 标签，照旧要存", () => {
    const c = installChrome({});
    try {
      const root = mount(SMALL);
      root.querySelector('[data-act="raw"]')._click();
      assert.equal(c.data["jk:view"], "raw", "这才是用户的表态");
    } finally { c.uninstall(); }
  });

  await t.test("搜索把你拽回 Pretty，也不算你的表态", () => {
    const c = installChrome({ "jk:view": "raw" });
    try {
      const root = mount(SMALL);
      const inp = root.querySelector(".jk-search input");
      inp.value = "a";
      (inp._ls.input || []).forEach((f) => f({ target: inp }));
      assert.equal(c.data["jk:view"], "raw", '打字是"找 a"，不是"以后都给我看树"');
    } finally { c.uninstall(); }
  });
});

// ——— 异步轴：storage 回调的到达顺序 ———
// 上面那组用的是**同步**假 storage，而它把回调顺序整个反过来了：jk:sort 的回调在 heavy 分支
// 之前就跑完，那个窗口根本不存在。真实 chrome.storage 是异步的 ——
//   mount: store.get("jk:sort", cb)         ← 排队
//   mount: if (heavy) setView("raw", false) ← 同步跑，不写偏好
//   …cb 到达 → applySort() → setView(bar.currentView())  ← 这里又把 raw 写回去了
// 于是"用过一次 ⇅ Sort 的人"完整地拿回了那个 v0.8.0 的 bug。
// 这是 L-016 的字面重演：那条教训写的就是"凡在 storage 回调里赋值的状态都要用 async 测"，
// 而我在写下它的**同一个任务里**又犯了一次。所以这组必须存在。
test("异步 storage 下，偏好照样不许被系统的决定覆盖", async (t) => {
  const settle = () => new Promise((r) => setTimeout(r, 5));

  await t.test("开着 Sort 打开大文件：不写 jk:view", async () => {
    const c = installChrome({ "jk:sort": true }, { async: true });
    try {
      mount(BIG);
      await settle();
      frame(); frame();
      assert.equal(c.data["jk:view"], undefined,
        "jk:sort 的回调里 applySort → setView 又把 raw 写回去了 —— 那个 bug 原样复活");
    } finally { c.uninstall(); }
  });

  await t.test("开着 Sort 打开大文件：不覆盖已存的 pretty", async () => {
    const c = installChrome({ "jk:sort": true, "jk:view": "pretty" }, { async: true });
    try {
      mount(BIG);
      await settle();
      frame(); frame();
      assert.equal(c.data["jk:view"], "pretty", "他的偏好是 pretty，别替他改成 raw");
    } finally { c.uninstall(); }
  });

  await t.test("异步下打开大文件（没开 Sort）也一样", async () => {
    const c = installChrome({ "jk:view": "pretty" }, { async: true });
    try {
      mount(BIG);
      await settle();
      assert.equal(c.data["jk:view"], "pretty");
    } finally { c.uninstall(); }
  });

  await t.test("小文件 + Sort：applySort 不该把当前视图写成偏好", async () => {
    const c = installChrome({ "jk:sort": true, "jk:view": "raw" }, { async: true });
    try {
      mount(SMALL);
      await settle();
      assert.equal(c.data["jk:view"], "raw", "重排一下树不代表用户对视图表了态");
    } finally { c.uninstall(); }
  });
});
