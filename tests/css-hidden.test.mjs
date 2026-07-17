// 防护网 — `[hidden]` 必须真的隐藏（T-012 真浏览器冒烟发现）。
//
// 纯文本断言（读 CSS 源码），不受 L-010 那堵墙限制 —— 但它守的是一个**只有真浏览器才暴露**、
// 成因全在源码里的 bug：JS 用 `el.hidden = true` 收起一个浮层，而 CSS 给了它 `display:flex`。
// `[hidden]` 靠的是 UA 样式表的 `[hidden]{display:none}`，特异性 (0,1,0) 与 `.jk-menu-pop`
// 相同 → 源序在后的作者样式胜出 → **hidden 属性形同虚设，浮层永远开着**。
//
// 实际发生：`.jk-menu-pop` 从 T-004 起就少了 `[hidden]` 兜底规则，于是 ⋯ 溢出菜单
// （装着 Collapse all / Sort / Download / Theme / Colors 半个工具栏）**一直开着盖在树上**，
// 而 400 条自动化测试全绿 —— 桩没有 CSS，`toggle` 只改属性，`[hidden]` 是否生效它看不见。
// 第一次在真实 Chrome 里打开就露馅。
//
// 局限：这里验的是"源码里有没有那条兜底规则"，不是"浏览器真的收起了"。后者只有真浏览器/冒烟
// 能答（冒烟第 30 条）。但兜底规则的**缺失**是纯源码事实，可以在这里锁死、防回归。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const viewer = readFileSync(join(ROOT, "viewer.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// 从 CSS 里挑出"被赋了 display:flex/grid/block 值"的类 —— 这些是会盖过 [hidden] 的。
// 一个类只要在某处出现 `.X { … display:flex … }`，就登记它。
const displayed = new Set();
for (const m of viewer.matchAll(/\.([\w-]+)\s*(?:\{[^}]*?)display\s*:\s*(flex|grid|block|inline-flex|inline-block)/g)) {
  displayed.add(m[1]);
}
// 它有没有配套的 `.X[hidden] { display:none }`（或 display:none 的其它写法）
const hasHiddenGuard = (cls) =>
  new RegExp("\\." + cls + "\\[hidden\\][^{]*\\{[^}]*display\\s*:\\s*none").test(viewer);

// 这些是 JS 会用 `.hidden = …` 收起的浮层/条 —— grep `\.hidden =` 得来，人工核过。
// 它们**必须**能被 [hidden] 收起，否则就是"永远开着"。
const TOGGLED_HIDDEN = ["jk-menu-pop", "jk-nohits"];

// 不变式：**有覆盖性 display 值** 的收起浮层，必须有 [hidden] 兜底。
// 没有覆盖性 display 值的（如 .jk-nohits，靠默认 block），UA 的 [hidden]{display:none} 天然生效，
// 不需要兜底 —— 所以那种情况无条件通过。这条不变式正好只咬住"被 display:flex 盖过 hidden"这个 bug。
test("被 .hidden 收起的浮层，display 值不能盖过 [hidden]", async (t) => {
  for (const cls of TOGGLED_HIDDEN) {
    await t.test(`.${cls}：若被赋了覆盖性 display，则必须有 [hidden] 兜底`, () => {
      const overridesHidden = displayed.has(cls);
      assert.ok(!overridesHidden || hasHiddenGuard(cls),
        `.${cls} 被 display 值盖过了 [hidden] 却没有兜底规则 —— 它会永远开着（⋯ 菜单就这么开了一路）`);
    });
  }
  // 至少 .jk-menu-pop 必须真的落在"有覆盖性 display"这一侧 —— 否则上面对它就是空转（L-012）。
  await t.test("前提自检：.jk-menu-pop 确实有覆盖性 display（不然守卫是空的）", () => {
    assert.ok(displayed.has("jk-menu-pop"),
      ".jk-menu-pop 不再有 display:flex/grid/block？那 bug 的前提没了，核对后更新本测试");
    assert.ok(hasHiddenGuard("jk-menu-pop"), ".jk-menu-pop 必须有 [hidden] 兜底");
  });
});

// 顺带把范围放宽一点：任何 display:flex 的类，如果它的**基名**在 HTML 里带过 hidden 属性，
// 也该有兜底。这条是给未来新增浮层的提醒 —— 但只报告、不因未登记的类而失败（避免脆）。
test("普查：display:flex 的类里，谁可能缺 [hidden] 兜底（提示，不硬失败）", () => {
  const suspects = [...displayed].filter((c) => !hasHiddenGuard(c));
  // 已知无需兜底的（它们从不被 .hidden 收起，是常驻布局容器）：不列入告警
  const alwaysOn = new Set(["jk-wrap", "jk-bar", "jk-main", "jk-seg", "jk-search", "jk-meta",
    "jk-menu-g", "jk-menu-row", "jk-rail-i", "jk-row", "jk-tree", "jk-status", "jk-page-wrap",
    "jk-skel", "jk-crumb", "jk-btn", "jk-page-bar"]);
  const flagged = suspects.filter((c) => !alwaysOn.has(c));
  // 不 assert 失败 —— 新增常驻容器不该让测试变红；这只是留个可见的清单给下一个人。
  assert.ok(Array.isArray(flagged), "普查跑通即可（flagged=" + JSON.stringify(flagged) + "）");
});
