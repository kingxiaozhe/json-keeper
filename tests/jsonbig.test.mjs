// 防护网基线 — jsonbig.js 的现状行为（T-001）。
//
// 纪律：只锁现状，不判断对错。这里断言的是"今天它就是这么干的"，不是"它应该这么干"。
// 已知的现状缺陷（[1e] → NaN 静默改数据）也照实锁住并标注 —— 修它是 feature 5 的事，
// 到时这里的断言会被**有意**改掉，那次改动必须是显式的、看得见的。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadJSONBig } from "./_load.mjs";

const JSONBig = loadJSONBig();

test("大整数保真 — 产品存在的理由", async (t) => {
  await t.test("超出 safe integer 的整数变 BigInt，不丢精度", () => {
    const v = JSONBig.parse('{"id":136986234663732436}');
    assert.equal(typeof v.id, "bigint");
    assert.equal(v.id.toString(), "136986234663732436");
  });

  await t.test("显示与复制一致 — stringify 往返不失真", () => {
    const src = '{"id":136986234663732436}';
    assert.equal(JSONBig.stringify(JSONBig.parse(src)), src);
  });

  await t.test("BigInt 序列化不带 n 后缀、不带引号 —— 复制出去必须是合法 JSON", () => {
    const out = JSONBig.stringify(JSONBig.parse('{"id":136986234663732436}'));
    // 断 `136986234663732436n` 这个整体，不断裸字母 n —— 后者靠"输入里恰好没有 n"才成立，
    // 换个含 n 的 key 就假红（对抗审查指出的弱断言）。
    assert.ok(!/136986234663732436n/.test(out), `不该有 n 后缀: ${out}`);
    assert.ok(!out.includes('"136986234663732436"'), `不该被引号包住: ${out}`);
    assert.doesNotThrow(() => JSON.parse(out), "原生 JSON.parse 必须能吃下");
  });

  await t.test("safe integer 边界：安全范围内保持 Number", () => {
    assert.equal(typeof JSONBig.parse("[9007199254740991]")[0], "number");
  });

  await t.test("safe integer 边界：超出即转 BigInt", () => {
    assert.equal(typeof JSONBig.parse("[9007199254740993]")[0], "bigint");
  });

  await t.test("浮点保持 Number（差评只针对整数）", () => {
    assert.equal(typeof JSONBig.parse("[1.5]")[0], "number");
  });

  await t.test("负的大整数同样保真", () => {
    const v = JSONBig.parse("[-136986234663732436]");
    assert.equal(typeof v[0], "bigint");
    assert.equal(v[0].toString(), "-136986234663732436");
  });
});

test("诊断收集 — 正确性报告的数据源", async (t) => {
  await t.test("重复 key 被记录，且取最后一个值（JSON 规范如此，别家静默丢弃）", () => {
    const diag = { dupKeys: [], bigInts: 0 };
    const v = JSONBig.parse('{"a":1,"a":2}', diag);
    assert.deepEqual(diag.dupKeys, ["a"]);
    assert.equal(v.a, 2);
  });

  await t.test("多个重复 key 全部记录", () => {
    const diag = { dupKeys: [], bigInts: 0 };
    JSONBig.parse('{"a":1,"a":2,"b":3,"b":4}', diag);
    assert.deepEqual([...new Set(diag.dupKeys)].sort(), ["a", "b"]);
  });

  await t.test("无重复时 dupKeys 为空", () => {
    const diag = { dupKeys: [], bigInts: 0 };
    JSONBig.parse('{"a":1,"b":2}', diag);
    assert.deepEqual(diag.dupKeys, []);
  });

  await t.test("big-int 计数 —— 徽章 ✓ N big-ints exact 的来源", () => {
    const diag = { dupKeys: [], bigInts: 0 };
    JSONBig.parse('{"a":136986234663732436,"b":136986234663732437,"c":1}', diag);
    assert.equal(diag.bigInts, 2);
  });

  await t.test("不传 diag 时不报错（诊断是 opt-in，老调用方不受影响）", () => {
    assert.doesNotThrow(() => JSONBig.parse('{"a":1,"a":2}'));
  });
});

test("容错解析 — 真实 API 响应能进来", async (t) => {
  await t.test("JSONC 行注释", () => {
    assert.deepEqual(JSONBig.parse('{"a":1 // 注释\n}'), { a: 1 });
  });

  await t.test("JSONC 块注释", () => {
    assert.deepEqual(JSONBig.parse('{/* 头 */"a":1}'), { a: 1 });
  });

  await t.test("对象尾逗号", () => {
    assert.deepEqual(JSONBig.parse('{"a":1,}'), { a: 1 });
  });

  await t.test("数组尾逗号", () => {
    assert.deepEqual(JSONBig.parse("[1,2,]"), [1, 2]);
  });

  await t.test("字符串里的 // 不被当注释（注释扫描只在 token 之间）", () => {
    assert.deepEqual(JSONBig.parse('{"url":"http://a.com"}'), { url: "http://a.com" });
  });
});

