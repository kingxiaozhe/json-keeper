// 防护网基线 — normalize() 的现状行为（T-001）。
//
// T-002 会把 normalize 从 core.js 搬到 util.js（因为 popup 也要用它做就地试解析）。
// 搬完后本文件的 import 改指 util.js，断言原样不动 —— 那正是这张网要抓的回归。
//
// 为什么重要：normalize 是"接管门禁"的一部分（content.js 用它判断页面是不是 JSON），
// 也是产品宣传的容错能力（冒烟清单第 7 项）。它错了，要么该接管的不接管，要么误伤普通页面。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadInternals } from "./_load.mjs";

const { normalize } = loadInternals();

test("XSSI 前缀剥离 —— 真实 API 的防盗链前缀", async (t) => {
  await t.test(")]}' 前缀", () => {
    assert.equal(normalize(')]}\'\n{"a":1}'), '{"a":1}');
  });

  await t.test(")]}, 前缀（带逗号变体）", () => {
    assert.equal(normalize(')]},\n{"a":1}'), '{"a":1}');
  });

  await t.test("while(1); 前缀", () => {
    assert.equal(normalize('while(1);{"a":1}'), '{"a":1}');
  });

  await t.test("for(;;); 前缀", () => {
    assert.equal(normalize('for(;;);{"a":1}'), '{"a":1}');
  });
});

test("JSONP 解包", async (t) => {
  await t.test("简单回调名", () => {
    assert.equal(normalize('cb({"a":1})'), '{"a":1}');
  });

  await t.test("带点的回调名", () => {
    assert.equal(normalize('window.cb({"a":1})'), '{"a":1}');
  });

  await t.test("末尾带分号", () => {
    assert.equal(normalize('cb({"a":1});'), '{"a":1}');
  });

  await t.test("包裹数组", () => {
    assert.equal(normalize("cb([1,2])"), "[1,2]");
  });

  await t.test("包裹的不是 JSON 值时不解包（内层须以 [ { \" 开头）", () => {
    assert.equal(normalize("cb(123)"), "cb(123)");
  });
});

test("不误伤 —— 普通输入原样返回", async (t) => {
  await t.test("干净对象", () => {
    assert.equal(normalize('{"a":1}'), '{"a":1}');
  });

  await t.test("干净数组", () => {
    assert.equal(normalize("[1,2]"), "[1,2]");
  });

  await t.test("首尾空白被 trim", () => {
    assert.equal(normalize('  {"a":1}  '), '{"a":1}');
  });

  await t.test("普通 HTML 文本不被当 JSONP 解包", () => {
    assert.equal(normalize("<html><body>hi</body></html>"), "<html><body>hi</body></html>");
  });
});
