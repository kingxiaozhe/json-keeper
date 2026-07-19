// 防护网 — 可点面包屑（T-006）。
//
// 面包屑原本是一行**静态文本**：更新它的 textContent，仅此而已。它命名了一串节点，却不给你
// 对任何一个做点什么 —— 又一个死affordance（跟 viewer 的 Format 按钮、Raw 下的结构栏同族）。
// T-006 把每个祖先段做成按钮 → jumpTo 那个祖先；当前节点是纯文本（你已经在那儿了）。
//
// 靶子**先于测试选定**（L-009，这次当真执行）。可观察轴：
//   显示串 / 逐段接线（点第 i 段跳第 i 段，不是 items[0]）/ 当前节点非按钮 / 走 jumpToPath / 点行更新
// 「点第 i 段跳到第 i 段」是重点 —— rail 曾把点击写死成 items[0]，自动化测试抓不到，这次专打它。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM();
const JK = loadJK();

const mount = (json, view) => {
  const c = installChrome(view ? { "jk:view": view } : {});
  const root = makeMount();
  JK.mountViewer(root, JSON.stringify(json), { showErrors: false });
  return { root, done: () => c.uninstall() };
};
const crumbEl = (root) => root.querySelector("[data-crumb]");
const prettyEl = (root) => root.querySelector("[data-pretty]");
const allRows = (root) => {
  const holder = prettyEl(root).children[0];
  return holder ? holder.children.filter((r) => r._apath !== undefined) : [];
};
const rowByPath = (root, apath) => allRows(root).find((r) => r._apath === apath);
// 模拟点一行：prettyEl 上的委托处理器，e.target 就是那行（closest 现在真的走）
const clickRow = (root, row) => (prettyEl(root)._ls.click || []).forEach((f) => f({ target: row, stopPropagation() {} }));
const crumbButtons = (root) => crumbEl(root).children.filter((c) => c.className === "jk-crumb-i");
// 委托处理器挂在 crumbEl 上，桩的 _click 不冒泡 —— 得像点行一样直接喂给 crumbEl 的监听器
const clickCrumb = (root, btn) => (crumbEl(root)._ls.click || []).forEach((f) => f({ target: btn, stopPropagation() {} }));

test("面包屑显示串没变（trail 重构不许动这个）", () => {
  const { root, done } = mount({ a: { b: { c: 1 } } });
  try {
    const leaf = rowByPath(root, "a.b.c");
    assert.ok(leaf, "前提：找得到 a.b.c 那行");
    assert.equal(leaf.dataset.path, "root › a › b › c", "显示串必须逐字如旧 —— 复制路径/Raw 面包屑都靠它");
  } finally { done(); }
});

test("数组下标段用 parent[k]，不是 › k", () => {
  const { root, done } = mount({ users: [{ id: 1 }] });
  try {
    const leaf = rowByPath(root, "users[0].id");
    assert.equal(leaf.dataset.path, "root › users[0] › id");
  } finally { done(); }
});

test("点一行 → 面包屑更新成那行的路径", () => {
  const { root, done } = mount({ a: { b: { c: 1 } } });
  try {
    clickRow(root, rowByPath(root, "a.b.c"));
    assert.equal(crumbEl(root).textContent, "root › a › b › c");
  } finally { done(); }
});

test("祖先段是按钮，当前节点不是", () => {
  const { root, done } = mount({ a: { b: { c: 1 } } });
  try {
    clickRow(root, rowByPath(root, "a.b.c"));
    const kids = crumbEl(root).children;
    const last = kids[kids.length - 1];
    assert.equal(last.className, "jk-crumb-cur", "当前节点是纯文本 —— 你已经在那儿了");
    assert.equal(last.tagName, "SPAN");
    // root / a / b 三个祖先都该是按钮
    assert.equal(crumbButtons(root).length, 3, "root·a·b 三段可点，c 不可点");
  } finally { done(); }
});

test("点第 i 段跳到第 i 段的 apath —— 不是写死 items[0]", () => {
  const { root, done } = mount({ a: { b: { c: 1 } } });
  try {
    clickRow(root, rowByPath(root, "a.b.c"));
    const btns = crumbButtons(root);
    // btns = [root, a, b]；点 "b"（index 2 in trail → 第 3 段）应命中 a.b 那行
    const bBtn = btns.find((x) => x.textContent === "b");
    clickCrumb(root, bBtn);
    assert.ok(rowByPath(root, "a.b").classList.contains("jk-hit"), "点 b 该跳到 a.b");
    assert.ok(!rowByPath(root, "a").classList.contains("jk-hit"), "不该跳到 a（写死首段的话会命中这里）");
    // 再点 "a" —— 必须跳到**不同**的行，证明不是所有段都跳同一处
    rowByPath(root, "a.b").classList.remove("jk-hit");
    clickCrumb(root, btns.find((x) => x.textContent === "a"));
    assert.ok(rowByPath(root, "a").classList.contains("jk-hit"), "点 a 该跳到 a");
    assert.ok(!rowByPath(root, "a.b").classList.contains("jk-hit"), "不该还停在 a.b");
  } finally { done(); }
});

