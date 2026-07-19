// 防护网 — 工具栏的信息架构与 addMenuItem 契约（T-004）。
//
// 为什么这个文件能存在，而 mount.test.mjs 覆盖不到工具栏按钮：
// BAR_HTML 是 innerHTML 字符串（桩不解析 → 按钮是幻影），但**溢出菜单是 createElement 建的**
// → 桩够得着。所以 IA 这一层是可测的，那就必须测 —— 后面四个 feature 全靠 addMenuItem 挂载，
// 这个契约破了，它们没有别的入口。
//
// 仍测不到的：分段器/Copy/搜索框的点击（幻影元素）→ 冒烟清单第 11–19 项。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM();
const JK = loadJK();

// 直接 mount 工具栏（不经 mountViewer），ctx 用探针记录调用
function mountBar(ctx) {
  const root = makeMount();
  root.innerHTML = JK.toolbar.BAR_HTML;
  const calls = [];
  const bar = JK.toolbar.mount(root, Object.assign({
    onView: (v) => calls.push(["view", v]),
    onCopy: () => calls.push(["copy"]),
    onDownload: () => calls.push(["download"]),
    onFold: (on) => calls.push(["fold", on]),
    onSort: () => calls.push(["sort"]),
  }, ctx));
  const pop = root.querySelector("[data-menu-pop]");
  const items = () => pop.children.flatMap((g) => g.children.map((b) => b));
  const byId = (id) => items().find((b) => b.dataset.id === id);
  return { root, bar, calls, pop, items, byId };
}

test("三段式 —— 常驻的必须常驻，偶发的必须收纳", async (t) => {
  await t.test("Copy JSON / 分段器 / 结构钮 / 搜索框 / 元信息 / 徽章 留在栏上", () => {
    // v0.10：Raw/Min 退出分段器（源码常驻左侧编辑器，Raw 标签会去重复它）；新增 ☰ 结构按钮。
    for (const needle of ['data-act="copy"', 'data-act="pretty"', 'data-act="table"', 'data-act="rail"',
                          'class="jk-search"', "data-meta", "data-chip"]) {
      assert.ok(JK.toolbar.BAR_HTML.includes(needle), `${needle} 必须在一级栏，不该被收纳`);
    }
    // Raw/Min 确实已从一级栏移除
    for (const gone of ['data-act="raw"', 'data-act="min"']) {
      assert.ok(!JK.toolbar.BAR_HTML.includes(gone), `${gone} 应已退役（源码进了左侧编辑器）`);
    }
  });

  await t.test("信任徽章不在菜单里 —— 它是护城河，永不收纳", () => {
    const { items } = mountBar();
    assert.ok(!items().some((b) => /big-int/i.test(b.textContent)), "徽章不该出现在溢出菜单");
    assert.ok(JK.toolbar.BAR_HTML.includes("data-chip"), "徽章必须在一级栏");
  });

  await t.test("Collapse all / Sort / Download / 主题 / 配色 收进菜单，不在一级栏", () => {
    for (const gone of ['data-act="fold"', 'data-act="sort"', 'data-act="dl"', 'data-act="theme"']) {
      assert.ok(!JK.toolbar.BAR_HTML.includes(gone), `${gone} 应已收进 ⋯ 菜单，不该留在一级栏`);
    }
  });

  // 原标题写着"有且仅有这五项"，而断言只列了四个 id —— 第五项（换肤行）没有 dataset.id，
  // 被 .filter(Boolean) 正好吃掉。filter 还顺带让"新增项必须走 addMenuItem"这个副标题失效：
  // 塞个无 id 的项进去，它照样绿。标题声称的性质必须有对应断言（L-011）。
  await t.test("菜单里有且仅有这五项：fold / sort / dl / theme + 换肤行", () => {
    const { items } = mountBar();
    assert.deepEqual(items().map((b) => b.dataset.id), ["fold", "sort", "dl", "theme", undefined],
      "四个按钮 + 一个换肤 label 行（无 id）");
    assert.equal(items().length, 5);
  });
});

