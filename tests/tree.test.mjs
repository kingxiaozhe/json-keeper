// 防护网基线 — buildTree / valueHTML / childAccessor 的现状行为（T-001，对抗审查后补）。
//
// 为什么必须有这个文件：esc/escAttr 的单元测试只验了**函数本身**，验不到**调用点**。
// 实测证明：把 core.js 的 esc(key) 改成裸 key（真 XSS），原来 58 条测试全绿。
// 而 T-002/T-003 要搬走的恰恰是这些调用点。锁零件不锁装配，等于没锁。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM(); // tree.js 顶层不碰 DOM，但 build() 要 —— 先装桩再加载，顺序无所谓，保险起见如此
const { build: buildTree, valueHTML, childAccessor, trailToPath } = loadJK().tree;

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

test("容器根行有 apath（原为 undefined —— T-002 补齐，feature 3 的 AC-207 依赖它）", () => {
  // 拆分前 row(0, ..., "root") 只传 3 个参数 → 根行没有 _apath，而标量根行却传了 ""。
  // 于是"校验器报告顶层缺 key → 树上标红 root"这件事根本没有行可指。现已统一。
  const mount = makeMount();
  buildTree({ a: 1 }, mount);
  const rootRow = mount.children[0].children[0];
  assert.equal(rootRow._apath, "", "容器根行的 apath 应为空串，与标量根行一致");
});

test("basePath —— 查询结果树的路径基址（feature 2 的 F-105 依赖它）", async (t) => {
  await t.test("不传 basePath 时行为与拆分前一致", () => {
    const mount = makeMount();
    const r = buildTree({ email: "a@b.c" }, mount);
    assert.equal(r.byPath.get("email")._apath, "email");
  });

  await t.test("传 basePath 时子路径带上基址 —— 否则复制出的路径是假的", () => {
    const mount = makeMount();
    const r = buildTree({ email: "a@b.c" }, mount, { basePath: "users[0]" });
    assert.ok(r.byPath.has("users[0].email"), `实得: ${[...r.byPath.keys()]}`);
    assert.equal(r.byPath.get("users[0]")._apath, "users[0]", "根行的 apath 即基址本身");
  });
});

test("实例句柄 —— 多棵树共存的前提（Diff 左右两棵 / 结果树 / 子树面板）", async (t) => {
  await t.test("build 返回实例而非模块级状态", () => {
    const a = buildTree({ x: { y: 1 } }, makeMount());
    const b = buildTree({ p: { q: 2 } }, makeMount());
    assert.notEqual(a.byPath, b.byPath, "两棵树必须各自持有索引");
    assert.ok(a.byPath.has("x") && !a.byPath.has("p"));
    assert.ok(b.byPath.has("p") && !b.byPath.has("x"));
  });

  await t.test("hasContainers —— Collapse all 按钮的显隐依据（原为查 DOM 的 carets().length）", () => {
    assert.equal(buildTree({ a: 1, b: 2 }, makeMount()).hasContainers, false, "纯标量顶层：无可折叠块");
    assert.equal(buildTree({ a: { b: 1 } }, makeMount()).hasContainers, true);
  });

  await t.test("expandAll / collapseAll 可用（搜索的自动展开、Collapse all 都要它）", () => {
    const t1 = buildTree({ a: { b: 1 } }, makeMount());
    assert.equal(typeof t1.expandAll, "function");
    assert.equal(typeof t1.collapseAll, "function");
    assert.doesNotThrow(() => { t1.collapseAll(); t1.expandAll(); });
  });
});

// 以下针对 T-002 **新长出来**的 API。对抗审查用 5 个存活变异证明它们此前完全裸奔 ——
// 根因是 DOM 桩的 querySelector 每次返回新元素，caret 上的 _collapse 立刻丢失，
// 于是折叠相关的断言全都空转。桩改成按选择器记忆化后才测得到。这是 L-001 的小范围重演。
test("折叠机制 —— 真的隐藏子行、真的切预览", async (t) => {
  const findRow = (tree, pred) => tree.rows.find(pred);

  await t.test("collapseAll 把子行 display 设为 none", () => {
    const tr = buildTree({ a: { b: 1, c: 2 } }, makeMount());
    tr.collapseAll();
    const hidden = tr.rows.filter((r) => r.style.display === "none");
    assert.ok(hidden.length > 0, "折叠后必须有行被隐藏，否则 Collapse all 是空的");
  });

  await t.test("expandAll 把子行放回来", () => {
    const tr = buildTree({ a: { b: 1, c: 2 } }, makeMount());
    tr.collapseAll();
    tr.expandAll();
    assert.equal(tr.rows.filter((r) => r.style.display === "none").length, 0);
  });

  await t.test("折叠时显示 … } 预览、隐藏计数（否则折叠后看不出里面有东西）", () => {
    const tr = buildTree({ a: { b: 1 } }, makeMount());
    const head = findRow(tr, (r) => r.querySelector(".jk-caret")._collapse);
    const prev = head.querySelector(".jk-prev"), count = head.querySelector(".jk-count");
    tr.collapseAll();
    assert.equal(prev.hidden, false, "折叠时预览要显示");
    assert.equal(count.hidden, true, "折叠时计数要隐藏");
    tr.expandAll();
    assert.equal(prev.hidden, true);
    assert.equal(count.hidden, false);
  });
});

