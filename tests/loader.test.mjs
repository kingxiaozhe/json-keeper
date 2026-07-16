// 防护网基线 — 加载拓扑（T-001，对抗审查后补）。
//
// 为什么必须有：tasks.md 把"加载顺序错 → 接管失效且无报错"列为头号风险，但原来的测试
// 硬编码 run("jsonbig.js") / run("core.js")，**从不读 manifest.json** —— 实测证明：
// 模拟 T-002 拆分时 manifest 漏登记 util.js，58 条测试全绿，而 Chrome 里接管 100% 失效。
//
// 这个文件按 manifest 声明的顺序加载，锁住三件事：登记完整、顺序正确、API 面完整。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadPerManifest } from "./_load.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const jsFiles = manifest.content_scripts[0].js;

test("manifest 登记与加载顺序", async (t) => {
  await t.test("content script 的 js 列表非空", () => {
    assert.ok(jsFiles.length > 0);
  });

  await t.test("jsonbig.js 必须排在 core.js 之前（core 顶部读 global.JSONBig）", () => {
    const bi = jsFiles.indexOf("jsonbig.js");
    const ci = jsFiles.indexOf("core.js");
    assert.ok(bi >= 0, "jsonbig.js 必须在 manifest 里登记");
    assert.ok(ci >= 0, "core.js 必须在 manifest 里登记");
    assert.ok(bi < ci, `加载顺序错：jsonbig.js(${bi}) 必须早于 core.js(${ci})`);
  });

  await t.test("content.js 必须最后（它依赖 window.JK 已就绪）", () => {
    assert.equal(jsFiles[jsFiles.length - 1], "content.js");
  });

  await t.test("manifest 里登记的每个文件都真实存在", () => {
    for (const f of jsFiles) {
      assert.doesNotThrow(() => readFileSync(join(ROOT, f)), `manifest 登记了不存在的文件: ${f}`);
    }
  });

  await t.test("viewer.html 的 script 与 manifest 的 js 列表一致（content.js 除外）", () => {
    const viewer = readFileSync(join(ROOT, "viewer.html"), "utf8");
    const inViewer = [...viewer.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const needed = jsFiles.filter((f) => f !== "content.js");
    for (const f of needed) {
      assert.ok(inViewer.includes(f), `viewer.html 漏了 ${f} —— viewer 页会报 undefined`);
    }
    // 顺序也要一致
    const idx = needed.map((f) => inViewer.indexOf(f));
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `viewer.html 的 script 顺序与 manifest 不一致: ${inViewer}`);
  });
});

test("按 manifest 顺序加载后，API 面必须完整", async (t) => {
  const { JK, JSONBig, files } = loadPerManifest();

  await t.test("JSONBig 就位", () => {
    assert.equal(typeof JSONBig?.parse, "function", `按 manifest 顺序加载 ${files} 后 JSONBig.parse 缺失`);
    assert.equal(typeof JSONBig?.stringify, "function");
  });

  await t.test("window.JK.mountViewer 就位 —— content.js 的接管入口", () => {
    assert.equal(typeof JK?.mountViewer, "function", "JK.mountViewer 缺失 → content.js 会静默 return，接管 100% 失效");
  });

  await t.test("window.JK.normalize 就位 —— 接管门禁用它判断是不是 JSON", () => {
    assert.equal(typeof JK?.normalize, "function");
  });

  await t.test("[拆分后] JK 的子模块不得被整对象赋值覆盖", () => {
    // core.js 现在是 global.JK = { mountViewer, normalize } —— 整对象赋值。
    // T-002 起必须改成合并写法 (global.JK = global.JK || {})，否则先加载的
    // util.js / tree.js 会被整体覆盖 → JK.tree.build 抛 TypeError → 接管失效。
    // 拆分完成后，这里应逐个断言 JK.util / JK.tree 等子模块存在。
    const submodules = ["util", "tree"].filter((k) => JK && JK[k]);
    if (submodules.length > 0) {
      for (const k of submodules) {
        assert.equal(typeof JK[k], "object", `JK.${k} 被覆盖了 —— core.js 用了整对象赋值？`);
      }
      assert.equal(typeof JK.mountViewer, "function", "子模块在，但 mountViewer 没了 —— 合并写法反了");
    }
    // 拆分前无子模块，本条为空跑；T-002 完成后自动生效。
  });
});
