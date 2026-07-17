// 防护网 — popup 的三态（T-008）。
//
// popup.js 的 DOM 来自 popup.html（桩不解析 HTML，L-010），但**逻辑本身是可测的**：
// 测试自己建那三个元素注册进 getElementById，跑的仍是 popup.js 的真实源码。
// 测不到的是布局与真实渲染 → 冒烟清单。
//
// 为什么这三态要紧：「用不了/不知道怎么用」是被替代品最大的差评来源（44 条），
// 而"空输入框 + 一个点了没反应的按钮"就是那条差评本身。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDOM, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { El } = installDOM();
loadJK(); // 把 JK / JSONBig 挂到 globalThis

// popup.js 读的是 `window.JK.util` —— 那是它在浏览器里的真实写法，不为迁就测试去改源码（L-004）。
// 浏览器里 window === globalThis，这里把这层等价补上。
globalThis.window = globalThis;

const POPUP_JS = readFileSync(join(ROOT, "popup.js"), "utf8");

// 建 popup.html 里的那三个元素，跑真实的 popup.js
function mountPopup(initialText) {
  document._clearIds();
  const input = document._register("in", new El("textarea"));
  const go = document._register("go", new El("button"));
  const say = document._register("say", new El("div"));
  input.value = initialText || "";
  new Function(POPUP_JS).call(globalThis);
  return { input, go, say };
}

// 敲字 → 防抖 300ms → check()
async function type(p, text) {
  p.input.value = text;
  (p.input._ls.input || []).forEach((f) => f({ target: p.input }));
  await new Promise((r) => setTimeout(r, 350));
}

test("空输入 —— 消灭点了没反应", async (t) => {
  await t.test("初始就是禁用态（不是等你点一下才发现没反应）", () => {
    const p = mountPopup("");
    assert.equal(p.go.disabled, true);
  });

  await t.test("禁用态有 tooltip 说明为什么", () => {
    const p = mountPopup("");
    assert.ok(p.go.title, "禁用了却不说为什么，等于换了个方式沉默");
  });

  await t.test("只有空白字符也算空", async () => {
    const p = mountPopup("");
    await type(p, "   \n\t  ");
    assert.equal(p.go.disabled, true);
  });

  await t.test("有内容就启用", async () => {
    const p = mountPopup("");
    await type(p, '{"a":1}');
    assert.equal(p.go.disabled, false);
    assert.equal(p.go.title, "");
  });

  await t.test("清空后回到禁用", async () => {
    const p = mountPopup("");
    await type(p, '{"a":1}');
    await type(p, "");
    assert.equal(p.go.disabled, true);
  });

  // 设计写的是"input 事件驱动按钮 disabled" —— 只有试解析该防抖。
  // 我把两件事塞进同一个 300ms 定时器，于是粘贴后的 300ms 内按钮是禁用的：
  // ⌘V→⌘+Enter 这个连招远快于 300ms，用户得到的正是"点了没反应" —— 这个改动要消灭的
  // 头号差评，在一个旧代码根本没有的窗口里复活。
  const typeNoWait = (p, text) => {
    p.input.value = text;
    (p.input._ls.input || []).forEach((f) => f({ target: p.input }));
  };

  await t.test("粘贴后**立刻**可点 —— 启用判定不许跟着防抖走", () => {
    const p = mountPopup("");
    typeNoWait(p, '{"a":1}');
    assert.equal(p.go.disabled, false, "300ms 防抖窗口里按钮就该是活的，否则粘完立刻点 = 没反应");
  });

  await t.test("清空后**立刻**禁用（同理，不等防抖）", () => {
    const p = mountPopup("");
    typeNoWait(p, '{"a":1}');
    typeNoWait(p, "");
    assert.equal(p.go.disabled, true);
  });

  await t.test("粘贴后立刻 ⌘+Enter 就能提交（防抖窗口不该吞按键）", async () => {
    const c = installChrome({});
    let opened = null;
    globalThis.chrome.tabs = { create: (o) => { opened = o; } };
    globalThis.chrome.runtime = { getURL: (x) => x };
    globalThis.close = () => {};
    try {
      const p = mountPopup("");
      typeNoWait(p, '{"a":1}');
      // 不等 300ms —— 真人就是这么快
      (p.input._ls.keydown || []).forEach((f) => f({ metaKey: true, key: "Enter", preventDefault() {} }));
      await new Promise((r) => setTimeout(r, 5));
      assert.ok(opened, "⌘+Enter 在防抖窗口里被吞掉了");
      assert.equal(c.data["jk:pending"], '{"a":1}');
    } finally { c.uninstall(); }
  });

  await t.test("粘贴后立刻点按钮就能提交", async () => {
    const c = installChrome({});
    let opened = null;
    globalThis.chrome.tabs = { create: (o) => { opened = o; } };
    globalThis.chrome.runtime = { getURL: (x) => x };
    globalThis.close = () => {};
    try {
      const p = mountPopup("");
      typeNoWait(p, '{"a":1}');
      p.go._click();   // 桩会遵守 disabled —— 真浏览器对禁用按钮不派发 click
      await new Promise((r) => setTimeout(r, 5));
      assert.ok(opened, "按钮在防抖窗口里还禁用着 = 点了没反应");
    } finally { c.uninstall(); }
  });
});

