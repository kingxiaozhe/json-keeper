// 防护网 — 自研 Schema 校验器（T-205）。
//
// 这是 feature 3 最难的一块，设计已吸收三处对抗审查纠正，这里逐条锁死：
//   ① 关键字三分（支持 / 注解型静默 / 断言型明确提示）—— 二分会让产品自己导出的 Schema 满屏报警
//   ② BigInt 同时满足 integer 与 number —— 招牌数据不能被自家校验器判违规
//   ③ $ref 循环检测 —— {"$ref":"#"} 和递归 Schema 是合法输入，没检测会卡死标签页
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadJK, loadJSONBig } from "./_load.mjs";

const JK = loadJK();
const JSONBig = loadJSONBig();
const V = (schema, value) => JK.schema.validate(schema, value);
const kw = (r) => r.errors.map((e) => e.keyword);

test("AC-207：缺失 required → 报错且定位到 root", () => {
  const r = V({ type: "object", required: ["b"] }, { a: 1 });
  assert.equal(r.ok, false);
  const req = r.errors.find((e) => e.keyword === "required");
  assert.ok(req, "有 required 错误");
  assert.match(req.msg, /b/);
  assert.equal(req.apath, "", "定位到 root（缺失的 key 没有节点，标在缺它的那个对象上）");
});

test("AC-212：BigInt 满足 integer（招牌数据不许判违规）", () => {
  const value = JSONBig.parse('{"id": 136986234663732436}');
  const r = V({ type: "object", properties: { id: { type: "integer" } } }, value);
  assert.equal(r.ok, true, "136986234663732436n 必须过 integer —— 常规 Number.isInteger 会误判");
  // 也满足 number
  assert.equal(V({ type: "object", properties: { id: { type: "number" } } }, value).ok, true);
});

test("AC-211：自产自校验零警告（x-* 注解型静默忽略）", () => {
  const value = JSONBig.parse('{"id": 136986234663732436}');
  const { schema } = JK.schema.infer(value);   // 含 x-bigint、$schema
  const r = V(schema, value);
  assert.equal(r.ok, true, "自己导出的 Schema 贴回校验自己，必须零警告");
  assert.equal(r.errors.length, 0, "x-bigint / x-inferred-uncertain / $schema 都不该报");
});

test("AC-213：真实 Schema 的注解关键字不满屏报警", () => {
  const schema = { $schema: "x", title: "T", description: "d", type: "object", properties: { a: { type: "integer", description: "the a" } } };
  const r = V(schema, { a: 1 });
  assert.equal(r.ok, true, "$schema/title/description 三个注解关键字零提示");
});

test("三分政策：断言型未支持关键字**明确提示**（不静默放过）", () => {
  const r = V({ type: "object", allOf: [{ required: ["x"] }] }, { a: 1 });
  assert.ok(kw(r).includes("allOf"), "allOf 不支持 → 明确提示，不能假装通过");
  assert.match(r.errors.find((e) => e.keyword === "allOf").msg, /not supported|incomplete/i);
  // pattern / format / anyOf 同理
  assert.ok(kw(V({ pattern: "^x" }, "y")).includes("pattern"));
  assert.ok(kw(V({ anyOf: [] }, 1)).includes("anyOf"));
});

test("未知（非断言）关键字按规范静默忽略", () => {
  // 规范：未知关键字忽略。只有**已知的断言型**才提示。
  const r = V({ type: "integer", "x-my-annotation": "whatever", "someRandomKeyword": 5 }, 3);
  assert.equal(r.ok, true, "x-* 与完全未知的关键字都不报");
});

test("type 不符 → 报错并说明期望/实得", () => {
  const r = V({ type: "string" }, 5);
  assert.ok(kw(r).includes("type"));
  assert.match(r.errors[0].msg, /string/);
});

test("enum / const", () => {
  assert.equal(V({ enum: ["a", "b"] }, "a").ok, true);
  assert.equal(V({ enum: ["a", "b"] }, "c").ok, false);
  assert.equal(V({ const: 42 }, 42).ok, true);
  assert.equal(V({ const: 42 }, 43).ok, false);
});

test("min/max 用 BigInt 比，不丢精度", () => {
  // 边界是大整数：v 刚好等于边界要过，差 1 要拒
  const min = JSONBig.parse('{"minimum": 136986234663732436}').minimum;
  assert.equal(V({ minimum: min }, 136986234663732436n).ok, true, "等于下界过");
  assert.equal(V({ minimum: min }, 136986234663732435n).ok, false, "差 1 也要能分出来（Number 比会丢精度看不出）");
  // 浮点边界仍走 Number 比
  assert.equal(V({ maximum: 1.5 }, 1.4).ok, true);
  assert.equal(V({ maximum: 1.5 }, 1.6).ok, false);
});

