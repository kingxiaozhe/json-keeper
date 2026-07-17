// 防护网 — 表格视图（T-105）。
//
// 本 feature 的**核心正确性点**是 F-104：字段缺失 vs 值为 null 必须**画得能区分**。别家表格把
// 两者都渲染成空白，用户就会误判接口行为。所以这里往死里锁"缺失 ≠ null"，以及一条 XSS 线：
// 列头来自用户 JSON 的 key，最容易被当成"我们自己的 UI 文案"而漏 esc —— 那正是注入入口。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount } from "./_dom.mjs";
import { loadJK, loadJSONBig } from "./_load.mjs";

installDOM();
const JK = loadJK();
const JSONBig = loadJSONBig();
const T = JK.table;

const render = (arr, ctx) => {
  const el = makeMount();
  const h = T.mount(el, arr, ctx);
  return { el, html: el.innerHTML, handle: h };
};

test("canRender —— 只有非空对象数组可用，其余给具体原因（F-106）", () => {
  assert.equal(T.canRender([{ a: 1 }]).ok, true);
  assert.equal(T.canRender({ a: 1 }).ok, false, "对象不可表格化");
  assert.match(T.canRender({ a: 1 }).reason, /array/);
  assert.match(T.canRender([]).reason, /empty/);
  assert.match(T.canRender([1, 2, 3]).reason, /object/, "标量数组：元素非对象");
  assert.match(T.canRender([{ a: 1 }, 5]).reason, /object/, "混入非对象也不行");
});

test("列 = 各行 key 的并集，首次出现顺序（不排序）", () => {
  assert.deepEqual(T.columns([{ b: 1, a: 2 }, { a: 3, c: 4 }]), ["b", "a", "c"],
    "b 先出现排最前，不按字母序 —— 排序是 ⇅ Sort 的事");
});

test("护城河 F-104：字段缺失 ≠ 值为 null，视觉可区分", () => {
  const { el } = render([{ a: 1, b: 2 }, { a: 3, b: null }, { a: 4 }]);
  const html = el.innerHTML;
  // 第 2 行 b 是真 null → 走 valueHTML → jk-null 的 "null"
  assert.match(html, /jk-null">null/, "值为 null 渲染成带 jk-null 色的 null");
  // 第 3 行没有 b 字段 → jk-missing 的 —，且 tooltip 明说没这个字段
  assert.match(html, /jk-missing[^>]*>—/, "缺失字段渲染成弱色 —");
  assert.match(html, /title="[^"]*no [^"]*b[^"]*field/, "缺失有 tooltip 说明没这个字段");
  // 两者必须是不同的渲染 —— 缺失单元格里不该出现 "null" 字样
  const missingCell = html.match(/<td class="jk-td jk-missing"[^>]*>[^<]*/)[0];
  assert.ok(!/null/.test(missingCell), "缺失单元格里绝不能是 null —— 那就和真 null 混了");
});

test("大整数在单元格里保真（复用 valueHTML 的 jk-precise）", () => {
  const arr = JSONBig.parse('[{"id": 9007199254740993}]');
  const { el } = render(arr);
  assert.match(el.innerHTML, /jk-precise[^>]*>9007199254740993/, "单元格里大整数原值 + 精确高亮");
});

test("XSS：列头与单元格都 esc（列头是用户 key，最容易漏）", () => {
  const arr = [{ "<img src=x onerror=alert(1)>": "<script>alert(1)</scr" + "ipt>" }];
  const { el } = render(arr);
  const html = el.innerHTML;
  assert.ok(!/<img src=x/.test(html), "列头里的 <img 必须被 esc 成 &lt;img");
  assert.ok(!/<script>alert/.test(html), "单元格值里的 <script 必须被 esc");
  assert.match(html, /&lt;img/, "恶意列头以纯文本转义后出现");
});