test("非法 JSON —— 就地报错，不让你白开一个标签页", async (t) => {
  await t.test("坏 JSON：输入框警示描边 + 下方一行摘要", async () => {
    const p = mountPopup("");
    await type(p, '{"a":}');
    assert.ok(p.input.classList.contains("bad"), "输入框要标出来");
    assert.ok(p.say.className.includes("bad"));
    assert.match(p.say.textContent, /position/, "摘要要复用 jsonbig 的报错（含位置）");
  });

  await t.test("好 JSON：不报错", async () => {
    const p = mountPopup("");
    await type(p, '{"a":1}');
    assert.ok(!p.input.classList.contains("bad"));
    assert.equal(p.say.textContent, "");
  });

  await t.test("从坏改好会清掉警示（不是一红到底）", async () => {
    const p = mountPopup("");
    await type(p, '{"a":}');
    assert.ok(p.input.classList.contains("bad"));
    assert.ok(p.say.textContent.length > 0);
    await type(p, '{"a":1}');
    assert.ok(!p.input.classList.contains("bad"), "输入框的警示描边要撤掉");
    assert.equal(p.say.className, "say", "状态行的 bad 类要撤掉");
    assert.equal(p.say.textContent, "", "错误摘要要清空");
  });

  await t.test("从坏改到超长也要清掉警示（大不等于坏）", async () => {
    const p = mountPopup("");
    await type(p, '{"a":}');
    assert.ok(p.input.classList.contains("bad"));
    await type(p, '{"a":"' + "x".repeat(1_100_000) + '"}');
    assert.ok(!p.input.classList.contains("bad"), "切到大文件提示时旧的警示必须撤掉");
    assert.equal(p.say.className, "say");
  });

  // T-002 查明的：没有 normalize，popup 会把产品**宣传的容错能力**判成非法，
  // 而同一份内容进 viewer 却渲染得好好的 —— popup 等于在骂自家 viewer 说谎。
  await t.test("XSSI 前缀不被误判（产品宣传的容错能力）", async () => {
    const p = mountPopup("");
    await type(p, ')]}\'\n{"a":1}');
    assert.ok(!p.input.classList.contains("bad"), "XSSI 前缀是真实 API 的常态，不是错误");
  });

  await t.test("JSONP 包裹不被误判", async () => {
    const p = mountPopup("");
    await type(p, 'cb({"a":1})');
    assert.ok(!p.input.classList.contains("bad"));
  });

  await t.test("JSONC 注释与尾逗号不被误判", async () => {
    const p = mountPopup("");
    await type(p, '{"a":1, // note\n}');
    assert.ok(!p.input.classList.contains("bad"));
  });

  // 报错文案里没有注入面 —— 因为状态行用 textContent，压根不解释 HTML。
  //
  // 走到这一步的过程值得记：第一版用 innerHTML + esc，测试喂 {"<img …>"} 断言不含 <img ——
  // **恒真**（那个输入的报错是 "Expected ':' at position 31"，不含原文），删掉 esc 照样绿。
  // 查下去发现更根本的事实：jsonbig 全部报错里只有 `Invalid number: <字面量>` 引用原文，
  // 而数字字面量只含 0-9 e E + - .，装不下 `<img`。于是 esc 是在防一个当时不存在的洞。
  // 与其留个"为 feature 5 预留"的防御让人猜它有没有用，不如直接把洞填掉：改 textContent。
  await t.test("状态行用 textContent —— 没有解释 HTML 的地方，就没有注入面", async () => {
    const p = mountPopup("");
    await type(p, "[1e<img src=x>]");
    assert.match(p.say.textContent, /Invalid number: 1e/, "报错确实引用了粘贴的字面量");
    assert.equal(p.say.innerHTML, "", "textContent 不产生 innerHTML —— 这才是没有注入面的证据");
  });

  await t.test("非法 JSON **不禁用**按钮 —— 那会堵死通往修复模式的路", async () => {
    const p = mountPopup("");
    await type(p, '{"a":}');
    assert.equal(p.go.disabled, false, "看到错误后仍可选择进 viewer 修（feature 5 的修复面板在那）");
  });
});

