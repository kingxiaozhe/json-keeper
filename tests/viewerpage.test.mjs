// 防护网 — viewer 页粘贴框（T-011 的元素核对挖出来的洞）。
//
// T-008 花了整个任务在 popup 上消灭"点了没反应"（被替代品 44 条差评的头号来源），
// 而 **viewer 页是另一个粘贴入口，原样带着那个病**：空输入点 Format → `out.innerHTML = ""`
// → 什么都不发生、零解释。而且它正是 popup.js 注释里说的"带着坏 JSON 去修的地方" ——
// popup 把人送过去，那边的按钮却是个哑巴。
//
// 没有任何任务覆盖这个面：T-007 加了粘贴区，T-008 的任务书写的是"popup 三态"。
// 两个面的拒绝措辞必须一致，所以 `guardEmpty` 在 util 里只有一份（popup 与 viewer 曾各写
// 一份主题代码，token 在一个版本内就漂了）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDOM, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { El } = installDOM();
loadJK();
globalThis.window = globalThis;

const VIEWER_JS = readFileSync(join(ROOT, "viewer.js"), "utf8");

// viewer.js 的 DOM 来自 viewer.html（桩不解析 HTML，L-010）—— 测试自己建那三个元素注册进
// getElementById，跑的仍是 viewer.js 的真实源码。
function mountPage(initial) {
  document._clearIds();
  const input = document._register("in", new El("textarea"));
  const go = document._register("go", new El("button"));
  const out = document._register("out", new El("div"));
  input.value = initial || "";
  new Function(VIEWER_JS).call(globalThis);
  return { input, go, out };
}
const type = (p, text) => {
  p.input.value = text;
  (p.input._ls.input || []).forEach((f) => f({ target: p.input }));
};

// 桩的 _click() 早就有（`_dom.mjs`），还特意实现了"disabled 不派发 click"。所以下面这些
// **没有任何结构障碍** —— 我第一版 8 条断言只读了 `go.disabled` 和 `go.title` 两个属性，
// **一次都没点过那个按钮**，于是"删掉 click 监听"「删掉 ⌘+Enter」「删掉交接后的 render」
// 「showErrors 翻成 false」「删掉 originalText」六个变异全部存活、370 条全绿。
// 一个叫「Format 不是哑巴」的测试文件，抓不住"按钮根本没接线"。L-009 第六次。
test("Format 按钮真的接在渲染上（不是长得像按钮）", async (t) => {
  await t.test("点 Format 会渲染", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      type(p, '{"a":1}');
      p.go._click();
      assert.ok(p.out.collectHTML().length > 0, "点了没渲染 = 按钮没接线，正是本任务要消灭的病");
    } finally { c.uninstall(); }
  });

  await t.test("⌘/Ctrl+Enter 也会渲染（F-012 明文要的快捷键）", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      type(p, '{"a":1}');
      (p.input._ls.keydown || []).forEach((f) => f({ metaKey: true, key: "Enter", preventDefault() {} }));
      assert.ok(p.out.collectHTML().length > 0);
    } finally { c.uninstall(); }
  });

  await t.test("坏 JSON 点下去要给出错误 —— 这才是那条'修复路'真的通", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      type(p, '{"a":}');
      p.go._click();
      assert.match(p.out.collectHTML(), /Not valid JSON/,
        "showErrors 翻成 false 的话这里静默无反应 —— 我注释里歌颂的修复路就死了");
    } finally { c.uninstall(); }
  });

  // 原本这里有一条「originalText 得传下去」。查证后删掉了**参数本身**：
  // `original = (opts.originalText != null ? opts.originalText : rawText)`，而两个调用方
  // （content.js / viewer.js）传的都和 rawText **同一个变量** —— 回退路径给出完全相同的结果，
  // 那个参数是死的。feature 5 的修复模式也不需要它（应用建议后输入框原文就变了，喂进来的仍是同一串）。
  // L-008：一个自己的测试都分辨不出差异的"参数"，就是在骗读代码的人 —— 删掉，别为它补测试。
  await t.test("Raw 视图显示的是原始源，含 XSSI 前缀", () => {
    const c = installChrome({ "jk:view": "raw" });
    try {
      const p = mountPage("");
      type(p, ')]}\'\n{"a":1}');
      p.go._click();
      // Raw 面板是 `rawEl.textContent = original` 赋的，**不进 innerHTML** —— 拿 collectHTML()
      // 匹配永远得空（第一版就是这么写的，当场红）。同一个坑今天第三次：
      // jk-dim(classList) / jk-row(className) / 这里(textContent)。
      assert.match(p.out.querySelector("[data-raw]").textContent, /\)\]\}/,
        "Raw 卖的就是'原样'，剥掉 XSSI 前缀就不是原样了");
    } finally { c.uninstall(); }
  });

  await t.test("popup 交接过来的内容要**渲染出来**，不只是填进框里", async () => {
    const c = installChrome({ "jk:pending": '{"a":1}' }, { async: true });
    try {
      const p = mountPage("");
      await new Promise((r) => setTimeout(r, 5));
      assert.ok(p.out.collectHTML().length > 0, "框里有 JSON、下面一片空白 —— 交接等于白做");
    } finally { c.uninstall(); }
  });

  await t.test("交接完要清掉 jk:pending（冒烟第 10 条）", async () => {
    const c = installChrome({ "jk:pending": '{"a":1}' }, { async: true });
    try {
      mountPage("");
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(c.data["jk:pending"], undefined, "不清的话下次开 viewer 又蹦出上次的 JSON");
    } finally { c.uninstall(); }
  });
});

