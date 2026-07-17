// 防护网 — JSONPath 查询栏（T-104）。
//
// 查询栏与搜索框**并列不替换**（语义不同：搜索=全文高亮，查询=结构化筛选）。三条 AC 是骨架：
//   AC-101 结果替换主视图 + 计数；AC-102 清除回到完整树；AC-103 语法错误**保留上次结果**。
// 还有一条安全线：错误摘要含用户输入原文，走 textContent（无注入面，L-014）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM();
const JK = loadJK();

const mount = (json) => {
  const c = installChrome({});
  const root = makeMount();
  JK.mountViewer(root, JSON.stringify(json), { showErrors: false });
  return { root, done: () => c.uninstall() };
};
const q = (root) => root.querySelector(".jk-query-in");
const nEl = (root) => root.querySelector("[data-query-n]");
const errEl = (root) => root.querySelector("[data-query-err]");
const clearBtn = (root) => root.querySelector("[data-query-clear]");
// 读渲染出来的树文本，而不是 _trail（那是 {label,apath,sep} 对象，不是字符串）。
// 也不看 SHELL 里 hidden 属性 —— 桩不解析 HTML，那是 L-011 的坑；查询态由 query.js 用
// `.hidden = true/false` 显式设，那些是产品设的值，可以信。
const treeText = (root) => {
  const holder = root.querySelector("[data-pretty]").children[0];
  return holder ? holder.collectHTML() : "";
};
const runQuery = (root, expr) => {
  const inp = q(root);
  inp.value = expr;
  (inp._ls.keydown || []).forEach((f) => f({ key: "Enter", preventDefault() {} }));
};
const press = (root, key) => (q(root)._ls.keydown || []).forEach((f) => f({ key, preventDefault() {} }));

test("AC-101：查询结果替换主视图 + 计数", () => {
  const { root, done } = mount({ users: [{ email: "a@b.c" }, { email: "d@e.f" }] });
  try {
    runQuery(root, "$.users[*].email");
    assert.equal(nEl(root).textContent, "2 matches");
    assert.equal(nEl(root).hidden, false);
    // 结果树用每条 match 的 JSONPath 当键（避开 basePath 陷阱）
    const t = treeText(root);
    assert.match(t, /\$\.users\[0\]\.email/);
    assert.match(t, /\$\.users\[1\]\.email/);
    assert.match(t, /a@b\.c/);
  } finally { done(); }
});

test("单数命中说 1 match，不是 1 matches", () => {
  const { root, done } = mount({ a: { b: 1 } });
  try {
    runQuery(root, "$.a.b");
    assert.equal(nEl(root).textContent, "1 match");
  } finally { done(); }
});

test("AC-102：清除回到完整树", () => {
  const { root, done } = mount({ users: [{ email: "x" }], meta: { v: 1 } });
  try {
    runQuery(root, "$.users[*].email");
    assert.match(treeText(root), /\$\.users\[0\]\.email/, "前提：先进查询态");
    clearBtn(root)._click();
    const t = treeText(root);
    assert.ok(/"users"/.test(t) && /"meta"/.test(t), "清除后应是完整文档的树");
    assert.ok(!/\$\.users/.test(t), "查询结果的路径键不该再出现");
    assert.equal(nEl(root).hidden, true, "计数收起");
    assert.equal(clearBtn(root).hidden, true, "清除按钮收起");
    assert.equal(q(root).value, "", "查询框清空");
  } finally { done(); }
});

test("AC-103：语法错误保留上一次结果", () => {
  const { root, done } = mount({ users: [{ email: "a" }, { email: "b" }] });
  try {
    runQuery(root, "$.users[*].email");
    const before = treeText(root);
    runQuery(root, "$.users[");   // 非法
    assert.equal(errEl(root).hidden, false, "该显示错误");
    assert.ok(errEl(root).textContent.length > 0);
    assert.equal(treeText(root), before, "上一次的结果必须还在屏幕上，没被清空");
    assert.ok(q(root).classList.contains("bad"), "查询框标红");
  } finally { done(); }
});