test("超长输入 —— 提示而不是冻死", async (t) => {
  await t.test("超 1MB 时给出大文件提示，不报错", async () => {
    const p = mountPopup("");
    await type(p, '{"a":"' + "x".repeat(1_100_000) + '"}');
    assert.ok(!p.input.classList.contains("bad"), "大不等于坏");
    assert.match(p.say.textContent, /raw mode/i);
    assert.match(p.say.textContent, /MB/, "该告诉用户到底多大");
    assert.equal(p.go.disabled, false, "大文件照样可以打开");
  });

  // 20MB 粘贴时逐字符解析会把 popup 唯一的线程堵死几秒，而结论并不改变后续动作
  await t.test("超长时跳过试解析 —— 否则每次击键都冻住 popup", async () => {
    const p = mountPopup("");
    const t0 = Date.now();
    await type(p, "!".repeat(2_000_000)); // 非法且巨大：真去解析必然很慢
    const ms = Date.now() - t0 - 350; // 扣掉防抖
    assert.ok(ms < 120, `超长输入不该走解析，实测耗时 ${ms}ms`);
    assert.ok(!p.input.classList.contains("bad"), "没解析就不该断言它坏");
  });
});

test("交接 —— popup → viewer", async (t) => {
  await t.test("点 Format 存 jk:pending 并开 viewer 标签页", async () => {
    const c = installChrome({});
    let opened = null;
    globalThis.chrome.tabs = { create: (o) => { opened = o; } };
    globalThis.chrome.runtime = { getURL: (p) => "chrome-extension://x/" + p };
    globalThis.close = () => {};   // window.close()，window === globalThis
    try {
      const p = mountPopup("");
      await type(p, '{"a":1}');
      p.go._click();
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(c.data["jk:pending"], '{"a":1}');
      assert.match(opened.url, /viewer\.html$/);
    } finally { c.uninstall(); }
  });

  await t.test("空输入时点了也不开标签页（按钮虽禁用，逻辑也要兜住）", async () => {
    const c = installChrome({});
    let opened = null;
    globalThis.chrome.tabs = { create: (o) => { opened = o; } };
    globalThis.chrome.runtime = { getURL: (p) => p };
    globalThis.close = () => {};
    try {
      const p = mountPopup("");
      p.go._click();
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(opened, null);
      assert.equal(c.data["jk:pending"], undefined);
    } finally { c.uninstall(); }
  });
});
