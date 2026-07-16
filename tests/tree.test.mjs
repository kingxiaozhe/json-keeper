// 防护网基线 — buildTree / valueHTML / childAccessor 的现状行为（T-001，对抗审查后补）。
//
// 为什么必须有这个文件：esc/escAttr 的单元测试只验了**函数本身**，验不到**调用点**。
// 实测证明：把 core.js 的 esc(key) 改成裸 key（真 XSS），原来 58 条测试全绿。
// 而 T-002/T-003 要搬走的恰恰是这些调用点。锁零件不锁装配，等于没锁。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount } from "./_dom.mjs";
import { loadInternals } from "./_load.mjs";

installDOM();
const { buildTree, valueHTML, childAccessor } = loadInternals();

const html = (value) => {
  const mount = makeMount();
  buildTree(value, mount);
  return mount.collectHTML();
};

test("XSS — esc 的调用点真的装上了（不是只有函数存在）", async (t) => {
  await t.test("对象 key 进 innerHTML 前被转义", () => {
    const out = html({ "<script>alert(1)</script>": 1 });
    assert.ok(!out.includes("<script>"), `key 未转义 = XSS: ${out.slice(0, 200)}`);
    assert.ok(out.includes("&lt;script&gt;"));
  });

  await t.test("字符串值进 innerHTML 前被转义", () => {
    const out = html({ a: "<img src=x onerror=alert(1)>" });
    assert.ok(!out.includes("<img"), `值未转义 = XSS: ${out.slice(0, 200)}`);
    assert.ok(out.includes("&lt;img"));
  });

  await t.test("路径进 title 属性前被 escAttr（属性逃逸防线）", () => {
    // 注意：引号出现在**文本位置**（<span>"a" onmouseover=...</span>）是无害的 —— 浏览器当文本渲染。
    // 这正是 esc 不转引号、escAttr 才转的原因。真正的攻击面只有属性位置。
    // 若 escAttr(apath) 被降级成 esc(apath)，title="Copy path: ["a\" onmouseover=..." 会提前闭合并注入。
    const out = html({ 'a" onmouseover="alert(1)': 1 });
    const pathTitle = out.match(/title="Copy path: ([^"]*)"/);
    assert.ok(pathTitle, "应当有 Copy path 的 title 属性");
    assert.ok(
      pathTitle[1].includes("&quot;"),
      `title 里的引号必须是实体（escAttr 没跑？）: ${pathTitle[1]}`
    );
    // 属性值里不得残留裸引号 —— 有的话属性已经被提前闭合了
    assert.ok(!/[^&]quot;|(?<!&)"/.test(pathTitle[1].replace(/&quot;/g, "")), `属性值里有裸引号: ${pathTitle[1]}`);
  });

  await t.test("嵌套结构里的恶意 key 同样被转义", () => {
    const out = html({ outer: { "<b>x</b>": [1] } });
    assert.ok(!out.includes("<b>x</b>"));
  });
});

test("valueHTML — 类型着色与大整数标记", async (t) => {
  await t.test("大整数带 jk-precise 标记 —— 徽章之外的第二处信任信号", () => {
    const out = valueHTML(136986234663732436n);
    assert.match(out, /jk-precise/);
    assert.ok(out.includes("136986234663732436"), "必须显示原值");
  });

  await t.test("大整数不带 n 后缀（那是 JS 语法，不是数据）", () => {
    assert.ok(!valueHTML(136986234663732436n).includes("136986234663732436n"));
  });

  await t.test("各类型的语法 class", () => {
    assert.match(valueHTML(null), /jk-null/);
    assert.match(valueHTML(1), /jk-num/);
    assert.match(valueHTML(true), /jk-bool/);
    assert.match(valueHTML("s"), /jk-str/);
  });

  await t.test("字符串值经 esc 转义", () => {
    assert.ok(!valueHTML("<x>").includes("<x>"));
  });
});

test("childAccessor — apath 生成（jumpTo / 复制路径 / 查询结果树的共同地基）", async (t) => {
  await t.test("合法标识符用点号", () => {
    assert.equal(childAccessor("a", "b", false), "a.b");
  });

  await t.test("根层合法标识符不带前导点", () => {
    assert.equal(childAccessor("", "b", false), "b");
  });

  await t.test("非法标识符走括号 + JSON 转义", () => {
    assert.equal(childAccessor("a", "x-y", false), 'a["x-y"]');
  });

  await t.test("数字开头的 key 走括号", () => {
    assert.equal(childAccessor("a", "1x", false), 'a["1x"]');
  });

  await t.test("数组索引", () => {
    assert.equal(childAccessor("a", 0, true), "a[0]");
  });

  await t.test("含引号的 key 被 JSON.stringify 正确转义", () => {
    assert.equal(childAccessor("a", 'q"b', false), 'a["q\\"b"]');
  });
});

test("buildTree 返回值 — T-003 要在此基础上加 expandAll/collapseAll/rows，别把现有的弄丢", async (t) => {
  await t.test("节点计数与类型统计", () => {
    const mount = makeMount();
    const r = buildTree({ a: 1, b: "x", c: null, d: [1, 2] }, mount);
    assert.equal(r.counts.number, 3); // a + 数组两个元素
    assert.equal(r.counts.string, 1);
    assert.equal(r.counts.null, 1);
    assert.equal(r.counts.array, 1);
    assert.equal(r.counts.object, 1);
    assert.ok(r.nodes > 0);
  });

  await t.test("大整数计入 number 统计", () => {
    const mount = makeMount();
    const r = buildTree({ a: 136986234663732436n }, mount);
    assert.equal(r.counts.number, 1);
  });

  await t.test("topLevel 收集顶层节点（结构栏的数据源）", () => {
    const mount = makeMount();
    const r = buildTree({ a: { x: 1 }, b: { y: 2 } }, mount);
    assert.equal(r.topLevel.length, 2);
    assert.deepEqual(r.topLevel.map((t) => t.key), ["a", "b"]);
  });

  await t.test("容器行显示 n keys / n items", () => {
    assert.ok(html({ a: { x: 1, y: 2 } }).includes("2 keys"));
    assert.ok(html({ a: [1, 2, 3] }).includes("3 items"));
  });
});

test("[现状缺陷] 容器根行没有 apath —— T-002 要补 apath=\"\"，feature 3 的 AC-207 依赖它", () => {
  // core.js:127 的 row(0, ..., "root") 只传 3 个参数 → apath 为 undefined → 根行没有 _apath。
  // 标量根行（core.js:134）却传了 ""。这条断言在 T-002 补齐后会**有意**变红 —— 那正是改动生效的信号。
  const mount = makeMount();
  buildTree({ a: 1 }, mount);
  const rootRow = mount.children[0].children[0];
  assert.equal(rootRow._apath, undefined, "现状：容器根行无 _apath");
});
