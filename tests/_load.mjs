// 测试用加载器 — 让浏览器里的 IIFE 模块在 Node 下可测，且不改动被测代码。
//
// 每个模块都是 `(function (global) {...})(typeof window !== "undefined" ? window : globalThis)`，
// 靠副作用挂全局。Node 里 window 未定义，于是挂到 globalThis —— 直接求值源码即可。
// 用 new Function 而非 import：这些文件不是 ESM/CJS，没有 export。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (name) => readFileSync(join(ROOT, name), "utf8");
const run = (src) => new Function(src).call(globalThis);

// manifest 是加载顺序的唯一事实来源 —— 硬编码顺序会让"拆分后漏登记"变成盲区，
// 而那个失败模式是：Chrome 里 JK.tree 未定义、接管静默失效。
const manifestFiles = () =>
  JSON.parse(read("manifest.json")).content_scripts[0].js.filter((f) => f !== "content.js");

export function loadJSONBig() {
  if (!globalThis.JSONBig) run(read("jsonbig.js"));
  return globalThis.JSONBig;
}

// 按 manifest 顺序把 content script 模块加载进本进程的 globalThis。
// T-002 之前这里要给 core.js 的导出行打补丁才能拿到内部件；拆分后 util.js / tree.js
// 正经导出了，补丁随之消失 —— 加载器变简单本身就是拆分到位的信号。
export function loadJK() {
  if (!globalThis.JK || !globalThis.JK.tree) {
    for (const f of manifestFiles()) run(read(f));
  }
  return globalThis.JK;
}

// 隔离加载：不碰进程全局，用于验证"按 manifest 顺序加载后 API 面完整"。
export function loadPerManifest() {
  const files = JSON.parse(read("manifest.json")).content_scripts[0].js;
  const g = {};
  for (const f of files) {
    if (f === "content.js") continue; // 需要真实 document，这里只验模块层
    new Function("window", "globalThis", read(f)).call(g, undefined, g);
  }
  return { files, JK: g.JK, JSONBig: g.JSONBig };
}