test("嵌套值显示为 {…} / [N]，不拍平成列（F-107）", () => {
  const { el } = render([{ user: { city: "SH" }, tags: [1, 2, 3] }]);
  const html = el.innerHTML;
  assert.match(html, /jk-cell-nested[^>]*>\{…\}/, "对象单元格显示 {…}");
  assert.match(html, /jk-cell-nested[^>]*>\[3\]/, "数组单元格显示 [N]");
  assert.ok(!/city/.test(html.replace(/data-apath="[^"]*"/g, "")), "列头不该冒出 user.city（apath 属性里除外）");
});

test("超过 1000 行：只渲染前 1000 + 诚实提示（不分页）", () => {
  const arr = Array.from({ length: 1500 }, (_, i) => ({ i }));
  const { el } = render(arr);
  // 数据行用 jk-td-idx（每行一个序号格）计数 —— 避开表头那一个 <tr>
  const dataRows = (el.innerHTML.match(/jk-td-idx/g) || []).length;
  assert.equal(dataRows, 1000, "只渲染前 1000 行数据行");
  assert.match(el.innerHTML, /first 1000 of 1500/, "诚实说明总共多少、显示多少");
  assert.match(el.innerHTML, /500 more not shown/, "剩余条数说清楚");
  assert.ok(!/pagination|Load More/i.test(el.innerHTML), "首版不做分页/Load More（feature 5 才有虚拟滚动）");
});

test("恰好 1000 行不显示截断提示（边界）", () => {
  const arr = Array.from({ length: 1000 }, (_, i) => ({ i }));
  const { el } = render(arr);
  assert.ok(!/more not shown/.test(el.innerHTML), "1000 行整不该说还有更多");
});

test("单元格带 apath（供 T-108 跳转），格式与 childAccessor 一致", () => {
  const { el } = render([{ email: "a@b.c" }]);
  // 第 0 行 email 的 apath = [0].email
  assert.match(el.innerHTML, /data-apath="\[0\]\.email"/, "cell apath 是 [0].email，和树里同一节点一致");
});

test("点单元格触发 onJump(apath)（T-108 的接线，此处先锁）", () => {
  let jumped = null;
  const { el } = render([{ email: "a@b.c" }], { onJump: (p) => (jumped = p) });
  // 找到带 data-apath 的 td，模拟点它
  const rows = el.children[0]; // table
  // 直接触发委托：el 上的 click，target 是带 data-apath 的元素
  const cell = { dataset: { apath: "[0].email" }, closest(sel) { return sel === "[data-apath]" ? cell : null; } };
  (el._ls.click || []).forEach((f) => f({ target: cell }));
  assert.equal(jumped, "[0].email");
});

test("嵌套单元格点击走 onSubtree(值, apath) —— 不是 onJump（F-107）", () => {
  let sub = null, jumped = null;
  const arr = [{ user: { city: "SH" } }];
  const el = makeMount();
  T.mount(el, arr, { onSubtree: (v, p) => (sub = { v, p }), onJump: (p) => (jumped = p) });
  // 找那个 data-nested 的按钮，模拟点它
  const btn = { dataset: { nested: "0" }, closest(sel) { return sel === "[data-nested]" ? btn : null; } };
  (el._ls.click || []).forEach((f) => f({ target: btn }));
  assert.equal(jumped, null, "嵌套不该触发跳转");
  assert.deepEqual(sub.v, { city: "SH" }, "onSubtree 收到的是嵌套的真实值（对象本身）");
  assert.equal(sub.p, "[0].user", "并带上 apath 供面板做 basePath");
});

test("标量单元格仍走 onJump（不误入 onSubtree）", () => {
  let sub = null, jumped = null;
  const el = makeMount();
  T.mount(el, [{ email: "a@b.c" }], { onSubtree: (v) => (sub = v), onJump: (p) => (jumped = p) });
  const cell = { dataset: { apath: "[0].email" }, closest(sel) { return sel === "[data-apath]" ? cell : null; } };
  (el._ls.click || []).forEach((f) => f({ target: cell }));
  assert.equal(sub, null, "标量不该开子树面板");
  assert.equal(jumped, "[0].email");
});