test("expandTo —— jumpTo 的地基", async (t) => {
  await t.test("展开目标的祖先链，目标变可见", () => {
    const tr = buildTree({ app: { db: { conn: { host: "h" }, pool: 1 } }, log: { level: "x" } }, makeMount());
    tr.collapseAll();
    const target = tr.byPath.get("app.db.conn.host");
    assert.ok(target, `找不到目标行: ${[...tr.byPath.keys()]}`);
    tr.expandTo(target);
    assert.notEqual(target.style.display, "none", "目标行必须可见，否则 jumpTo 会滚到一个隐藏行");
  });

  // 这条原来的标题写着"不动兄弟"，但断言只查了目标 —— 标题在撒谎，而底下真的有 bug：
  // _collapse 的 blockRows 是**全部后代**，展开外层会连内层仍折叠的块一起露出来。
  // 结果是 caret 显示折叠、内容却露着。折叠全部后手动点开一个块，今天就能复现。
  await t.test("不把仍折叠的内层块一起露出来（_collapse 的 blockRows 是全部后代）", () => {
    const tr = buildTree({ app: { db: { conn: { host: "h" } }, cache: { ttl: 9 } }, log: { level: "x" } }, makeMount());
    tr.collapseAll();
    tr.expandTo(tr.byPath.get("app.db.conn.host"));
    assert.equal(tr.byPath.get("app.db.conn.host").style.display, "", "目标可见");
    assert.equal(tr.byPath.get("app.cache.ttl").style.display, "none",
      "app.cache 仍是折叠的，它的内容不该露出来");
    assert.equal(tr.byPath.get("log.level").style.display, "none", "不相干的分支更不该露");
  });

  await t.test("手动展开一个块时同样不泄漏（不经 jumpTo 也能复现的路径）", () => {
    const tr = buildTree({ app: { db: { x: 1 } , cache: { y: 2 } } }, makeMount());
    tr.collapseAll();
    tr.byPath.get("app").querySelector(".jk-caret")._collapse(false); // 只展开 app
    assert.equal(tr.byPath.get("app.db.x").style.display, "none", "app.db 仍折叠，内容不该露");
  });

  // 反向断言 —— 缺了它，把祖先判定 rows[k]._depth < want 改成 <= 会误展开同深度的兄弟块，
  // 而 160 条测试全绿（对抗审查实测）。只断言"目标可见了"是不够的：一个把整棵树全展开的
  // 实现同样能让目标可见。
  await t.test("同深度的兄弟块不被误展开（祖先判定必须是严格小于）", () => {
    const tr = buildTree({ a: { x: 1 }, b: { y: 2 }, c: 3 }, makeMount());
    tr.collapseAll();
    tr.expandTo(tr.byPath.get("b.y"));
    assert.equal(tr.byPath.get("b.y").style.display, "", "目标可见");
    assert.equal(tr.byPath.get("a.x").style.display, "none", "兄弟块 a 不该被展开");
  });

  await t.test("expandAll 之后一切可见（重新断言：修复不能把批量展开搞坏）", () => {
    const tr = buildTree({ app: { db: { x: 1 }, cache: { y: 2 } } }, makeMount());
    tr.collapseAll();
    tr.expandAll();
    assert.equal(tr.byPath.get("app.db.x").style.display, "");
    assert.equal(tr.byPath.get("app.cache.y").style.display, "");
  });

  await t.test("对不在本树的行安全返回", () => {
    const tr = buildTree({ a: 1 }, makeMount());
    const alien = buildTree({ z: 9 }, makeMount()).rows[0];
    assert.doesNotThrow(() => tr.expandTo(alien));
  });
});