test("跳转会把面包屑带过去 —— 不是停在上次点的行", () => {
  // 面包屑现在可点了，若跳转后不更新，它就指向和高亮行无关的地方（审查第 3 项）。
  const { root, done } = mount({ a: { b: { c: 1 } } });
  try {
    clickRow(root, rowByPath(root, "a.b.c"));
    assert.equal(crumbEl(root).textContent, "root › a › b › c", "前提：先停在最深处");
    // 点祖先 "a" → 跳到 a → 面包屑该缩短到 root › a
    clickCrumb(root, crumbButtons(root).find((x) => x.textContent === "a"));
    assert.equal(crumbEl(root).textContent, "root › a", "跳到 a 后面包屑该跟到 a，而不是还挂着 a.b.c");
    const kids = crumbEl(root).children;
    assert.equal(kids[kids.length - 1].className, "jk-crumb-cur", "a 现在是当前节点，该变纯文本");
  } finally { done(); }
});

test("搜索命中也把面包屑带过去 —— 它绕过 jumpToPath，得自己更新", () => {
  // 审查 item 3 的残留：search.goto 自己滚动、自己打 jk-current，从不经 jumpToPath。
  // 面包屑变可点后，停在上次点的行 = 段按钮跳向和当前命中无关的子树。
  const { root, done } = mount({ apple: { core: 1 }, zebra: { yak: 2 } });
  try {
    clickRow(root, rowByPath(root, "apple.core"));
    assert.equal(crumbEl(root).textContent, "root › apple › core", "前提：先停在 apple.core");
    const inp = root.querySelector(".jk-search input");
    inp.value = "yak";
    (inp._ls.input || []).forEach((f) => f({ target: inp }));
    assert.equal(crumbEl(root).textContent, "root › zebra › yak",
      "命中 zebra.yak 后面包屑该跟过去，而不是还挂着 apple.core 的可点段");
  } finally { done(); }
});

test("点 root 段跳到根行（M13：审查发现这根轴没网）", () => {
  const { root, done } = mount({ a: { b: 1 } });
  try {
    clickRow(root, rowByPath(root, "a.b"));
    clickCrumb(root, crumbButtons(root).find((x) => x.textContent === "root"));
    assert.ok(rowByPath(root, "").classList.contains("jk-hit"), "root 段该跳到根行（apath 为空串）");
    assert.equal(crumbEl(root).textContent, "root", "跳到根后面包屑收缩成单个 root");
  } finally { done(); }
});

test("点数组下标段真的会跳（不只是显示对）", () => {
  const { root, done } = mount({ users: [{ id: 1 }] });
  try {
    clickRow(root, rowByPath(root, "users[0].id"));
    clickCrumb(root, crumbButtons(root).find((x) => x.textContent === "[0]"));
    assert.ok(rowByPath(root, "users[0]").classList.contains("jk-hit"), "点 [0] 该跳到 users[0]");
  } finally { done(); }
});

// v0.10：Raw 视图退役（源码进了左侧编辑器），Table 是右栏仅剩的非树视图。原本这两条锁的是
// "在 Raw 下面包屑仍在屏幕上、点它切回 Pretty 并定位、且导航不写偏好"。同一条护城河搬到 Table：
// 从非树视图点面包屑，必须切回 Pretty、定位、且 persist=false 不改跨会话偏好。
test("Table 下点面包屑会切回 Pretty 并定位（走的是 jumpToPath）", () => {
  const { root, done } = mount([{ a: { b: 1 } }]);   // 对象数组：Table 可用
  try {
    clickRow(root, rowByPath(root, "[0].a.b"));
    root.querySelector('[data-act="table"]')._click();
    assert.equal(prettyEl(root).hidden, true, "前提：现在在 Table");
    clickCrumb(root, crumbButtons(root).find((x) => x.textContent === "a"));
    assert.equal(prettyEl(root).hidden, false, "点面包屑该切回 Pretty");
    assert.ok(rowByPath(root, "[0].a").classList.contains("jk-hit"));
  } finally { done(); }
});

test("Table 下点面包屑不改跨会话视图偏好（导航不是表态）", () => {
  const c = installChrome({ "jk:view": "table" });
  try {
    const root = makeMount();
    JK.mountViewer(root, JSON.stringify([{ a: { b: 1 } }]), { showErrors: false });
    // 先切 Pretty 建树、点出面包屑，再显式切回 Table（这两次是用户表态，会存），
    // 最后点面包屑走导航（persist=false）—— 它不该把偏好从 table 改掉。
    root.querySelector('[data-act="pretty"]')._click();
    clickRow(root, rowByPath(root, "[0].a.b"));
    root.querySelector('[data-act="table"]')._click();
    clickCrumb(root, crumbButtons(root).find((x) => x.textContent === "a"));
    assert.equal(c.data["jk:view"], "table", "导航切到 Pretty 用的是 persist=false，不该写偏好");
  } finally { c.uninstall(); }
});
