// 防护网 — Schema 推断 + TS 导出（T-202/203/204）。
//
// 立场：推断即猜测，每处猜测都必须**写进产物**（不只 UI），因为产物会被复制走。别家把空数组
// 推成 any[]、大整数推成 number —— 那正是本 feature 要区别于它们的地方。所以这里往死里锁：
// 五种不确定情形各自的标注、大整数不许静默变 number、TS 标识符不许拼出语法错。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadJK, loadJSONBig } from "./_load.mjs";

const JK = loadJK();
const JSONBig = loadJSONBig();
const S = JK.schema;

test("AC-201：基本对象推断 —— type/properties/required", () => {
  const { schema } = S.infer({ id: 1, name: "a" });
  assert.equal(schema.type, "object");
  assert.equal(schema.properties.id.type, "integer");
  assert.equal(schema.properties.name.type, "string");
  assert.deepEqual(schema.required.sort(), ["id", "name"]);
});

test("整数 vs 浮点：1→integer，1.5→number", () => {
  assert.equal(S.infer({ a: 1 }).schema.properties.a.type, "integer");
  assert.equal(S.infer({ a: 1.5 }).schema.properties.a.type, "number");
});

test("AC-202：TS 导出可粘贴（interface Root { id: number })", () => {
  const { code } = S.toTypeScript({ id: 1 });
  assert.match(code, /interface Root \{/);
  assert.match(code, /id: number;/);
});

test("AC-203：联合类型 —— [{a:1},{a:'x'}] 的 a 是 union，且带不确定标注", () => {
  const { schema, uncertainties } = S.infer([{ a: 1 }, { a: "x" }]);
  const a = schema.items.properties.a;
  assert.deepEqual(a.type.sort(), ["integer", "string"], "Schema 里 a 是 [integer,string]");
  assert.ok(a["x-inferred-uncertain"], "union 必须带不确定标注（样本可能不全）");
  assert.ok(uncertainties.some((u) => /differing types|union/i.test(u.reason)), "计入不确定清单");
  // TS 侧
  const ts = S.toTypeScript([{ a: 1 }, { a: "x" }]).code;
  assert.match(ts, /number \| string/, "TS 输出 number | string");
});

test("AC-204：空数组 → unknown[]，绝不 never[]/any[] 而不加说明", () => {
  const { schema, uncertainties } = S.infer({ a: [] });
  assert.equal(schema.properties.a.type, "array");
  assert.ok(!("items" in schema.properties.a) || schema.properties.a.items === undefined, "无 items（无样本）");
  assert.ok(schema.properties.a["x-inferred-uncertain"], "空数组必须标注不确定");
  assert.ok(uncertainties.some((u) => /empty array/i.test(u.reason)));
  const ts = S.toTypeScript({ a: [] }).code;
  assert.match(ts, /unknown\[\]/, "TS 输出 unknown[]");
  assert.ok(!/never\[\]|any\[\]/.test(ts), "绝不 never[]/any[]");
  assert.match(ts, /⚠[^\n]*empty array/, "并附 ⚠ 注释");
});

test("AC-205：大整数 → x-bigint / bigint，绝不静默 number（护城河）", () => {
  const value = JSONBig.parse('{"id": 136986234663732436}');
  const { schema } = S.infer(value);
  assert.equal(schema.properties.id.type, "integer");
  assert.equal(schema.properties.id["x-bigint"], true, "Schema 标 x-bigint");
  const ts = S.toTypeScript(value).code;
  assert.match(ts, /id: bigint;/, "TS 输出 bigint，不是 number —— 输出 number 会让用户丢精度");
  assert.match(ts, /big integer|precision/i, "附精度说明注释");
});

test("AC-206：只见过 null → 标可空且类型不确定", () => {
  const { schema, uncertainties } = S.infer({ a: null });
  assert.equal(schema.properties.a.type, "null");
  assert.ok(schema.properties.a["x-inferred-uncertain"], "null 要标不确定（真实类型未知）");
  assert.ok(uncertainties.some((u) => /null/i.test(u.reason)));
  assert.match(S.toTypeScript({ a: null }).code, /a: null;/);
});

test("空对象 → Record<string, unknown> + 不确定标注", () => {
  const { schema } = S.infer({ a: {} });
  assert.equal(schema.properties.a.type, "object");
  assert.ok(schema.properties.a["x-inferred-uncertain"]);
  assert.match(S.toTypeScript({ a: {} }).code, /Record<string, unknown>/);
});

test("required 只收所有元素都有的 key（缺失 vs 存在，同表格那条线）", () => {
  const both = S.infer([{ a: 1, b: 2 }, { a: 3 }]).schema.items;
  assert.deepEqual(both.required, ["a"], "b 只在第一个元素里 → 可选，不进 required");
  assert.ok("a" in both.properties && "b" in both.properties, "但两个 key 都进 properties");
  // TS：可选键带 ?
  const ts = S.toTypeScript([{ a: 1, b: 2 }, { a: 3 }]).code;
  assert.match(ts, /b\?: number/, "b 是可选（带 ?）");
});

test("TS 标识符安全：a-b / 1x / 空串 → 引号形式，不拼出语法错", () => {
  const ts = S.toTypeScript({ "a-b": 1, "1x": 2, "": 3, "class": 4 }).code;
  assert.match(ts, /"a-b": number/, "含连字符的 key 加引号");
  assert.match(ts, /"1x": number/, "数字开头加引号");
  assert.match(ts, /"": number/, "空串 key 加引号");
  // 保留字（class）**允许**做接口字段名，裸写合法 —— 不必加引号，加了反而多余
  assert.match(ts, /(^|\s)class: number/, "保留字做字段名裸写即可（TS 允许）");
  assert.ok(!/[^"]a-b:/.test(ts), "绝不出现裸 a-b: （那是语法错）");
});

test("嵌套对象内联渲染，深层大整数也标 bigint", () => {
  const value = JSONBig.parse('{"user": {"id": 9007199254740993, "name": "x"}}');
  const ts = S.toTypeScript(value).code;
  assert.match(ts, /user: \{/, "嵌套对象内联");
  assert.match(ts, /id: bigint/, "深层大整数仍 bigint");
});