test("嵌套 properties + 错误定位到具体节点（apath 复用 childAccessor）", () => {
  const r = V({ properties: { user: { properties: { age: { type: "integer" } } } } }, { user: { age: "old" } });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].apath, "user.age", "错误定位到 user.age，可交给 tree.jumpTo");
});

test("additionalProperties:false 拒绝多余键", () => {
  const r = V({ type: "object", properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2 });
  assert.ok(kw(r).includes("additionalProperties"));
  assert.equal(r.errors.find((e) => e.keyword === "additionalProperties").apath, "b", "标在多余的 b 上");
});

test("AC-214：循环 $ref {\"$ref\":\"#\"} 不卡死，报明确错误", () => {
  const r = V({ $ref: "#" }, { a: 1 });   // 自引用 → 深度超限
  assert.ok(kw(r).includes("$ref"));
  assert.match(r.errors[0].msg, /circular|exceeded|depth/i);
});

test("AC-215：递归 Schema 在有限数据上正常出结果（不卡死）", () => {
  const schema = JSONBig.parse('{"$defs":{"Node":{"type":"object","properties":{"next":{"$ref":"#/$defs/Node"}}}},"$ref":"#/$defs/Node"}');
  // 核心是"不卡死、能终止"——它没爆栈就返回了。数据全是对象（next 每层都是 Node），应通过。
  const r = V(schema, { next: { next: {} } });
  assert.ok(Array.isArray(r.errors), "必须终止并给出结果，不能卡死/爆栈");
  assert.equal(r.ok, true, "next 每层都是对象 → 满足递归的 Node 定义");
  // 而 next 为 null（不是 Node）时应被如实指出 —— 递归 Schema 本身没给 null 分支
  const r2 = V(schema, { next: null });
  assert.ok(r2.errors.some((e) => e.keyword === "type"), "null 不是 Node，如实报 type 错（不是卡死也不是放过）");
});

test("AC-216：JSON Pointer 转义 ~1→/ 正确解析 key 含斜杠的 $def", () => {
  const schema = JSONBig.parse('{"$defs":{"a/b":{"type":"string"}},"$ref":"#/$defs/a~1b"}');
  assert.equal(V(schema, "hi").ok, true, "~1 解析成 / → 命中 key 'a/b' 的 schema");
  assert.equal(V(schema, 5).ok, false, "解析对了才能校验：数字不符 string");
});

test("远程 $ref 被拒绝，且说明是零网络红线（不是能力缺失）", () => {
  const r = V({ $ref: "https://example.com/schema.json" }, { a: 1 });
  assert.ok(kw(r).includes("$ref"));
  assert.match(r.errors[0].msg, /network|remote|refused/i, "要说清是零网络约束");
});

test("$ref 目标不存在 → 明确报错，不崩", () => {
  const r = V({ $ref: "#/$defs/Nope" }, 1);
  assert.ok(kw(r).includes("$ref"));
  assert.match(r.errors[0].msg, /not found/i);
});

test("深但不循环的合法嵌套不被误报为循环 $ref（审查 #1，真 bug 已修）", () => {
  // 70 层深、无任何 $ref 的普通对象 + 对应 schema —— 数据深 ≠ schema 循环
  let val = 1, sch = { type: "integer" };
  for (let i = 0; i < 70; i++) { val = { next: val }; sch = { type: "object", properties: { next: sch } }; }
  const r = V(sch, val);
  assert.equal(r.ok, true, "70 层深的合法嵌套必须通过，不能误报循环");
  assert.ok(!r.errors.some((e) => e.keyword === "$ref"), "不该有任何 $ref 错误");
});

test("长链表（递归 Schema + 深数据）不被误报循环，只有真自引用才报", () => {
  const schema = JSONBig.parse('{"$defs":{"Node":{"type":"object","properties":{"next":{"$ref":"#/$defs/Node"}}}},"$ref":"#/$defs/Node"}');
  // 100 层链表，尾是 {} —— 每层 value 不同，不是循环
  let val = {};
  for (let i = 0; i < 100; i++) val = { next: val };
  assert.equal(V(schema, val).ok, true, "100 层链表是有限深数据，不是循环，应通过");
  // 真自引用 {"$ref":"#"} 才报 circular
  const cyc = V({ $ref: "#" }, { a: 1 });
  assert.match(cyc.errors[0].msg, /circular/i);
});
