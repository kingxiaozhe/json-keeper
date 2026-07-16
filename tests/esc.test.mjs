// 防护网基线 — esc / escAttr 的现状行为（T-001）。
//
// 这是全项目唯一的 XSS 防线：content script 把**任意网站**的 JSON 拼进 innerHTML。
// esc 管文本位置，escAttr 额外中和引号（否则一个精心构造的 key 就能从 title="" 里逃出来注入）。
//
// 现在它们是 core.js 的内部 const，没导出 —— loadInternals() 用加宽导出行的方式取件。
// T-002 把它们移到 util.js 导出后，本文件改为 import util.js，断言必须原样通过。
//
// 注意：本文件只验函数**本身**。调用点（真正的 XSS 防线装没装）在 tree.test.mjs ——
// 那是对抗审查抓到的洞：只测函数时，把 core.js 的 esc(key) 改成裸 key，这里照样全绿。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadInternals } from "./_load.mjs";

const { esc, escAttr } = loadInternals();

test("esc — 文本位置转义", async (t) => {
  await t.test("尖括号与和号", () => {
    assert.equal(esc("<script>"), "&lt;script&gt;");
    assert.equal(esc("a & b"), "a &amp; b");
  });

  await t.test("典型注入串被中和", () => {
    assert.equal(esc('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
  });

  await t.test("非字符串入参不炸（String(s) 兜底）", () => {
    assert.equal(esc(1), "1");
    assert.equal(esc(null), "null");
  });

  await t.test("[现状] esc 不转义引号 —— 所以属性位置必须用 escAttr", () => {
    assert.equal(esc('a"b'), 'a"b');
  });
});

test("escAttr — 属性位置转义（多中和一个引号）", async (t) => {
  await t.test("双引号变实体 —— 防止从 title=\"\" 里逃逸", () => {
    assert.equal(escAttr('a"b'), "a&quot;b");
  });

  await t.test("属性逃逸攻击被挡住", () => {
    const evil = '" onmouseover="alert(1)';
    const out = escAttr(evil);
    assert.ok(!out.includes('"'), `裸引号必须消失，否则可逃逸: ${out}`);
    assert.equal(out, "&quot; onmouseover=&quot;alert(1)");
  });

  await t.test("同时具备 esc 的能力", () => {
    assert.equal(escAttr("<a>"), "&lt;a&gt;");
  });

  await t.test("组合攻击串", () => {
    const out = escAttr('"><script>alert(1)</script>');
    assert.ok(!out.includes('"'));
    assert.ok(!out.includes("<"));
    assert.ok(!out.includes(">"));
  });
});
