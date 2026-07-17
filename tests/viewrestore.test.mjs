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

  // 下面这些是闸门的正主：T-107 加 table 后，"table" 会从这一组挪到"已知值"组，
  // 那个搬动就是让改动被看见的机制。其余垃圾值必须永远回落 pretty。
  await t.test("存未知值 table（feature 2 之前）→ 回落 pretty", () =>
    assert.equal(openWith("table"), "pretty"));
  await t.test("存彻底垃圾值 → 回落 pretty，不白屏不抛错", () =>
    assert.equal(openWith("__garbage__"), "pretty"));
  await t.test("存空串 → 回落 pretty", () => assert.equal(openWith(""), "pretty"));
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
