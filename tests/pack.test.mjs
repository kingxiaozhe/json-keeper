// 防护网 — 发布包的内容（T-007）。
//
// 为什么必须有：原来的打包命令是**排除式**的（`zip -r . -x '.git/*' '.claude/*' …`），
// 它打的是"没被明确排除的一切"。于是 tests/ 与 specs/ 一进仓库，包里就多了 PRD、设计稿 PNG、
// LESSONS.md、METRICS.md、运行日志和全部测试代码 —— 74 文件 / 304K，而**扩展包人人可解压**。
// 每加一个新目录就破防一次，且破了没人会立刻知道，直到内部资料已经发出去。
//
// 这些断言读的是 pack.sh 与 manifest，不实际打包（打包要 zip，且慢）。
// 真实打包产物由冒烟清单第 24 项人工验一次。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const pack = read("pack.sh");

test("打包用白名单，不用排除式", async (t) => {
  await t.test("pack.sh 存在且可执行", () => {
    assert.ok(existsSync(join(ROOT, "pack.sh")));
  });

  await t.test("文件清单从 manifest 推导 —— 不能和真正加载的东西脱节", () => {
    assert.match(pack, /manifest\.json/);
    assert.match(pack, /content_scripts/);
  });

  await t.test("绝不打包的东西有硬校验（签名私钥泄露 = 别人能冒名发更新）", () => {
    for (const forbidden of ["pem", "tests/", "specs/", "claude"]) {
      assert.ok(pack.includes(forbidden), `pack.sh 应校验 ${forbidden} 不入包`);
    }
    assert.match(pack, /REFUSING|exit 1/, "发现禁入文件时必须拒绝出包，而不是只打印警告");
  });

  await t.test("CLAUDE.md 记的构建命令与实际一致 —— 文档里留着旧命令，下个人就会用它", () => {
    const claudeMd = read(".claude/CLAUDE.md");
    assert.match(claudeMd, /pack\.sh/, "CLAUDE.md 的构建命令应指向 pack.sh");
    assert.ok(!/zip -r json-keeper\.zip \. -x/.test(claudeMd),
      "CLAUDE.md 里还留着旧的排除式命令 —— 那个命令会把 specs/ 和 tests/ 打进包");
  });
});

test("manifest 声明的每个文件都真实存在 —— 打包脚本据此推导，缺一个就出不了包", async (t) => {
  const cs = manifest.content_scripts[0];
  for (const f of [...cs.js, ...(cs.css || []), manifest.action.default_popup, ...Object.values(manifest.icons)]) {
    await t.test(f, () => {
      assert.ok(existsSync(join(ROOT, f)), `manifest 引用了不存在的 ${f}`);
    });
  }
});

// popup.js 顶层就解构 window.JK.util —— 漏加载 util.js 时它会在第一行抛 TypeError，
// popup 整个白屏。而 tests/popup.test.mjs 是自己 loadJK 的，测不到这条装载线。
test("popup 页装齐了它依赖的模块", async (t) => {
  const html = read("popup.html");
  for (const need of ["jsonbig.js", "util.js", "popup.js", "theme-boot.js", "tokens.css"]) {
    await t.test(need, () => {
      assert.ok(html.includes(need), `popup.html 漏了 ${need} —— popup.js 顶层解构 window.JK.util，缺它直接白屏`);
    });
  }

  await t.test("util.js 排在 popup.js 之前（JS 的加载顺序真的要紧，不像 CSS）", () => {
    const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(order.indexOf("util.js") < order.indexOf("popup.js"), `顺序错: ${order}`);
    assert.ok(order.indexOf("jsonbig.js") < order.indexOf("util.js"), `jsonbig 要先于 util: ${order}`);
  });
});

test("扩展页面引用的资源都存在 —— 否则装上去才发现白屏", async (t) => {
  for (const page of ["popup.html", "viewer.html"]) {
    await t.test(page, () => {
      const refs = [...read(page).matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
      assert.ok(refs.length > 0, `${page} 应当引用了资源`);
      for (const r of refs) {
        assert.ok(existsSync(join(ROOT, r)), `${page} 引用了不存在的 ${r}`);
      }
    });
  }
});
