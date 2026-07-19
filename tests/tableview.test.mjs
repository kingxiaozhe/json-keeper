// 防护网 — Table 接入视图分段器 + 不可用态（T-107）。
//
// 分段器新增 Table：能表格化就可点、切过去显示表格；不能就置灰 + tooltip 说清原因（F-106）。
// 关键不变式：`jk:view` 读到 table 但文档非数组时必须回落 pretty（老 storage 兼容，T-101 锁的闸门）。
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
const tableBtn = (root) => root.querySelector('[data-act="table"]');
const clickSeg = (root, v) => root.querySelector('[data-act="' + v + '"]')._click();

test("对象数组：Table 段可用，点击切到表格视图", () => {
  const { root, done } = mount([{ name: "a", age: 1 }, { name: "b", age: 2 }]);
  try {
    assert.equal(tableBtn(root).disabled, false, "对象数组该可点");
    clickSeg(root, "table");
    assert.equal(root.querySelector("[data-table]").hidden, false, "table 面板显示");
    assert.equal(root.querySelector("[data-pretty]").hidden, true, "pretty 隐藏");
    // v0.10：Raw 面板退役（源码进了左侧编辑器），不再断言 [data-raw]
    assert.match(root.querySelector("[data-table]").innerHTML, /jk-table/, "表格真的渲染进去了");
    assert.match(root.querySelector("[data-table]").innerHTML, /name/, "列头在");
  } finally { done(); }
});

test("F-106：非数组 → Table 段禁用 + 具体原因", () => {
  const { root, done } = mount({ a: 1 });
  try {
    assert.equal(tableBtn(root).disabled, true);
    assert.match(tableBtn(root).title, /array/i, "原因要说是'仅数组可用'一类");
  } finally { done(); }
});

test("F-106：空数组 → 禁用 + 原因说空", () => {
  const { root, done } = mount([]);
  try {
    assert.equal(tableBtn(root).disabled, true);
    assert.match(tableBtn(root).title, /[Ee]mpty/);
  } finally { done(); }
});

test("F-106：元素非对象 → 禁用 + 原因说要对象", () => {
  const { root, done } = mount([1, 2, 3]);
  try {
    assert.equal(tableBtn(root).disabled, true);
    assert.match(tableBtn(root).title, /object/i);
  } finally { done(); }
});

test("从 table 切回 pretty，树还在（面板互斥切换不丢数据）", () => {
  const { root, done } = mount([{ hello: 1 }]);
  try {
    clickSeg(root, "table");
    clickSeg(root, "pretty");
    const pretty = root.querySelector("[data-pretty]");
    assert.equal(pretty.hidden, false);
    assert.equal(root.querySelector("[data-table]").hidden, true);
    // jk-row 是 className 赋的、不进 innerHTML —— 看渲染出来的键内容（那才进 innerHTML）
    const holder = pretty.children[0];
    assert.ok(holder && holder.children.some((r) => r._apath !== undefined), "树的行还在");
    assert.match(holder.collectHTML(), /hello/, "树内容（键 hello）还在");
  } finally { done(); }
});

test("在表格视图里排序 → 表格重建（列头跟着排序变，不是留旧表）", () => {
  // sortValue 把对象键按字母排。[{b,a}] 的列首次出现顺序是 b,a；排序后键变 a,b → 列头 a,b。
  // 若 Sort 不销毁旧 tableHandle，表格会留在 b,a —— 脏表格。
  const c = installChrome({});
  const root = makeMount();
  JK.mountViewer(root, JSON.stringify([{ b: 1, a: 2 }]), { showErrors: false });
  try {
    clickSeg(root, "table");
    const ths = () => (root.querySelector("[data-table]").innerHTML.match(/jk-th">(\w)</g) || []).join(",");
    assert.match(ths(), /b.*a/, "前提：排序前列头是 b, a");
    const pop = root.querySelector("[data-menu-pop]");
    const sortItem = pop.children.flatMap((g) => g.children).find((x) => x.dataset.id === "sort");
    sortItem._click();
    assert.match(ths(), /a.*b/, "排序后列头该重排成 a, b —— 表格必须用排序后的数据重建");
  } finally { c.uninstall(); }
});

test("大整数在表格视图里保真（端到端，不只是 table.js 单测）", () => {
  const { root, done } = mount('[{"id": 9007199254740993}]');
  try {
    clickSeg(root, "table");
    assert.match(root.querySelector("[data-table]").innerHTML, /9007199254740993/, "表格里大整数原值");
  } finally { done(); }
});

test("端到端：点嵌套单元格 → 子树面板打开显示该值，✕ 关闭（F-107）", () => {
  const { root, done } = mount([{ user: { city: "SH", zip: "200000" } }]);
  try {
    clickSeg(root, "table");
    const panel = root.querySelector("[data-subtree]");
    const body = root.querySelector("[data-subtree-body]");
    // 触发 table 上的委托 click，target 是 data-nested 按钮 —— 但 el 委托拿真实值，
    // 需要真的点到渲染出来的按钮。这里模拟：从表格 innerHTML 找不到真元素（桩不解析），
    // 改走 table 的委托：构造带 data-nested 的 target。
    const btn = { dataset: { nested: "0" }, closest(s) { return s === "[data-nested]" ? btn : null; } };
    (root.querySelector("[data-table]")._ls.click || []).forEach((f) => f({ target: btn }));
    assert.equal(panel.hidden, false, "面板该打开");
    assert.match(body.collectHTML(), /city/, "面板里显示子树内容");
    assert.match(body.collectHTML(), /200000/, "嵌套的值都在");
    assert.match(root.querySelector("[data-subtree-path]").textContent, /\[0\]\.user/, "面板标题显示该子树的路径");
    // 子树的行 apath 必须带上 basePath（[0].user.city），否则复制路径给的是假路径
    const holder = body.children[0];
    assert.ok(holder.children.some((r) => r._apath === "[0].user.city"),
      "面板里的行 apath 带 basePath —— 不传 basePath 会退化成裸 'city'");
    // ✕ 关闭
    root.querySelector("[data-subtree-close]")._click();
    assert.equal(panel.hidden, true, "点 ✕ 关闭面板");
  } finally { done(); }
});

test("T-108 端到端：点标量单元格 → 切回 Pretty 并高亮对应树节点（F-105）", () => {
  const { root, done } = mount([{ email: "a@b.c" }, { email: "d@e.f" }]);
  try {
    clickSeg(root, "table");
    // 点第 1 行 email 单元格（apath [1].email）
    const cell = { dataset: { apath: "[1].email" }, closest(s) { return s === "[data-apath]" ? cell : null; } };
    (root.querySelector("[data-table]")._ls.click || []).forEach((f) => f({ target: cell }));
    assert.equal(root.querySelector("[data-pretty]").hidden, false, "点单元格该切回 Pretty 树视图");
    // 树里 [1].email 那行被高亮
    const holder = root.querySelector("[data-pretty]").children[0];
    const hit = holder.children.find((r) => r._apath === "[1].email");
    assert.ok(hit && hit.classList.contains("jk-hit"), "对应节点被定位并高亮");
  } finally { done(); }
});
