// 防护网 — 导出/校验面板（T-207/208）。
//
// 三个 ⋯ 菜单入口（导出 Schema / 导出 TS / 用 Schema 校验）→ 侧滑面板。测的是 core 的接线与
// 面板契约：导出产出代码、校验产出可点结果并在树上标红、非法 Schema 就地报错不清空文档视图。
// 面板 body 是 innerHTML 建的（桩不解析，L-010），但 querySelector 记忆化 → core 与测试拿到
// 同一个幻影，于是能给 textarea 塞值、读结果。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM();
const JK = loadJK();

const mount = (raw) => {
  const c = installChrome({});
  const root = makeMount();
  JK.mountViewer(root, typeof raw === "string" ? raw : JSON.stringify(raw), { showErrors: false });
  return { root, done: () => c.uninstall() };
};
const menuItem = (root, id) => {
  const pop = root.querySelector("[data-menu-pop]");
  return pop.children.flatMap((g) => g.children).find((b) => b.dataset.id === id);
};
const panel = (root) => root.querySelector(".jk-wrap").children.find((c) => c.className === "jk-panel");
const panelBody = (root) => panel(root).querySelector("[data-panel-body]");
const footBtn = (root, label) => panel(root).querySelector("[data-panel-foot]").children.find((b) => b.textContent === label);
const rows = (root) => {
  const holder = root.querySelector("[data-pretty]").children[0];
  return holder ? holder.children.filter((r) => r._apath !== undefined) : [];
};

test("导出 JSON Schema：菜单入口 → 面板出代码", () => {
  const { root, done } = mount({ id: 1, name: "a" });
  try {
    menuItem(root, "exp-schema")._click();
    assert.ok(panel(root), "面板打开了");
    const html = panelBody(root).collectHTML();
    assert.match(html, /"type": ?"object"/, "面板里是推断出的 Schema");
    assert.match(html, /"id"/, "含字段");
    assert.ok(footBtn(root, "Copy") && footBtn(root, "Download"), "有复制/下载按钮");
  } finally { done(); }
});

test("导出 TypeScript：面板出 interface，大整数是 bigint", () => {
  const { root, done } = mount('{"id": 136986234663732436}');
  try {
    menuItem(root, "exp-ts")._click();
    const html = panelBody(root).collectHTML();
    assert.match(html, /interface Root/);
    assert.match(html, /id: bigint/, "大整数导出 bigint，不是 number");
  } finally { done(); }
});

test("不确定计数徽章：空数组等不确定处 → 面板显示计数", () => {
  const { root, done } = mount({ a: [], b: null });
  try {
    menuItem(root, "exp-ts")._click();
    assert.match(panelBody(root).collectHTML(), /inferred uncertaint/, "有不确定计数徽章");
  } finally { done(); }
});

test("XSS：导出物含用户 key，进面板前 esc（列头/键名是不可信数据）", () => {
  const { root, done } = mount({ "<img src=x onerror=alert(1)>": 1 });
  try {
    menuItem(root, "exp-schema")._click();
    const html = panelBody(root).collectHTML();
    assert.ok(!/<img src=x/.test(html), "恶意 key 必须被 esc");
    assert.match(html, /&lt;img/, "以转义文本出现");
  } finally { done(); }
});

test("用 Schema 校验：合规 → ✓ 通过", () => {
  const { root, done } = mount({ id: 1 });
  try {
    menuItem(root, "validate")._click();
    panelBody(root).querySelector("textarea").value = '{"type":"object","properties":{"id":{"type":"integer"}}}';
    footBtn(root, "Validate")._click();
    assert.match(panelBody(root).querySelector("[data-result]").textContent, /matches the schema/, "通过提示");
  } finally { done(); }
});

test("用 Schema 校验：不符 → 结果列表 + 树上标红", () => {
  const { root, done } = mount({ a: 1 });
  try {
    menuItem(root, "validate")._click();
    panelBody(root).querySelector("textarea").value = '{"type":"object","required":["b"]}';
    footBtn(root, "Validate")._click();
    const resultEl = panelBody(root).querySelector("[data-result]");
    assert.match(resultEl.textContent, /required/, "结果列出 required 错误");
    const issues = resultEl.children.filter((c) => c.className === "jk-panel-issue");
    assert.ok(issues.length >= 1, "有可点的问题条");
    // 树上 root 行标红（缺 b 定位到 root）
    const rootRow = rows(root).find((r) => r._apath === "");
    assert.ok(rootRow.classList.contains("jk-invalid"), "对应节点在树上标红");
  } finally { done(); }
});

test("AC-208：非法 Schema → 就地报错，不清空文档视图", () => {
  const { root, done } = mount({ a: 1, b: 2 });
  try {
    // 前提：树已建（文档视图在）
    const before = rows(root).length;
    menuItem(root, "validate")._click();
    panelBody(root).querySelector("textarea").value = '{"type":';   // 非法 JSON
    footBtn(root, "Validate")._click();
    // 报错用 textContent 设（无注入面），所以读 textContent 不是 collectHTML
    assert.match(panelBody(root).querySelector("[data-result]").textContent, /valid JSON/, "面板内就地报错");
    // 文档树没被清空
    assert.equal(rows(root).length, before, "非法 Schema 不许动文档视图");
  } finally { done(); }
});

test("非法 Schema 报错走 textContent —— 无注入面（含用户输入原文）", () => {
  const { root, done } = mount({ a: 1 });
  try {
    menuItem(root, "validate")._click();
    panelBody(root).querySelector("textarea").value = "{<img src=x>";
    footBtn(root, "Validate")._click();
    const errEl = panelBody(root).querySelector("[data-result]").querySelector(".jk-panel-err");
    // 报错用 textContent 设，不产生 innerHTML
    assert.equal(errEl.innerHTML, "", "报错走 textContent，没有可注入的 innerHTML");
  } finally { done(); }
});

test("关闭校验面板清除树上的标红（不残留）", () => {
  const { root, done } = mount({ a: 1 });
  try {
    menuItem(root, "validate")._click();
    panelBody(root).querySelector("textarea").value = '{"required":["z"]}';
    footBtn(root, "Validate")._click();
    assert.ok(rows(root).find((r) => r._apath === "").classList.contains("jk-invalid"), "前提：先标红了");
    panel(root).querySelector(".jk-panel-close")._click();
    assert.ok(!rows(root).find((r) => r._apath === "").classList.contains("jk-invalid"), "关面板后标红清掉");
  } finally { done(); }
});

test("T-208：点校验结果条 → 树上定位并高亮那个节点（F-203）", () => {
  const { root, done } = mount({ user: { age: "old" } });
  try {
    menuItem(root, "validate")._click();
    panelBody(root).querySelector("textarea").value = '{"properties":{"user":{"properties":{"age":{"type":"integer"}}}}}';
    footBtn(root, "Validate")._click();
    // 结果里应有 user.age 的问题条
    const issues = panelBody(root).querySelector("[data-result]").children.filter((c) => c.className === "jk-panel-issue");
    assert.ok(issues.length >= 1, "有问题条");
    issues[0]._click();
    // 切回 Pretty 且 user.age 行高亮
    assert.equal(root.querySelector("[data-pretty]").hidden, false, "点结果条切回 Pretty");
    const hit = rows(root).find((r) => r._apath === "user.age");
    assert.ok(hit && hit.classList.contains("jk-hit"), "对应节点被定位高亮");
  } finally { done(); }
});