test("addMenuItem —— 后续四个 feature 挂载新功能的唯一入口", async (t) => {
  // 原来这条声明了 let hit = 0 就再也没管它 —— 从头到尾没点击、没断言 hit，
  // 只验了存在性和 textContent。标题说"可点、onClick 会跑"，那就得真的点（L-011）。
  await t.test("加进去的项可点，onClick 会跑", () => {
    const { bar, byId } = mountBar();
    let hit = 0;
    bar.addMenuItem({ id: "schema", group: "export", label: "导出 Schema", onClick: () => hit++ });
    assert.ok(byId("schema"), "新项应出现在菜单里");
    assert.equal(byId("schema").textContent, "导出 Schema");
    byId("schema")._click();
    assert.equal(hit, 1, "onClick 必须真的被调用 —— 后面四个 feature 全靠它");
    byId("schema")._click();
    assert.equal(hit, 2);
  });

  await t.test("同 group 的项聚在一起（feature 3 的导出族要和 Download 同组）", () => {
    const { bar, pop } = mountBar();
    bar.addMenuItem({ id: "schema", group: "export", label: "导出 Schema", onClick() {} });
    const exportGroup = pop.children.find((g) => g.dataset.group === "export");
    assert.deepEqual(exportGroup.children.map((b) => b.dataset.id), ["dl", "schema"]);
  });

  await t.test("新 group 会新建分组（feature 4 的历史/Diff）", () => {
    const { bar, pop } = mountBar();
    const before = pop.children.length;
    bar.addMenuItem({ id: "history", group: "data", label: "历史记录", onClick() {} });
    assert.equal(pop.children.length, before + 1);
  });

  await t.test("返回句柄的 setLabel / setVisible / setActive 都真的生效", () => {
    const { bar, byId } = mountBar();
    const h = bar.addMenuItem({ id: "x", group: "misc", label: "原标签", onClick() {} });
    h.setLabel("新标签");
    assert.equal(byId("x").textContent, "新标签");
    h.setVisible(false);
    assert.equal(byId("x").hidden, true);
    h.setActive(true);
    assert.ok(byId("x").classList.contains("on"));
  });

  await t.test("label 是文本节点不是 innerHTML —— 菜单文案将来可能含用户数据", () => {
    const { bar, byId } = mountBar();
    bar.addMenuItem({ id: "evil", group: "misc", label: "<img src=x onerror=alert(1)>", onClick() {} });
    assert.equal(byId("evil").innerHTML, "", "用了 textContent 就不会有 innerHTML");
    assert.equal(byId("evil").textContent, "<img src=x onerror=alert(1)>");
  });
});

test("Collapse all —— 状态与标签必须同步（拆分前的老 bug 就出在这）", async (t) => {
  await t.test("点一次折叠、标签变 Expand all；再点一次展开", () => {
    const { bar, calls, byId } = mountBar();
    const fold = byId("fold");
    fold._click();
    assert.deepEqual(calls.at(-1), ["fold", true]);
    assert.equal(fold.textContent, "⤡ Expand all");
    fold._click();
    assert.deepEqual(calls.at(-1), ["fold", false]);
    assert.equal(fold.textContent, "⤢ Collapse all");
  });

  // 老 BAR_HTML 里 fold 按钮带 style="display:none" 默认隐藏；addMenuItem 没这个默认。
  // 而 setFoldable 只在 renderTree 里调，setView("raw"/"min") 不调 → Raw 下它可见但是死键，
  // 点一下还会把标签翻成"Expand all"（对着一棵其实全展开的树撒谎）。
  // 触发面不只是大文件：任何存了 jk:view=raw 的用户，每个文件都中。
  await t.test("默认隐藏 —— Raw/Min 从不建树，可见的它就是个会撒谎的死键", () => {
    const { byId } = mountBar();
    assert.equal(byId("fold").hidden, true, "建出来就该是隐藏的，等 renderTree 调 setFoldable 才现身");
  });

  await t.test("setFoldable(false) 隐藏它 —— 纯标量顶层不该有一个点了没反应的按钮", () => {
    const { bar, byId } = mountBar();
    bar.setFoldable(false);
    assert.equal(byId("fold").hidden, true);
    bar.setFoldable(true);
    assert.equal(byId("fold").hidden, false);
  });

  await t.test("resetFold 把内部状态和标签一起归位（Sort/搜索展开树之后要用）", () => {
    const { bar, calls, byId } = mountBar();
    byId("fold")._click();                       // 现在是 collapsed
    assert.equal(byId("fold").textContent, "⤡ Expand all");
    bar.resetFold();
    assert.equal(byId("fold").textContent, "⤢ Collapse all", "标签要归位");
    byId("fold")._click();
    assert.deepEqual(calls.at(-1), ["fold", true], "状态也要归位：下一次点击应该是折叠，不是展开");
  });
});

