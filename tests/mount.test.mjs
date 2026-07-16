// 防护网 — mountViewer 的装配层（T-003 新增）。
//
// ⚠ 先读这段，别高估这个文件。
//
// **能测的**：接管契约（true/false）、依赖检查、三个信任信号的渲染、状态栏形态、
// storage 恢复分支（排序/视图/大文件降级）、rail 的显隐判定。
//
// **测不到的**（结构性，不是懒）：任何依赖工具栏按钮或结构栏按钮的行为 —— Collapse all、
// 视图分段器、搜索框、**rail 点击 → jumpToPath → tree.jumpTo 整条链**。
// 产品用 `innerHTML` 字符串建 UI，而 `_dom.mjs` 是手写桩、**不解析 HTML**，于是
// `$('[data-act="fold"]')` 拿到的是幻影元素，`querySelectorAll()` 恒返回 `[]` ——
// rail 的点击监听在测试里**从未挂上**。
//
// 实测存活的变异（对抗审查，不是假想）：删掉 `bar.setFoldable()`、删掉 `rail.render()`、
// Collapse all 变死键、`currentView()` 硬编码、**core 漏传 `jumpTo` 给 rail（结构栏直接抛异常死掉）**、
// `jumpToPath` 删掉 `renderTree()`、删掉 `setView("pretty")`、`tree.build` 漏传 `scrollEl`、
// rail 点击写死 `items[0]`。**全部 160 条测试照样绿。**
//
// 这些行为归 `.claude/rules/testing.md` 的手动冒烟清单管（那里已按此加了对应项）。
// 不引 jsdom 是有意的：这个扩展的立身之本是零依赖、无远程代码、审核可读。
//
// 写在这里是为了**不让下一个人误以为这层有网**。见 LESSONS L-009。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDOM, makeMount } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
installDOM();
const JK = loadJK();

const mount = (value, opts) =>
  JK.mountViewer(makeMount(), typeof value === "string" ? value : JSON.stringify(value), opts || { showErrors: false });

test("接管契约 —— content.js 唯一依赖的东西", async (t) => {
  await t.test("合法 JSON 返回 true（会接管）", () => {
    assert.equal(mount({ a: 1 }), true);
  });

  await t.test("非 JSON 返回 false（不动宿主页）", () => {
    assert.equal(mount("<html>hi</html>"), false);
  });

  await t.test("坏 JSON 且 showErrors:false 返回 false —— 接管页必须原样留住页面", () => {
    assert.equal(mount('{"a":'), false);
  });

  await t.test("坏 JSON 且 showErrors:true 渲染错误但仍返回 false", () => {
    const root = makeMount();
    assert.equal(JK.mountViewer(root, '{"a":', { showErrors: true }), false);
    assert.match(root.collectHTML(), /Not valid JSON/);
  });

  await t.test("错误信息经 esc —— 坏文本是本项目最直接的注入面", () => {
    const root = makeMount();
    JK.mountViewer(root, '{"<script>alert(1)</script>":', { showErrors: true });
    assert.ok(!root.collectHTML().includes("<script>alert(1)"), "错误面板未转义 = XSS");
  });
});

test("依赖检查 —— 模块缺失时必须在调用方动手之前说不", async (t) => {
  // content.js 拿到 true 就 body.textContent = ""。树是在异步 storage 回调里建的，
  // 所以"先返回 true 再抛异常"= 页面已毁、无从挽回。L-006 的教训。
  const MODULES = ["tree", "toolbar", "search", "rail", "status"];
  for (const m of MODULES) {
    await t.test(`缺 JK.${m} 时返回 false，而不是毁页面`, () => {
      const saved = JK[m];
      delete JK[m];
      try {
        assert.equal(mount({ a: 1 }), false, `缺 ${m} 却返回 true —— content.js 会清空宿主页`);
      } finally {
        JK[m] = saved;
      }
    });
  }
});