// T-003b。靶子先于测试选定（L-009）：这个改动最可能怎么坏？
// ① 跳到折叠块里的节点 → 不展开 → 滚到页顶、高亮在隐藏行上
// ② apath 不存在 → 应安全返回 false，不是抛异常
// ③ align 用错 → rail 的取景变了
// ④ Sort 重建后 byPath 是旧的 → 跳到 detached 行
test("jumpTo —— feature 2 的表格互跳与 feature 3 的校验定位都建在它上面", async (t) => {
  const mkScroll = () => ({ scrollTop: 0, clientHeight: 100, addEventListener() {} });

  await t.test("跳到折叠块内部的节点时先展开祖先 —— 否则滚到页顶、高亮在隐藏行", () => {
    const scrollEl = mkScroll();
    const tr = buildTree({ app: { db: { conn: { host: "h" } } } }, makeMount(), { scrollEl });
    tr.collapseAll();
    const target = tr.byPath.get("app.db.conn.host");
    assert.equal(target.style.display, "none", "前提：折叠后目标是隐藏的");
    // 契约变更（T-006）：jumpTo 成功时从返回 `true` 改为返回**目标行**——core 要读 row._trail
    // 把面包屑带到跳转目标。仍是 truthy，失败仍返回 false（下一条锁着）。显式改这行 = 让契约变更被看见。
    assert.equal(tr.jumpTo("app.db.conn.host"), target, "成功时返回目标行本身（不再是裸 true）");
    assert.notEqual(target.style.display, "none", "jumpTo 必须展开祖先链");
    assert.ok(target.classList.contains("jk-hit"), "必须高亮目标");
  });

  await t.test("apath 不存在时返回 false，不抛", () => {
    const tr = buildTree({ a: 1 }, makeMount(), { scrollEl: mkScroll() });
    assert.equal(tr.jumpTo("nope.nothere"), false);
  });

  await t.test("align:top 用 rail 的取景（-6），默认居中", () => {
    const scrollEl = mkScroll();
    const tr = buildTree({ a: { b: 1 }, c: 2, d: 3 }, makeMount(), { scrollEl });
    tr.byPath.get("c").offsetTop = 500;
    tr.jumpTo("c", { align: "top" });
    assert.equal(scrollEl.scrollTop, 494, "align:top 应为 offsetTop - 6");
    tr.jumpTo("c");
    assert.equal(scrollEl.scrollTop, 450, "默认应居中：offsetTop - clientHeight/2");
  });

  await t.test("不会滚出负值（目标在顶部时）", () => {
    const scrollEl = mkScroll();
    const tr = buildTree({ a: 1 }, makeMount(), { scrollEl });
    tr.jumpTo("a");
    assert.ok(scrollEl.scrollTop >= 0, "负的 scrollTop 是无意义的");
  });

  await t.test("没传 scrollEl 也不炸（子树面板等场景没有滚动容器）", () => {
    const tr = buildTree({ a: 1 }, makeMount());
    assert.doesNotThrow(() => tr.jumpTo("a"));
  });

  await t.test("topLevel 带 apath —— rail 靠它跳转", () => {
    const tr = buildTree({ a: { x: 1 }, b: { y: 2 }, c: 3 }, makeMount(), { scrollEl: mkScroll() });
    assert.deepEqual(tr.topLevel.map((t) => t.apath), ["a", "b", "c"]);
  });
});