test("菜单开关", async (t) => {
  await t.test("初始关闭，点 ⋯ 打开，再点关闭", () => {
    const { root, bar } = mountBar();
    const btn = root.querySelector("[data-menu-btn]"), pop = root.querySelector("[data-menu-pop]");
    // 注意：**不断言初始的 pop.hidden**。它由 BAR_HTML 的 hidden 属性给出，而桩不解析 HTML
    // 字符串 → 读到的是 El.hidden 的默认值 false，不是产品行为（L-011 踩过的坑）。
    // 初始的关闭态改由模块自己的状态来验，那是产品真的持有的东西。
    assert.equal(bar.isMenuOpen(), false, "初始应关闭");
    btn._click();
    assert.equal(bar.isMenuOpen(), true);
    assert.equal(pop.hidden, false, "打开时 setOpen 真的设过 hidden=false");
    assert.equal(btn.getAttribute("aria-expanded"), "true");
    btn._click();
    assert.equal(bar.isMenuOpen(), false);
    assert.equal(pop.hidden, true, "关闭时 setOpen 真的设过 hidden=true");
    assert.equal(btn.getAttribute("aria-expanded"), "false");
  });

  await t.test("点页面别处会关掉菜单（否则弹窗挡着 JSON）", () => {
    const { root, bar } = mountBar();
    root.querySelector("[data-menu-btn]")._click();
    assert.equal(bar.isMenuOpen(), true);
    document._fire("click");   // 模拟点到菜单外
    assert.equal(bar.isMenuOpen(), false);
  });

  // viewer 页每点一次 Format 就调一次 mountViewer。实测过：不清理的话 document 上的
  // click 监听器会线性累积（5 次 render → 5 个），每个还钉着一个已废弃的 pop 元素。
  // 而反复粘贴调试正是 viewer 页的主场景。
  await t.test("反复 mount 不在 document 上累积监听器", () => {
    delete document.__jkMenuClose;
    const before = document._count("click");
    for (let i = 0; i < 5; i++) mountBar();
    assert.equal(document._count("click"), before + 1,
      `mount 5 次后 document 上应只剩 1 个 click 监听器，实得 ${document._count("click") - before}`);
  });

  await t.test("点菜单项后菜单自动关闭", () => {
    const { root, byId } = mountBar();
    root.querySelector("[data-menu-btn]")._click();
    byId("dl")._click();
    assert.equal(root.querySelector("[data-menu-pop]").hidden, true, "点完一项该关掉，否则挡着 JSON");
  });
});

// 换肤是这次**唯一从 BAR_HTML（幻影元素，L-010 说测不到）搬进 createElement（桩够得着）**
// 的控件 —— 免死金牌到期了。对抗审查独立选靶实测：这半边 7 个变异 **7/7 存活**。
// 这是 L-009 第四次重演：我打的靶全落在我写了断言的函数上。
test("换肤 —— 从测不到变成测得到，就必须测", async (t) => {
  await t.test("菜单里有换肤行，四个配色齐全", () => {
    const { pop } = mountBar();
    const row = pop.children.flatMap((g) => g.children).find((b) => b.className.includes("jk-menu-row"));
    assert.ok(row, "换肤行应在菜单里");
    for (const s of ["default", "solarized", "monokai", "github"]) {
      assert.ok(row.innerHTML.includes('value="' + s + '"'), `缺配色 ${s}`);
    }
  });

  await t.test("换肤行有 class —— 丢了菜单里样式全乱", () => {
    const { pop } = mountBar();
    const row = pop.children.flatMap((g) => g.children).find((b) => b.tagName === "LABEL");
    assert.ok(row.className.includes("jk-menu-i"), "必须带 jk-menu-i");
    assert.ok(row.className.includes("jk-menu-row"), "必须带 jk-menu-row");
  });

  await t.test("选配色会立刻生效 + 存盘（只存不生效 = 选了没反应）", () => {
    const c = installChrome({});
    try {
      const { root } = mountBar();
      const sel = root.querySelector("[data-menu-pop]").children
        .flatMap((g) => g.children).find((b) => b.tagName === "LABEL").querySelector("select");
      sel.value = "monokai";
      (sel._ls.change || []).forEach((f) => f({ target: sel }));
      assert.equal(c.data["jk:skin"], "monokai", "必须存盘，否则重开就丢");
      assert.equal(document.documentElement.getAttribute("data-jk-skin"), "monokai", "必须立刻生效");
    } finally { c.uninstall(); }
  });

  await t.test("启动时恢复存的配色", () => {
    const c = installChrome({ "jk:skin": "solarized" });
    try {
      mountBar();
      assert.equal(document.documentElement.getAttribute("data-jk-skin"), "solarized");
    } finally { c.uninstall(); document.documentElement.removeAttribute("data-jk-skin"); }
  });

  await t.test("default 配色移除属性而不是写 data-jk-skin=default", () => {
    const c = installChrome({});
    try {
      JK.toolbar.applySkin(makeMount(), "monokai");
      assert.equal(document.documentElement.getAttribute("data-jk-skin"), "monokai");
      JK.toolbar.applySkin(makeMount(), "default");
      assert.equal(document.documentElement.getAttribute("data-jk-skin"), null, "default 应移除属性");
    } finally { c.uninstall(); }
  });
});