test("信任信号 —— 三个都必须在装配后真的渲染出来", async (t) => {
  await t.test("big-int 徽章走 toolbar 的数据入口", () => {
    const root = makeMount();
    JK.mountViewer(root, '{"id":136986234663732436}', { showErrors: false });
    const chip = root.querySelector("[data-chip]");
    assert.equal(chip.textContent, "✓ 1 big-ints exact");
  });

  await t.test("无大整数时徽章仍在（承诺不因数据而消失）", () => {
    const root = makeMount();
    JK.mountViewer(root, '{"a":1}', { showErrors: false });
    assert.equal(root.querySelector("[data-chip]").textContent, "✓ big-ints precise");
  });

  await t.test("元信息（大小 · 计数）走 toolbar 的数据入口", () => {
    const root = makeMount();
    JK.mountViewer(root, '{"a":1,"b":2}', { showErrors: false });
    assert.match(root.querySelector("[data-meta]").textContent, /B · 2 keys/);
  });

  await t.test("重复 key 警告出现在状态栏", () => {
    const root = makeMount();
    JK.mountViewer(root, '{"a":1,"a":2}', { showErrors: false });
    const html = root.querySelector("[data-status]").innerHTML;
    assert.match(html, /duplicate key/);
    assert.match(html, /last value shown/);
  });

  await t.test("状态栏常驻信任文案", () => {
    const root = makeMount();
    JK.mountViewer(root, '{"a":1}', { showErrors: false });
    assert.match(root.querySelector("[data-status]").innerHTML, /no telemetry/);
  });
});

test("status.render —— 状态栏的两种形态", async (t) => {
  const { warnHTML } = JK.status;

  await t.test("重复 key 超 4 个时截断", () => {
    const h = warnHTML(["a", "b", "c", "d", "e"]);
    assert.match(h, /…/);
    assert.match(h, /5 duplicate keys/);
  });

  await t.test("单个重复 key 用单数", () => {
    assert.match(warnHTML(["a"]), /1 duplicate key:/);
  });

  await t.test("无重复时不出警告", () => {
    assert.equal(warnHTML([]), "");
  });

  await t.test("重复 key 名经 esc —— key 是不可信数据", () => {
    assert.ok(!warnHTML(["<img src=x>"]).includes("<img"));
  });
});

test("rail.shouldShow —— 扁平 JSON 不该有大纲", async (t) => {
  await t.test("无嵌套 → 不显示", () => {
    assert.equal(JK.rail.shouldShow([{ key: "a", leaf: true }, { key: "b", leaf: true }, { key: "c", leaf: true }]), false);
  });

  await t.test("有嵌套但顶层项 < 3 → 不显示", () => {
    assert.equal(JK.rail.shouldShow([{ key: "a", n: 2 }, { key: "b", leaf: true }]), false);
  });

  await t.test("有嵌套且顶层项 ≥ 3 → 显示", () => {
    assert.equal(JK.rail.shouldShow([{ key: "a", n: 2 }, { key: "b", leaf: true }, { key: "c", leaf: true }]), true);
  });
});

