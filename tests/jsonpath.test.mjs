// 防护网 — 自研 JSONPath 求值器（T-102/T-103）。
//
// 这是与 jsonbig.js 同级的**新正确性资产**。风险点写明：切片 / 负索引 / 递归下降的边界易错，
// 这份单测是唯一防线，不能只靠手测。所以这里往死里覆盖边界，而不是"能跑通几个 happy path"。
//
// 两条护城河级的不变式，单列出来盯：
//   ① apath 必须与 tree.js 的 childAccessor 逐字一致 —— 否则 F-105 跳转会打到错节点、复制路径给假路径。
//   ② 大整数必须**原样穿过** —— 求值全程传引用，绝不 Number()/parseInt，BigInt 进什么出什么。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadJK, loadJSONBig } from "./_load.mjs";

const JK = loadJK();
const JSONBig = loadJSONBig();
const jp = JK.jsonpath;

// 求值到值数组（丢掉 path/apath，只看命中了哪些值）
const values = (expr, data) => {
  const r = jp.parse(expr);
  assert.ok(r.ok, "parse 应成功: " + expr + " — " + JSON.stringify(r.error));
  return jp.evalPath(r.ast, data).map((m) => m.value);
};
const full = (expr, data) => {
  const r = jp.parse(expr);
  assert.ok(r.ok, "parse 应成功: " + expr);
  return jp.evalPath(r.ast, data);
};

test("parse 错误态 —— 就地报错，位置可指", async (t) => {
  await t.test("不以 $ 开头", () => {
    const r = jp.parse("users.email");
    assert.equal(r.ok, false);
    assert.match(r.error.msg, /start with \$/);
    assert.equal(r.error.pos, 0);
  });
  await t.test("filter ?() 给专门提示，不是裸语法错", () => {
    const r = jp.parse("$.users[?(@.age>18)]");
    assert.equal(r.ok, false);
    assert.match(r.error.msg, /[Ff]ilter/, "要明说是 filter 不支持，别报 generic syntax error");
  });
  await t.test("未闭合的 [", () => assert.equal(jp.parse("$.users[").ok, false));
  await t.test("裸键（未加引号）给出可操作提示", () => {
    const r = jp.parse("$[users]");
    assert.equal(r.ok, false);
    assert.match(r.error.msg, /\["users"\]/, "应提示改成 [\"users\"]");
  });
  await t.test("坏切片 [1:2:3]", () => assert.equal(jp.parse("$.a[1:2:3]").ok, false));
  await t.test(". 后面没名字", () => assert.equal(jp.parse("$.").ok, false));
});

test("子属性：点号与括号等价", () => {
  const d = { users: { email: "a@b.c" } };
  assert.deepEqual(values("$.users.email", d), ["a@b.c"]);
  assert.deepEqual(values("$['users']['email']", d), ["a@b.c"]);
  assert.deepEqual(values("$.users.nope", d), [], "不存在的键返回空，不报错");
});

test("通配 [*] 与 .*", () => {
  const d = { a: 1, b: 2, c: 3 };
  assert.deepEqual(values("$.*", d).sort(), [1, 2, 3]);
  assert.deepEqual(values("$[*]", [10, 20, 30]), [10, 20, 30]);
  assert.deepEqual(values("$[*]", {}), [], "空对象通配返回空");
});

test("索引：正 / 负 / 越界", () => {
  const d = ["x", "y", "z"];
  assert.deepEqual(values("$[0]", d), ["x"]);
  assert.deepEqual(values("$[-1]", d), ["z"], "负索引从尾部");
  assert.deepEqual(values("$[-3]", d), ["x"]);
  assert.deepEqual(values("$[9]", d), [], "越界返回空");
  assert.deepEqual(values("$[-9]", d), [], "负越界也返回空");
});

test("切片 [a:b] —— 边界最容易错的地方", () => {
  const d = [0, 1, 2, 3, 4];
  assert.deepEqual(values("$[1:3]", d), [1, 2], "半开区间");
  assert.deepEqual(values("$[:2]", d), [0, 1], "省略 start = 0");
  assert.deepEqual(values("$[3:]", d), [3, 4], "省略 end = 末尾");
  assert.deepEqual(values("$[-2:]", d), [3, 4], "负 start 从尾部");
  assert.deepEqual(values("$[:-2]", d), [0, 1, 2], "负 end 从尾部");
  assert.deepEqual(values("$[3:1]", d), [], "start>=end 返回空，不报错");
  assert.deepEqual(values("$[0:99]", d), [0, 1, 2, 3, 4], "end 越界被夹到长度");
  // 对抗审查 G1：下界钳制。负得离谱的 start 必须夹到 0，绝不能产出 undefined（Copy 出 null =
  // 静默改数据，产品头号大忌）。去掉 Math.max(0,…) 这条会静默变绿，所以专门锁它。
  assert.deepEqual(values("$[-100:100]", d), [0, 1, 2, 3, 4], "大负 start 夹到 0，不吐 undefined");
  assert.ok(values("$[-100:100]", d).every((x) => x !== undefined), "结果里绝不能有 undefined");
  assert.deepEqual(values("$[-100:2]", d), [0, 1], "负 start 夹 0 后仍尊重 end");
});

test("多选 [a,b] / ['a','b']", () => {
  assert.deepEqual(values("$[0,2]", ["a", "b", "c", "d"]), ["a", "c"]);
  assert.deepEqual(values("$['x','z']", { x: 1, y: 2, z: 3 }), [1, 3]);
  assert.deepEqual(values("$[0,9]", ["a", "b"]), ["a"], "union 里越界项跳过，不报错");
});