test("Sort 状态必须在常驻区可见（不能只靠菜单里的高亮）", async (t) => {
  // jk:sort 跨会话持久化 → 排序一次，之后每个 JSON 都被重排，而 Copy JSON 复制的正是
  // 重排后的内容。菜单关着时那个高亮谁也看不见 —— 一个卖"不偷改你的数据"的产品
  // 不能把这件事藏在关着的菜单后面。
  await t.test("setSorted(true) 同时点亮菜单项和常驻徽章", () => {
    const { root, bar, byId } = mountBar();
    const chip = root.querySelector("[data-sortchip]");
    bar.setSorted(true);
    assert.ok(byId("sort").classList.contains("on"), "菜单项要高亮");
    assert.equal(chip.hidden, false, "常驻徽章必须显示 —— 否则用户不知道复制走的是重排过的 JSON");
  });

  await t.test("setSorted(false) 两处一起熄灭", () => {
    const { root, bar, byId } = mountBar();
    bar.setSorted(true);
    bar.setSorted(false);
    assert.ok(!byId("sort").classList.contains("on"));
    assert.equal(root.querySelector("[data-sortchip]").hidden, true);
  });

  await t.test("徽章在一级栏里，不在菜单里", () => {
    assert.ok(JK.toolbar.BAR_HTML.includes("data-sortchip"), "必须在 BAR_HTML（常驻区）");
    const { pop } = mountBar();
    assert.ok(!pop.children.flatMap((g) => g.children).some((b) => /A→Z/.test(b.textContent) && b.dataset.id !== "sort"));
  });
});

test("主题 —— 循环与记忆", async (t) => {
  await t.test("auto → light → dark → auto，标签跟着变", () => {
    const c = installChrome({});
    try {
      const { byId } = mountBar();
      const th = byId("theme");
      assert.equal(th.textContent, "◐ Theme: auto");
      th._click(); assert.equal(th.textContent, "☀ Theme: light");
      th._click(); assert.equal(th.textContent, "☾ Theme: dark");
      th._click(); assert.equal(th.textContent, "◐ Theme: auto");
    } finally { c.uninstall(); }
  });

  await t.test("切主题会存盘", () => {
    const c = installChrome({});
    try {
      byIdClick();
      function byIdClick() { const { byId } = mountBar(); byId("theme")._click(); }
      assert.equal(c.data["jk:theme"], "light");
    } finally { c.uninstall(); }
  });

  await t.test("启动时恢复存的主题", () => {
    const c = installChrome({ "jk:theme": "dark" });
    try {
      const { byId } = mountBar();
      assert.equal(byId("theme").textContent, "☾ Theme: dark");
    } finally { c.uninstall(); }
  });

  // mount 不许抹掉 theme-boot 已经设好的属性。原来 mount 里有一句同步 renderTheme()，
  // 那时 theme 还是 "auto"，而 applyTheme(_, "auto") 就是 removeAttribute("data-jk-theme")
  // ——打在 documentElement 上，正是 theme-boot 刚写的那个节点。
  // 后果：深 →（点 Format）→ 白 → 深，给"记住深色"的用户平添一次白闪。
  // 279 条测试当时一条都没碰过 documentElement。
  await t.test("mount 不抹掉 theme-boot 设好的属性（异步 storage = 真实 Chrome）", async () => {
    const c = installChrome({ "jk:theme": "dark" }, { async: true });
    try {
      document.documentElement.setAttribute("data-jk-theme", "dark"); // theme-boot 已落地
      mountBar();
      assert.equal(document.documentElement.getAttribute("data-jk-theme"), "dark",
        "mount 返回瞬间属性必须还在 —— 抹掉就是一次全页白闪");
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(document.documentElement.getAttribute("data-jk-theme"), "dark", "回调后仍是 dark");
    } finally { c.uninstall(); document.documentElement.removeAttribute("data-jk-theme"); }
  });

  await t.test("存的是 auto 时不留属性 —— 否则 tokens.css 跟随系统那层失效", async () => {
    const c = installChrome({ "jk:theme": "auto" }, { async: true });
    try {
      mountBar();
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(document.documentElement.getAttribute("data-jk-theme"), null);
    } finally { c.uninstall(); }
  });

  await t.test("没存过主题时也不留属性（新用户）", async () => {
    const c = installChrome({}, { async: true });
    try {
      mountBar();
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(document.documentElement.getAttribute("data-jk-theme"), null);
    } finally { c.uninstall(); }
  });
});
