// 测试用加载器 — 让浏览器里的 IIFE 模块在 Node 下可测，且不改动被测代码。
//
// jsonbig.js / core.js 都是 `(function (global) {...})(typeof window !== "undefined" ? window : globalThis)`，
// 靠副作用挂全局。Node 里 window 未定义，于是挂到 globalThis —— 直接求值源码即可。
// 用 new Function 而非 import：这些文件不是 ESM/CJS，没有 export。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (name) => readFileSync(join(ROOT, name), "utf8");
const run = (src) => new Function(src).call(globalThis);

export function loadJSONBig() {
  if (!globalThis.JSONBig) run(read("jsonbig.js"));
  return globalThis.JSONBig;
}

// core.js 只经 window.JK 暴露 mountViewer / normalize，但 esc / escAttr / buildTree /
// valueHTML / childAccessor 才是拆分（T-002/T-003）要搬走的东西 —— 不锁住它们，网就是摆设。
//
// 做法：把源码里的导出行替换成一个更宽的导出，其余一字不改。这是特征化测试的正当手段：
// 跑的是**同一份源码**，只是把内部件也递出来。
// 比正则抠单行 const 强的地方：esc 改成多行写法 / 提取共享常量 / 改成 function 声明，
// 本文件都照常工作（那些是行为保持的重构，不该误报红）。
export function loadInternals() {
  const src = read("core.js");
  const EXPORT_LINE = "global.JK = { mountViewer, normalize };";
  if (!src.includes(EXPORT_LINE)) {
    throw new Error(
      "core.js 的导出行变了 —— 拆分后应改为从 util.js / tree.js 取件，请同步更新本加载器"
    );
  }
  loadJSONBig();
  const patched = src.replace(
    EXPORT_LINE,
    "global.__JK_INTERNALS = { mountViewer, normalize, buildTree, valueHTML, childAccessor, esc, escAttr, isContainer, humanSize, idKey };"
  );
  run(patched);
  return globalThis.__JK_INTERNALS;
}

// 按 manifest.json 声明的顺序加载 content script —— 锁住"加载拓扑"这个盲区。
// 硬编码 run("core.js") 抓不到"拆分后漏登记 util.js"，而那会让接管 100% 失效且无报错。
export function loadPerManifest() {
  const manifest = JSON.parse(read("manifest.json"));
  const files = manifest.content_scripts[0].js;
  const g = {};
  for (const f of files) {
    if (f === "content.js") continue; // 需要真实 document，这里只验模块层
    new Function("window", "globalThis", read(f)).call(g, undefined, g);
  }
  return { files, JK: g.JK, JSONBig: g.JSONBig };
}