// T-006。状态栏只能说"有 2 个重复 key，叫 a 和 b" —— 一千行的 JSON 里那不可行动。
// 设计稿把警告钉在出事的那一行上，这才是"把别家静默做错的事说出来"的完整形态。
// 靶（动手前列的）：① 标记钉错行 ② 同名 key 在别处被误标 ③ 排序后标记失效 ④ 标记没转义
test("重复 key 的行内标记 —— 说全，不只说一半", async (t) => {
  const dupPathsOf = (src) => {
    const diag = { dupKeys: [], bigInts: 0, lossy: [], dupPaths: [] };
    JSONBig.parse(src, diag);
    // 用出厂的 trailToPath，不再在测试里重算一遍 —— 原来这行是 core.js 的逐字孪生，
    // 于是验的是副本：core 那边怎么错都测不出来（实测 core 不传 dupPaths，245 条全绿）。
    return diag.dupPaths.map(trailToPath);
  };

  await t.test("解析器给出重复 key 的路径，不只是名字", () => {
    assert.deepEqual(dupPathsOf('{"profile":{"reputation":1,"reputation":2}}'), ["profile.reputation"]);
  });

  await t.test("数组里的重复 key 也定位得到", () => {
    assert.deepEqual(dupPathsOf('{"users":[{"id":1,"id":2}]}'), ["users[0].id"]);
  });

  await t.test("标记钉在正确的行上", () => {
    const src = '{"a":{"x":1,"x":2},"b":{"y":9}}';
    const mount = makeMount();
    const tr = buildTree(JSONBig.parse(src), mount, { dupPaths: dupPathsOf(src) });
    assert.match(tr.byPath.get("a.x").collectHTML(), /duplicate key/, "出事的行必须有标记");
    assert.ok(!/duplicate key/.test(tr.byPath.get("b.y").collectHTML()), "没事的行不该有");
  });

  await t.test("同名 key 在别的对象里不会被误标 —— 按路径不按名字", () => {
    // 名字匹配的话，b.id 会被 a 的 id 重复所连累
    const src = '{"a":{"id":1,"id":2},"b":{"id":9}}';
    const mount = makeMount();
    const tr = buildTree(JSONBig.parse(src), mount, { dupPaths: dupPathsOf(src) });
    assert.match(tr.byPath.get("a.id").collectHTML(), /duplicate key/);
    assert.ok(!/duplicate key/.test(tr.byPath.get("b.id").collectHTML()),
      "b.id 只出现过一次，不该被同名的 a.id 连累");
  });

  await t.test("排序后标记仍在正确的行上 —— 路径经得住重排，对象身份不行", () => {
    const src = '{"z":{"x":1,"x":2},"a":{"y":9}}';
    const paths = dupPathsOf(src);
    const parsed = JSONBig.parse(src);
    // 模拟 core 的 sortValue：深拷贝 + 重排 key
    const sortValue = (v) => Array.isArray(v) ? v.map(sortValue)
      : (v && typeof v === "object" && typeof v !== "bigint")
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortValue(v[k])])) : v;
    const tr = buildTree(sortValue(parsed), makeMount(), { dupPaths: paths });
    assert.match(tr.byPath.get("z.x").collectHTML(), /duplicate key/, "排序后标记不该丢");
  });

  await t.test("不传 dupPaths 时一个标记都没有（干净 JSON 不该有噪音）", () => {
    const tr = buildTree({ a: 1 }, makeMount());
    assert.ok(!/duplicate key/.test(tr.mount.collectHTML()));
  });

  await t.test("容器行的重复 key 也标得到（重复的是对象本身）", () => {
    const src = '{"cfg":{"a":1},"cfg":{"b":2}}';
    const tr = buildTree(JSONBig.parse(src), makeMount(), { dupPaths: dupPathsOf(src) });
    assert.match(tr.byPath.get("cfg").collectHTML(), /duplicate key/);
  });

  // 假阳性：重复 key 的值本身是容器时，**被丢弃**那份子树里记的路径会指向存活那份的行。
  // {"a":{"x":1,"x":2},"a":{"x":9}} → 存活的是 {x:9}，x 在里面只出现一次，
  // 却被钉上警告、tooltip 还说"this is the one that survived" —— 对它是纯假话。
  await t.test("被丢弃子树里的重复不冤枉存活的行", () => {
    const src = '{"a":{"x":1,"x":2},"a":{"x":9}}';
    const tr = buildTree(JSONBig.parse(src), makeMount(), { dupPaths: dupPathsOf(src) });
    assert.match(tr.byPath.get("a").collectHTML(), /duplicate key/, "a 确实重复了，该标");
    assert.ok(!/duplicate key/.test(tr.byPath.get("a.x").collectHTML()),
      "存活的 a.x 只出现过一次 —— 它没被丢掉任何东西，不该被钉警告");
  });

  await t.test("但 dupKeys 仍如实计数 —— 文档确实含那个重复，只是它的行不存在", () => {
    const diag = { dupKeys: [], bigInts: 0, lossy: [], dupPaths: [] };
    JSONBig.parse('{"a":{"x":1,"x":2},"a":{"x":9}}', diag);
    assert.deepEqual(diag.dupKeys.sort(), ["a", "x"], "计数说的是文档，不是渲染出来的树");
    assert.deepEqual(diag.dupPaths.map(trailToPath), ["a"], "路径说的是树上真实存在的行");
  });

  await t.test("多层丢弃：只有最外层那个重复留下", () => {
    const src = '{"o":{"p":{"q":1,"q":2}},"o":{"p":{"q":9}}}';
    const paths = dupPathsOf(src);
    assert.deepEqual(paths, ["o"], `实得: ${JSON.stringify(paths)}`);
  });
});

test("byPath —— apath→row 反查（jumpTo / markInvalid 都靠它）", async (t) => {
  await t.test("每个节点可按 apath 反查到行", () => {
    const tr = buildTree({ a: { b: 1 } }, makeMount());
    assert.equal(tr.byPath.get("a.b")._apath, "a.b");
    assert.equal(tr.byPath.get("a")._apath, "a");
  });

  await t.test("容器 apath 映射到头行而非闭合行（first-row-wins）", () => {
    const tr = buildTree({ a: { b: 1 } }, makeMount());
    const head = tr.byPath.get("a");
    assert.ok(head.querySelector(".jk-caret")._collapse, "必须是带折叠能力的头行");
  });

  await t.test("数组索引可反查", () => {
    const tr = buildTree({ xs: [10, 20] }, makeMount());
    assert.equal(tr.byPath.get("xs[1]")._val, 20);
  });
});
