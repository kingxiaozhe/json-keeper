// 防护网 — 视图偏好恢复的回落规则（T-101，feature 2 前置）。
//
// feature 2 的 T-107 会给分段器加 `table`，并改 `core.js` 恢复初始视图那行
//   store.get("jk:view", (v) => setView(v === "raw" || v === "min" ? v : "pretty"))
// 这行是**向后兼容老用户 storage 的闸门**：老用户存的是 pretty/raw/min，读到别的（含将来废弃的
// 值、或手改坏的 storage）必须回落 pretty，绝不能白屏或抛错。T-107 加 `table` 时改的正是它 ——
// 先在这里把现状锁死，改的时候变红 = 碰到了兼容性闸门，必须显式更新本测试（特征化纪律）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM();
const JK = loadJK();

// 开在哪个视图，看分段器上哪个按钮带 `on` 类 —— 那是产品在 setView 里设的当前视图信号
// （bar.setView(v) → 对应段加 on），不是桩默认值。比用面板内容区分 raw/min 可靠：
// JSON.stringify 无空格时 raw 串与 min 串会一模一样。
function openWith(stored) {
  const c = installChrome(stored === undefined ? {} : { "jk:view": stored });
  try {
    const root = makeMount();
    JK.mountViewer(root, JSON.stringify({ a: 1, b: 2 }), { showErrors: false });
    for (const v of ["pretty", "raw", "min"]) {
      const btn = root.querySelector('[data-act="' + v + '"]');
      if (btn && btn.classList.contains("on")) return v;
    }
    return "(none)";
  } finally { c.uninstall(); }
}

test("视图恢复：已知值照开，未知值回落 pretty（老 storage 兼容闸门）", async (t) => {
  await t.test("存 pretty → 开 pretty", () => assert.equal(openWith("pretty"), "pretty"));
  await t.test("存 raw → 开 raw", () => assert.equal(openWith("raw"), "raw"));
  await t.test("存 min → 开 min", () => assert.equal(openWith("min"), "min"));
  await t.test("没存过 → 开 pretty", () => assert.equal(openWith(undefined), "pretty"));

  // T-107 落地：`table` 从"未知值"变成"有条件的已知值" —— 仅当当前文档能表格化才接受。
  // 这里的 openWith 喂的是 {a:1,b:2}（对象，canRender=false），所以 table 仍回落 pretty，
  // 但**理由变了**：不再是"table 是未知值"，而是"这篇文档不能表格化"。显式改这条 = 让契约变更被看见。
  await t.test("存 table 但文档不是数组 → 回落 pretty（canRender 闸门，不再是未知值）", () =>
    assert.equal(openWith("table"), "pretty"));
  await t.test("存彻底垃圾值 → 回落 pretty，不白屏不抛错", () =>
    assert.equal(openWith("__garbage__"), "pretty"));
  await t.test("存空串 → 回落 pretty", () => assert.equal(openWith(""), "pretty"));
});

// T-107 的新行为：文档能表格化时，存的 table 偏好照开表格
test("视图恢复：文档是对象数组时，存的 table 偏好照开 table", () => {
  const c = installChrome({ "jk:view": "table" });
  try {
    const root = makeMount();
    JK.mountViewer(root, JSON.stringify([{ a: 1 }, { a: 2 }]), { showErrors: false });
    const btn = root.querySelector('[data-act="table"]');
    assert.ok(btn.classList.contains("on"), "对象数组 + 存了 table → 开在 table 视图");
    assert.equal(btn.disabled, false, "此时 Table 段不该禁用");
  } finally { c.uninstall(); }
});

// 搜索的命中计数与跳转 —— feature 2 的查询栏会与搜索框并列（不替换），先锁现状：
// 命中时计数 n/m、当前命中打 jk-current。emptystates.test 锁的是 0 命中的一面，这里锁有命中的一面。
test("搜索命中计数与当前项标记（查询栏并列不得挤掉它）", () => {
  const c = installChrome({});
  try {
    const root = makeMount();
    JK.mountViewer(root, JSON.stringify({ alpha: 1, beta: 2, gamma: 3 }), { showErrors: false });
    const inp = root.querySelector(".jk-search input");
    inp.value = "alpha";
    (inp._ls.input || []).forEach((f) => f({ target: inp }));
    const findN = root.querySelector("[data-find]");
    assert.equal(findN.textContent, "1/1", "1 个命中该报 1/1");
    const holder = root.querySelector("[data-pretty]").children[0];
    const rows = holder.children.filter((r) => r._apath !== undefined);
    const cur = rows.filter((r) => r.classList.contains("jk-current"));
    assert.equal(cur.length, 1, "当前命中该有且只有一行打 jk-current");
    assert.equal(cur[0]._apath, "alpha", "打在 alpha 那行上");
  } finally { c.uninstall(); }
});