test("viewer 页的 Format 不是哑巴", async (t) => {
  await t.test("空输入：按钮禁用（不是等你点一下才发现没反应）", () => {
    const c = installChrome({});
    try {
      assert.equal(mountPage("").go.disabled, true);
    } finally { c.uninstall(); }
  });

  await t.test("禁用时说明为什么，且和 popup 说的是同一句话", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      assert.ok(p.go.title, "禁用了却不说为什么，等于换个方式沉默");
      assert.equal(p.go.title, JK.util.EMPTY_HINT, "两个粘贴面必须给同一个理由");
    } finally { c.uninstall(); }
  });

  await t.test("只有空白字符也算空", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      type(p, "  \n\t ");
      assert.equal(p.go.disabled, true);
    } finally { c.uninstall(); }
  });

  await t.test("有内容立刻启用 —— 不许有防抖窗口（T-008 的回归就是这个）", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      type(p, '{"a":1}');
      assert.equal(p.go.disabled, false, "粘完立刻点就得能用");
      assert.equal(p.go.title, "");
    } finally { c.uninstall(); }
  });

  await t.test("清空后回到禁用", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      type(p, '{"a":1}');
      type(p, "");
      assert.equal(p.go.disabled, true);
    } finally { c.uninstall(); }
  });

  // popup 交接过来的文本是直接赋 value 的，**不触发 input 事件** —— 只在 input 上同步的话，
  // 从 popup 过来的人会看到一个装满 JSON 却禁用着的按钮。
  await t.test("popup 交接过来的内容也要让按钮活过来", async () => {
    const c = installChrome({ "jk:pending": '{"a":1}' }, { async: true });
    try {
      const p = mountPage("");
      assert.equal(p.go.disabled, true, "前提：storage 回调还没到，框还是空的");
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(p.input.value, '{"a":1}', "前提：交接内容到位了");
      assert.equal(p.go.disabled, false, "框里满是 JSON，按钮却是死的 —— 赋 value 不触发 input");
    } finally { c.uninstall(); }
  });

  // popup.js 的注释把这里称作"修复路"：带着坏 JSON 过来，文本在可编辑区、错误在下方。
  // 禁用按钮会把那条路堵死。
  await t.test("坏 JSON 不禁用按钮 —— 这里是 popup 说的那条修复路", () => {
    const c = installChrome({});
    try {
      const p = mountPage("");
      type(p, '{"a":}');
      assert.equal(p.go.disabled, false);
    } finally { c.uninstall(); }
  });
});
