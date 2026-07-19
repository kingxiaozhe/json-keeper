// 防护网 — viewer 页的交接（v0.10 重写）。
//
// v0.10 前，viewer 页是"上粘贴框 + Format 按钮 + 下方结果"，viewer.js 亲自管 guardEmpty /
// Format / ⌘Enter / 交接。v0.10 把整页变成一个全屏 mountViewer：它的**左栏就是可编辑源**，
// 于是 viewer.js 只剩一件事 —— 把 popup 交接的 jk:pending 喂给 mountViewer、然后清掉它。
//
// 原来那 13 条（空态禁用、Format 接线、⌘Enter、坏 JSON 修复路…）测的 UI 已不存在；那些行为
// 搬进了 mountViewer 的编辑管线，由 mount.test.mjs（坏 JSON→可修复外壳、空态、退役视图回落）
// 与冒烟清单接管。这里只锁 viewer.js 现在真正负责的东西：交接 + 清理 + 空/坏都不白屏。
// 显式重写而非删除 = 让"这一层职责搬走了"这件事被看见（特征化纪律 B3）。
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

// viewer.js 的 DOM 来自 viewer.html（桩不解析 HTML，L-010）—— 测试自己建 #app 注册进
// getElementById，跑的仍是 viewer.js 的真实源码。
function mountPage() {
  document._clearIds();
  const app = document._register("app", new El("div"));
  new Function(VIEWER_JS).call(globalThis);
  return { app };
}
// 交接走 chrome.storage.local.get 的异步回调（真实 Chrome 就是异步的）—— 等一拍再断言。
const settle = () => new Promise((r) => setTimeout(r, 5));

test("viewer 页交接（整页就是一个全屏 mountViewer）", async (t) => {
  await t.test("popup 交接的 JSON 渲染进页面，并落进左侧编辑器", async () => {
    const c = installChrome({ "jk:pending": '{"a":1}' }, { async: true });
    try {
      const { app } = mountPage();
      await settle();
      assert.match(app.collectHTML(), /jk-wrap/, "交接内容没挂出 viewer = 交接白做");
      assert.equal(app.querySelector("[data-src]").value, '{"a":1}', "交接文本进了左侧可编辑源");
    } finally { c.uninstall(); }
  });

  await t.test("交接完清掉 jk:pending（冒烟第 10 条）", async () => {
    const c = installChrome({ "jk:pending": '{"a":1}' }, { async: true });
    try {
      mountPage();
      await settle();
      assert.equal(c.data["jk:pending"], undefined, "不清的话下次开 viewer 又蹦出上次的 JSON");
    } finally { c.uninstall(); }
  });

  await t.test("没有交接内容也照常挂出空的可编辑 viewer（不是错误、不白屏）", async () => {
    const c = installChrome({}, { async: true });
    try {
      const { app } = mountPage();
      await settle();
      assert.match(app.collectHTML(), /jk-wrap/, "空 pending 也该挂出可编辑的空 viewer");
      assert.ok(!/Not valid JSON/.test(app.collectHTML()), "空不是错，不该冒解析错误");
    } finally { c.uninstall(); }
  });

  await t.test("坏 JSON 交接过来：挂出可修复外壳（文本在编辑器、错误在下方，不白屏）", async () => {
    const c = installChrome({ "jk:pending": '{"a":}' }, { async: true });
    try {
      const { app } = mountPage();
      await settle();
      assert.equal(app.querySelector("[data-src]").value, '{"a":}', "坏文本落进编辑器 = popup 说的那条修复路");
      assert.equal(app.querySelector("[data-src-err]").hidden, false, "错误行显示出来");
    } finally { c.uninstall(); }
  });
});
