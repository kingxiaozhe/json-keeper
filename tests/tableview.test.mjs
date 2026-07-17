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
    assert.equal(root.querySelector("[data-raw]").hidden, true, "raw 隐藏");
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