test("递归下降 ..key / ..*", () => {
  const d = { store: { book: [{ author: "A" }, { author: "B" }], bicycle: { author: "C" } } };
  assert.deepEqual(values("$..author", d).sort(), ["A", "B", "C"], "任意深度收集 author");
  const all = values("$..*", d);
  assert.ok(all.length >= 6, "..* 收集所有后代节点");
  assert.deepEqual(values("$.store..author", d).sort(), ["A", "B", "C"], "递归可接在子路径后");
});

// 对抗审查 F1：`..` 是 descendant-or-self，$..[n]/$..[*] 必须含**被递归的节点自身**，不只是后代。
test("递归下降含 self：$..[0] / $..['k'] 不能漏掉根节点自己", () => {
  const d = [[10, 11], [20, 21]];
  // 标准（RFC 9535）：self [[10,11],[20,21]] 的 [0] = [10,11]，加上两个子数组各自的 [0]
  assert.deepEqual(values("$..[0]", d), [[10, 11], 10, 20], "根数组自己的 [0] 也要在结果里");
  const d2 = { author: "root", child: { author: "deep" } };
  assert.deepEqual(values("$..['author']", d2).sort(), ["deep", "root"], "根自己的 author 不能漏");
  // $..* on {a:[1,2]} = 数组 [1,2] 本身 + 1 + 2 = 3 项
  assert.equal(values("$..*", { a: [1, 2] }).length, 3, "..* 含中间容器节点");
});

// 对抗审查 G2：child/union 走 hasOwnProperty，不能用 `k in o`，否则原型链上的键会被"命中"。
test("原型键不泄漏 —— $.__proto__ / $.constructor 返回空", () => {
  const d = { a: 1 };
  assert.deepEqual(values("$.__proto__", d), [], "__proto__ 不是自有属性，不该命中");
  assert.deepEqual(values("$.constructor", d), [], "constructor 同理");
  assert.deepEqual(values("$.hasOwnProperty", d), [], "方法名也不该命中");
  assert.deepEqual(values("$['__proto__','constructor']", d), [], "union 里也不放原型键");
  // 但真有这个自有键时要命中（别防过头）
  assert.deepEqual(values("$.constructor", { constructor: "mine" }), ["mine"], "自有的 constructor 键照常命中");
});

test("组合路径：$.users[*].email（AC-101 的形状）", () => {
  const d = { users: [{ email: "a@b.c" }, { email: "d@e.f" }, { name: "no email" }] };
  assert.deepEqual(values("$.users[*].email", d), ["a@b.c", "d@e.f"], "缺 email 的那条自然不进结果");
});

test("护城河 ①：apath 与 childAccessor 逐字一致", () => {
  const d = { users: [{ "e-mail": "a@b.c" }], "weird key": [1] };
  // 数组下标 → [n]；合法标识符键 → .key；非法标识符键 → ["key"]
  const m1 = full("$.users[0]['e-mail']", d);
  assert.equal(m1[0].apath, 'users[0]["e-mail"]', "非标识符键走 [\"...\"]，和 childAccessor 一样");
  const m2 = full("$.users[0]", d);
  assert.equal(m2[0].apath, "users[0]");
  const m3 = full("$['weird key'][0]", d);
  assert.equal(m3[0].apath, '["weird key"][0]', "根下的非标识符键也走 [\"...\"]");
  // 真的能被 tree 反查到（apath 是给 jumpTo 用的）
  assert.equal(JK.tree.trailToPath(["users", 0, "e-mail"]), 'users[0]["e-mail"]', "trailToPath 同源");
});

test("path（JSONPath 串）用于显示/复制", () => {
  const d = { users: [{ email: "a" }] };
  assert.equal(full("$.users[*].email", d)[0].path, "$.users[0].email");
  const d2 = { "weird key": [1] };
  assert.equal(full("$['weird key'][0]", d2)[0].path, "$['weird key'][0]", "非标识符键在 path 里用 ['...']");
});

test("护城河 ②：大整数原样穿过，绝不 Number()", () => {
  // 用真实 BigInt 数据（经 JSONBig 解析），查询后必须 === 原值
  const data = JSONBig.parse('{"id": 9007199254740993, "list": [136986234663732436]}');
  const idVal = values("$.id", data)[0];
  assert.equal(typeof idVal, "bigint", "9007199254740993 该是 BigInt，不是被 Number 截断的 double");
  assert.equal(idVal, 9007199254740993n);
  const listVal = values("$.list[0]", data)[0];
  assert.equal(listVal, 136986234663732436n, "数组里的大整数同样保真（这正是产品的招牌例子）");
  // 引用穿过：返回的就是原对象里的那个值
  assert.equal(values("$.list[*]", data)[0], data.list[0], "传引用，不是拷贝");
});

test("安全红线：源码里没有 eval / new Function（AC-108）", () => {
  // 这条守的是"实现方式"，不是"输出" —— 求值器一旦偷偷用 eval，整个零依赖/审核可读叙事就破了。
  // **必须先剥注释**：jsonpath.js 的文件头正是在解释"为什么不用 eval / new Function"，
  // 不剥的话正则会咬中那段说明、恒红（L-012：注释毒化正则，T-005 栽过一次）。
  const src = readSrc().replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\beval\s*\(/.test(src), "jsonpath.js 不得有 eval(");
  assert.ok(!/new\s+Function/.test(src), "jsonpath.js 不得有 new Function");
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
function readSrc() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return readFileSync(join(root, "jsonpath.js"), "utf8");
}