test("报错行为 — feature 5 的错误定位要在此基础上加字段", async (t) => {
  await t.test("非法 JSON 抛 SyntaxError，message 含 position", () => {
    assert.throws(() => JSONBig.parse('{"a":}'), (e) => {
      assert.ok(e instanceof SyntaxError);
      assert.match(e.message, /at position \d+/);
      return true;
    });
  });

  await t.test("未闭合字符串报 Unterminated string", () => {
    assert.throws(() => JSONBig.parse('{"a":"x'), /Unterminated string/);
  });

  await t.test("尾部多余字符报错", () => {
    assert.throws(() => JSONBig.parse('{"a":1} xx'), /Unexpected trailing characters/);
  });

  // 以下三条原为 [现状缺陷] 断言（锁住 v0.8.0 的静默改数据行为）。
  // T-001b 修复后**有意翻转** —— 这个动作就是让修复被看见的机制，正是防护网纪律的用意。
  await t.test("裸负号报带 position 的 SyntaxError（原为原生 BigInt 错误、无 position）", () => {
    assert.throws(() => JSONBig.parse('{"a": -}'), (e) => {
      assert.ok(e instanceof SyntaxError, `应为 SyntaxError，实为 ${e.constructor.name}`);
      assert.match(e.message, /Invalid number: -/);
      assert.match(e.message, /at position \d+/, "必须带位置，否则错误面板定位不了");
      return true;
    });
  });

  await t.test("[1e] 被拒绝（原为解析'成功'返回 NaN → Copy 出 null）", () => {
    // 原生 JSON.parse 也拒绝它 —— 之前我们比原生更宽松地吐出垃圾
    assert.throws(() => JSON.parse("[1e]"), SyntaxError, "前提：原生也拒绝");
    assert.throws(() => JSONBig.parse("[1e]"), /Invalid number: 1e/);
  });

  await t.test("[1e+] / [-] 等截断字面量同样被拒绝", () => {
    assert.throws(() => JSONBig.parse("[1e+]"), /Invalid number/);
    assert.throws(() => JSONBig.parse("[-]"), /Invalid number/);
  });

  await t.test("[1e999] 溢出为 Infinity 时记入 diag.lossy —— 不静默放行", () => {
    // 原生 JSON.parse 也返回 Infinity，故这里不拒绝（拒绝会比原生更严），
    // 但复制出去确实会变 null，所以记下来让 UI 能标出。
    const diag = { dupKeys: [], bigInts: 0, lossy: [] };
    const v = JSONBig.parse("[1e999]", diag);
    assert.equal(v[0], Infinity);
    assert.deepEqual(diag.lossy, ["1e999"]);
  });

  await t.test("正常浮点不进 lossy", () => {
    const diag = { dupKeys: [], bigInts: 0, lossy: [] };
    JSONBig.parse("[1.5, 1e10, -2.5e-3]", diag);
    assert.deepEqual(diag.lossy, []);
  });

  await t.test("老调用方不传 lossy 字段也不炸（向后兼容）", () => {
    const diag = { dupKeys: [], bigInts: 0 }; // T-001b 之前的构造形状
    assert.doesNotThrow(() => JSONBig.parse("[1e999]", diag));
  });
});

test("stringify — 复制出去的必须是合法 JSON", async (t) => {
  await t.test("缩进参数生效", () => {
    assert.equal(JSONBig.stringify({ a: 1 }, 2), '{\n  "a": 1\n}');
  });

  await t.test("控制字符被转义（裸控制字节会让 JSON 非法）", () => {
    const out = JSONBig.stringify({ a: "xy" });
    assert.ok(out.includes("\\u0001"), `控制字符须转义: ${out}`);
    assert.doesNotThrow(() => JSON.parse(out));
  });

  await t.test("引号与反斜杠被转义", () => {
    const out = JSONBig.stringify({ a: 'q"b\\c' });
    assert.doesNotThrow(() => JSON.parse(out));
    assert.equal(JSON.parse(out).a, 'q"b\\c');
  });

  await t.test("常见空白转义走短形式", () => {
    assert.equal(JSONBig.stringify({ a: "\n\t" }), '{"a":"\\n\\t"}');
  });
});