// 以下这组在补上假 chrome.storage 之前**根本跑不到** —— store.get 走 catch → cb(undefined)
// → 所有 "if (v) 恢复" 分支不可达 → applySort 在测试里一次都没执行过。对抗审查证明：
// 把 applySort 整个改成空操作，141 条测试照样全绿。这是 L-007（桩的保真度）第三次咬人。
test("排序与搜索 —— 靠假 chrome.storage 才可达的那一半", async (t) => {
  const { installChrome } = await import("./_dom.mjs");

  await t.test("jk:sort=true 时启动即排序（显示与复制一致）", () => {
    const c = installChrome({ "jk:sort": true });
    try {
      const root = makeMount();
      JK.mountViewer(root, '{"b":1,"a":2}', { showErrors: false });
      // 树挂在 prettyEl 上，而桩的 querySelector 是记忆化的 —— 取同一个对象才看得到树
      const html = root.querySelector("[data-pretty]").collectHTML();
      assert.ok(html.indexOf('"a"') < html.indexOf('"b"'), `排序未生效: ${html.slice(0, 160)}`);
    } finally { c.uninstall(); }
  });

  await t.test("jk:sort 未设置时保持原始顺序", () => {
    const c = installChrome({});
    try {
      const root = makeMount();
      JK.mountViewer(root, '{"b":1,"a":2}', { showErrors: false });
      const html = root.querySelector("[data-pretty]").collectHTML();
      assert.ok(html.indexOf('"b"') < html.indexOf('"a"'), `不该擅自排序: ${html.slice(0, 160)}`);
    } finally { c.uninstall(); }
  });

  await t.test("jk:view=raw 时启动进 Raw 视图，且显示的是原始源", () => {
    const c = installChrome({ "jk:view": "raw" });
    try {
      const root = makeMount();
      JK.mountViewer(root, '{ "a" : 1 }', { showErrors: false, originalText: '{ "a" : 1 }' });
      assert.equal(root.querySelector("[data-raw]").hidden, false, "应显示 Raw");
      assert.equal(root.querySelector("[data-pretty]").hidden, true);
      // Raw 必须是原始源（带原空格），不是 minified —— 两者写反了用户就看不到真正的原文
      assert.equal(root.querySelector("[data-raw]").textContent, '{ "a" : 1 }');
    } finally { c.uninstall(); }
  });

  await t.test("jk:view=min 时显示压缩版，不是原始源", () => {
    const c = installChrome({ "jk:view": "min" });
    try {
      const root = makeMount();
      JK.mountViewer(root, '{ "a" : 1 }', { showErrors: false, originalText: '{ "a" : 1 }' });
      assert.equal(root.querySelector("[data-raw]").textContent, '{"a":1}');
    } finally { c.uninstall(); }
  });

  await t.test("jk:view 是未知值时回落 Pretty（向后兼容，feature 2 会加 table）", () => {
    const c = installChrome({ "jk:view": "table" });
    try {
      const root = makeMount();
      JK.mountViewer(root, '{"a":1}', { showErrors: false });
      assert.equal(root.querySelector("[data-pretty]").hidden, false);
    } finally { c.uninstall(); }
  });

  await t.test("大文件无视 jk:view 直接进 Raw（树按需构建）", () => {
    const c = installChrome({ "jk:view": "pretty" });
    try {
      const root = makeMount();
      const big = '{"a":"' + "x".repeat(1_100_000) + '"}';
      JK.mountViewer(root, big, { showErrors: false });
      assert.equal(root.querySelector("[data-raw]").hidden, false, "大文件必须走 Raw，否则卡死标签页");
      assert.match(root.querySelector("[data-status]").innerHTML, /large file/);
    } finally { c.uninstall(); }
  });

  // 这里原本有一条「Raw 视图下跳转会先切回 Pretty」—— 已删除，它是安慰剂：
  // ① 它从头到尾**没有触发跳转**，只断言了两个前提（删掉 setView("pretty") 整行，它照样绿）；
  // ② 更糟的是第二个断言与生产**相反**：jk:view=raw 新开时 rail.render 一次都不会调
  //    （renderTree 只在 setView("pretty") 里调），生产里 railEl.hidden 是 true。
  //    测试读到 false 纯粹因为桩不解析 SHELL 的 hidden 属性、El.hidden 默认 false。
  // rail 的点击路径结构性测不到（按钮是幻影元素，L-010）→ 已进冒烟清单第 16–18 项。

  await t.test("异步投递（真实 Chrome 的行为）下同样正确", () => {
    const c = installChrome({ "jk:view": "raw" }, { async: true });
    try {
      const root = makeMount();
      assert.equal(JK.mountViewer(root, '{"a":1}', { showErrors: false }), true);
    } finally { c.uninstall(); }
  });
});

test("模块登记 —— 拆分后每个模块都必须挂上", () => {
  const jsFiles = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).content_scripts[0].js;
  for (const m of ["util", "tree", "toolbar", "search", "rail", "status"]) {
    assert.equal(typeof JK[m], "object", `JK.${m} 没挂上 —— 是不是被整对象赋值覆盖了？`);
    assert.ok(jsFiles.includes(m + ".js"), `${m}.js 没登记进 manifest —— Chrome 里根本不会加载`);
  }
  assert.equal(typeof JK.mountViewer, "function");
  assert.equal(typeof JK.normalize, "function");
});