test("filter ?() 给专门提示，不是裸语法错", () => {
  const { root, done } = mount({ users: [{ age: 20 }] });
  try {
    runQuery(root, "$.users[?(@.age>18)]");
    assert.match(errEl(root).textContent, /[Ff]ilter/);
  } finally { done(); }
});

test("错误摘要走 textContent —— 含用户输入原文却无注入面（L-014）", () => {
  const { root, done } = mount({ a: 1 });
  try {
    // 非标识符裸键的报错会把输入原文拼进 msg
    runQuery(root, "$[<img src=x>]");
    assert.match(errEl(root).textContent, /<img/, "报错确实引用了输入");
    assert.equal(errEl(root).innerHTML, "", "textContent 不产生 innerHTML —— 没有解析处就没有注入面");
  } finally { done(); }
});

test("Enter 触发、Escape 清除；不是输入即查", () => {
  const { root, done } = mount({ a: { b: 1 } });
  try {
    // 只设值不按 Enter：树仍是完整文档，没被筛
    q(root).value = "$.a.b";
    (q(root)._ls.input || []).forEach((f) => f({ target: q(root) }));
    assert.ok(!/\$\.a\.b/.test(treeText(root)), "输入即查是噪音 —— 没按 Enter 不该筛");
    // Enter 才查
    runQuery(root, "$.a.b");
    assert.equal(nEl(root).hidden, false, "Enter 后计数出现");
    // Escape 清除
    press(root, "Escape");
    assert.equal(nEl(root).hidden, true, "Escape 收起计数");
    assert.equal(q(root).value, "", "Escape 清空输入");
  } finally { done(); }
});

test("空表达式按 Enter = 清除（不报错）", () => {
  const { root, done } = mount({ a: 1 });
  try {
    runQuery(root, "$.a");
    runQuery(root, "   ");   // 空白
    assert.equal(errEl(root).hidden, true, "空表达式不该报错");
    assert.equal(nEl(root).hidden, true);
  } finally { done(); }
});

test("Sort 退出查询态 —— 排序重排整篇，旧路径指向的树没了", () => {
  const c = installChrome({});
  const root = makeMount();
  JK.mountViewer(root, JSON.stringify({ users: [{ email: "a" }], meta: { v: 1 } }), { showErrors: false });
  try {
    runQuery(root, "$.users[*].email");
    assert.match(treeText(root), /\$\.users/, "前提：先进查询态");
    // ⋯ 菜单里的 Sort
    const pop = root.querySelector("[data-menu-pop]");
    const sortItem = pop.children.flatMap((g) => g.children).find((b) => b.dataset.id === "sort");
    sortItem._click();
    const t = treeText(root);
    assert.ok(!/\$\.users/.test(t), "排序重排的是整篇，查询结果的路径键必须消失");
    assert.ok(/"users"/.test(t) && /"meta"/.test(t), "回到（排序后的）完整文档树");
  } finally { c.uninstall(); }
});

test("大整数在查询结果里保真（护城河不能在筛选后失真）", () => {
  // 必须喂**原始 JSON 串** —— {ids:[9007199254740993]} 写成 JS 字面量时，那个数在 JSON.stringify
  // 之前就已经被 JS 舍成 ...992 了（超出 MAX_SAFE_INTEGER）。这正是本产品存在的理由。
  const c = installChrome({});
  const root = makeMount();
  JK.mountViewer(root, '{"ids":[9007199254740993]}', { showErrors: false });
  try {
    runQuery(root, "$.ids[*]");
    const html = root.querySelector("[data-pretty]").children[0].collectHTML();
    assert.match(html, /9007199254740993/, "结果树里大整数必须是原值，不是 ...992");
  } finally { c.uninstall(); }
});
