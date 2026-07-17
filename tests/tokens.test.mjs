// 防护网 — 设计语言的单一来源与四层主题机制（T-005）。
//
// 这些是**纯文本断言**（读 CSS/HTML 源码），不是 DOM 断言 —— 所以不受 L-010 那堵墙的限制。
// 它们守的是三件在真浏览器里才会暴露、但成因全在源码里的事：
//   ① popup 与 viewer 的 token 漂移（实际发生过：深色底 #16181c vs #141619、强调色 #4c8dff vs #5b9bff）
//   ② token 表漏装载（var() 落空 → 整个界面无色）
//   ③ popup 不跟随手动主题（实际发生过：深色 viewer + 浅色 popup）
//
// 局限：这里验的是"源码里写了什么"，不是"浏览器渲染成什么样"。颜色对不对、对比度够不够、
// 深浅两版好不好看，只有真浏览器能回答 → 冒烟清单与 T-011 的逐页核对。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

// 必须先剥注释再匹配。第一版没剥，而 tokens.css 顶部的四层说明里正好有字面量
// `:root[data-jk-theme="dark"]` —— 正则从**注释**开始匹配、[^{]* 一路穿过去，抓到的第一个
// {...} 是浅色块。于是「深浅两套一致」变成"拿浅色块和自己比"，恒真；
// 把整个第 3 层实体块删掉（☾ 强制深色彻底失效）223 条测试一条不红。
// 断言读到的是我自己写的注释，不是产品 —— L-011 与 L-007 的合体。
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokensRaw = read("tokens.css");
const tokens = stripComments(tokensRaw);
const viewer = read("viewer.css");
const popupHtml = read("popup.html");
const viewerHtml = read("viewer.html");
const manifest = JSON.parse(read("manifest.json"));

test("四层主题机制 —— 机制比数值重要，改值可以，改机制不行", async (t) => {
  await t.test("第 1 层：:root 是浅色默认", () => {
    assert.match(tokens, /:root, \.jk-scope \{/);
  });

  await t.test("第 2 层：跟随系统深色", () => {
    assert.match(tokens, /@media \(prefers-color-scheme: dark\)/);
  });

  await t.test("第 2 层的 :not([data-jk-theme]) 不可删 —— 它是系统深色下强制浅色的唯一实现", () => {
    // 没有它，用户在深色系统里按 ☀ 强制浅色 → 媒体查询照样把深色值盖回去 → 按钮没反应
    assert.match(tokens, /@media \(prefers-color-scheme: dark\)\s*\{\s*\n?\s*:root:not\(\[data-jk-theme\]\)/);
  });

  await t.test("第 3 层：手动深色覆盖", () => {
    assert.match(tokens, /:root\[data-jk-theme="dark"\]/);
  });

  await t.test("第 4 层：四套语法配色，只重着色不动界面底色", () => {
    for (const skin of ["solarized", "monokai", "github"]) {
      assert.ok(tokens.includes(`[data-jk-skin="${skin}"]`), `缺配色 ${skin}`);
    }
    // 配色只该动语法色，不该动 panel/canvas —— 否则"只重着色"的承诺就破了
    const skinLines = tokens.split("\n").filter((l) => l.includes("data-jk-skin"));
    for (const line of skinLines) {
      assert.ok(!/--jk-(panel|canvas|bar|rail)\b/.test(line), `配色不该改界面底色: ${line.slice(0, 60)}`);
    }
  });

  // 「深浅两套」其实是**三块**：浅色 / 系统深色（@media）/ 手动深色。
  // 第一版只比了前两者中的两个，@media 那块从头到尾没网 —— 而第 2、3 层是**逐字复制的两份**，
  // 整个改动的立意就是"一个视觉语言不该有两份"，那两份之间却没有任何一致性断言。
  // 下一次漂移的温床，就在这个新文件里。
  // 选择器锚在行首（^…m），且 { 与 } 之间不许再出现 { —— 注释已剥掉，跨块穿越也堵死。
  const block = (selector) => {
    const re = new RegExp("^\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^{\\n]*\\{([^{}]*)\\}", "m");
    const m = tokens.match(re);
    assert.ok(m, `找不到实体块: ${selector}`);
    return m[1];
  };
  const names = (body) => new Set(body.match(/--jk-[\w-]+(?=:)/g) || []);
  const pairs = (body) => Object.fromEntries([...body.matchAll(/(--jk-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

  const LIGHT = ":root, .jk-scope";
  const MEDIA_DARK = ":root:not([data-jk-theme]), .jk-scope:not([data-jk-theme])";
  const MANUAL_DARK = ':root[data-jk-theme="dark"]';

  await t.test("三个块都是真实存在的实体块（不是注释里的字面量）", () => {
    for (const b of [LIGHT, MEDIA_DARK, MANUAL_DARK]) {
      assert.ok(names(block(b)).size > 10, `${b} 不是真块或 token 太少`);
    }
  });

  await t.test("浅色与手动深色的 token 名一一对应 —— 少一个就是那一档没定义", () => {
    assert.deepEqual([...names(block(LIGHT))].sort(), [...names(block(MANUAL_DARK))].sort());
  });

  await t.test("系统深色（@media）与手动深色 —— 名与值必须完全相同", () => {
    // 这两块是同一份深色的两个副本。名对不上 = 某个 token 在其中一档没定义（系统深色用户
    // 会看到浅色值漏在深色界面上）；值对不上 = 新的漂移，正是本次要消灭的东西。
    assert.deepEqual(pairs(block(MEDIA_DARK)), pairs(block(MANUAL_DARK)),
      "系统深色与手动深色必须逐值相同，否则两条路径给出不同的深色");
  });
});

test("单一来源 —— popup 不许再自带一套 token", async (t) => {
  await t.test("popup 链接了共享 tokens.css", () => {
    assert.match(popupHtml, /<link[^>]+href="tokens\.css"/);
  });

  await t.test("popup 里不再定义私有 token（漂移就是这么来的）", () => {
    const style = popupHtml.match(/<style>([\s\S]*?)<\/style>/)[1];
    const defined = style.match(/^\s*--[\w-]+:/gm) || [];
    assert.deepEqual(defined, [], `popup 不该定义 token，实得: ${defined}`);
  });

  await t.test("popup 引用的 token 全部是 --jk-* 且在 tokens.css 里真的存在", () => {
    const used = [...new Set(popupHtml.match(/var\((--[\w-]+)\)/g) || [])]
      .map((v) => v.slice(4, -1));
    assert.ok(used.length > 0, "popup 应当在用 token");
    for (const v of used) {
      assert.ok(v.startsWith("--jk-"), `${v} 不是共享 token`);
      assert.ok(tokens.includes(v + ":"), `${v} 在 tokens.css 里没有定义 → popup 会渲染成透明/黑`);
    }
  });

  await t.test("viewer.css 只用 token，不再自己定义（token 已搬走）", () => {
    const defined = viewer.match(/^\s*--jk-[\w-]+:/gm) || [];
    assert.deepEqual(defined, [], `token 该只在 tokens.css 里定义，viewer.css 残留: ${defined}`);
  });
});

// 这组原本断言"tokens.css 必须排在 viewer.css **之前**"，理由是"否则 var() 全落空"。
// 那个理由是错的，我自己查出来的：CSS 自定义属性在**计算值阶段**解析，`var()` 照样看得到
// 后加载的 `:root` 定义 —— 顺序只在同名 token 被覆盖时才有意义，而 viewer.css 定义了 0 个。
// 所以颠倒顺序什么也不会发生。
//
// 更值得记的是：我当时"变异顺序 → 测试红 → 宣布抓到"是**循环论证** —— 测试断言 X、
// 变异改 X，它必然红，这证明不了 X 重要（L-009 的新变种）。
// 真正会出事的是**压根没登记**：那时 var() 才真的落空、界面渲染成无色。下面守的是这个。
test("token 表必须被装载 —— 没登记时 var() 才真的落空、界面无色", async (t) => {
  await t.test("接管页（manifest）装载 tokens.css", () => {
    assert.ok(manifest.content_scripts[0].css.includes("tokens.css"),
      "content script 没装 tokens.css → 被接管的页面上整个界面无色");
  });

  await t.test("viewer 页装载 tokens.css", () => {
    assert.match(viewerHtml, /href="tokens\.css"/);
  });

  await t.test("popup 装载 tokens.css", () => {
    assert.match(popupHtml, /href="tokens\.css"/);
  });

  await t.test("manifest 登记的 css 文件都真实存在", () => {
    for (const f of manifest.content_scripts[0].css) {
      assert.doesNotThrow(() => read(f), `manifest 登记了不存在的 ${f}`);
    }
  });

  // 顺序之所以不重要，前提是两个表没有同名 token 在打架。这条守的是那个前提 ——
  // 哪天 viewer.css 又开始定义 token，顺序就重新变成雷，届时这条会红并提醒下一个人。
  await t.test("只有一个表定义 token —— 这才是顺序不重要的前提", () => {
    const inViewer = viewer.match(/^\s*--jk-[\w-]+:/gm) || [];
    assert.deepEqual(inViewer, [],
      "viewer.css 又定义 token 了 → 与 tokens.css 存在覆盖关系 → 装载顺序重新成为雷");
  });
});

// 实际发生过：深色 viewer + 浅色 popup。而 viewer 页自己也一样 —— 强制深色的用户打开它，
// 粘贴框是白的，直到点了 Format 才翻黑（applyTheme 只在 toolbar.mount 里跑）。
// 两个页面共用 theme-boot.js —— 各写一份正是 popup 与 viewer 当初漂移的成因。
test("扩展自己的页面跟随手动主题", async (t) => {
  const boot = read("theme-boot.js");
  const toolbarJs = read("toolbar.js");

  // 第一版是 assert.match(popupJs, /jk:theme/) —— **子串匹配**，把键名打成 "jk:themex"
  // 照样命中、223 全绿，而 bug 原样复活。跨模块的键名契约必须两边各自抠出来比。
  await t.test("读的键名与 toolbar 写的键名逐字相同", () => {
    const grab = (src) => {
      const m = src.match(/["'](jk:[\w:]+)["']/g) || [];
      return m.map((s) => s.slice(1, -1)).filter((k) => k.includes("theme"));
    };
    const writes = grab(toolbarJs), reads = grab(boot);
    assert.ok(writes.length > 0, "toolbar 应当在写主题键");
    assert.ok(reads.length > 0, "theme-boot 应当在读主题键");
    assert.deepEqual([...new Set(reads)], [...new Set(writes)],
      `键名对不上 → 页面永远读不到主题，bug 静默复活。写: ${writes} 读: ${reads}`);
  });

  // 键名有防线了，但**同一个跨模块契约的另一半 —— storage area —— 没有**。
  // 实测：把 theme-boot 的 chrome.storage.local 改成 .sync，279 条全绿。
  // 真实后果：toolbar 经 util.js 的 store 写的是 local，读 sync 那边没人写过 → 回调拿到 {}
  // → 属性永不设置 → 整个修复静默死掉。"storage" 权限同时涵盖两个 area，不报错、不抛异常。
  await t.test("读的 storage area 与 util 写的一致（local vs sync 会静默失效）", () => {
    const area = (src) => [...new Set((src.match(/chrome\.storage\.(\w+)/g) || []))];
    const writes = area(read("util.js")), reads = area(boot);
    assert.ok(writes.length > 0, "util 应当在用 chrome.storage");
    assert.deepEqual(reads, writes, `area 对不上 → 读不到任何东西，且不报错。写: ${writes} 读: ${reads}`);
  });

  await t.test("读到后设在 documentElement 上 —— tokens.css 的第 3 层就认这个", () => {
    assert.match(boot, /documentElement\.setAttribute\("data-jk-theme"/);
  });

  await t.test("只认 light/dark，auto 不设属性 —— 设了 auto 会让第 2 层的 :not() 失效", () => {
    assert.match(boot, /"light"\s*\|\|.*"dark"/);
  });

  await t.test("storage 不可用时不炸（某些上下文里拿不到）", () => {
    assert.match(boot, /try\s*\{[\s\S]*jk:theme[\s\S]*\}\s*catch/);
  });

  await t.test("popup 与 viewer 页都装载了它 —— 少一个，那个页面就只跟系统", () => {
    assert.match(popupHtml, /<script src="theme-boot\.js"><\/script>/);
    assert.match(viewerHtml, /<script src="theme-boot\.js"><\/script>/);
  });

  await t.test("只有一处实现 —— 各写各的正是当初漂移的成因", () => {
    for (const f of ["popup.js", "viewer.js"]) {
      assert.ok(!/data-jk-theme/.test(read(f)),
        `${f} 又自己实现了一遍主题同步 → 两份实现必然漂移，用 theme-boot.js`);
    }
  });
});

// jsonbig.js 里曾经有一个**字面** NUL 字节（正则 /[\\"<NUL>-<US>]/ 是直接把控制字节写进源码）。
// 功能完全正确，但 `file` 报 "data"、**git 把它当二进制** → 每次改动的 diff 都是一团 `Bin`，
// 而那是全项目唯一的正确性核心。审查看不见的改动 = 没有审查。
test("源码不含字面控制字符 —— 否则 git 当二进制、diff 不可读", async (t) => {
  const SRC = ["jsonbig.js", "util.js", "tree.js", "toolbar.js", "search.js", "rail.js",
               "status.js", "core.js", "content.js", "popup.js", "viewer.js"];
  for (const f of SRC) {
    await t.test(f, () => {
      const buf = readFileSync(join(ROOT, f));
      const bad = [];
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        // 允许 \t \n \r，其余 C0 控制字符与 DEL 都不该以字面形式出现在源码里
        if ((b < 0x20 && b !== 9 && b !== 10 && b !== 13) || b === 0x7f) bad.push([i, b]);
      }
      assert.deepEqual(bad, [],
        `${f} 含字面控制字符 ${JSON.stringify(bad)} → git 会把它当二进制，diff 不可读。请改用 \\uXXXX 转义`);
    });
  }
});

// 328px 是 Chrome 对 popup 的物理约束，不是偏好。真实渲染宽度只有浏览器能量（AC-002 → 冒烟），
// 但"源码里还写着 328px 吗"是可以锁的 —— 而那正是最容易在重做视觉时被顺手改掉的东西。
test("popup 的 328px 硬约束", async (t) => {
  const style = popupHtml.match(/<style>([\s\S]*?)<\/style>/)[1];

  await t.test("body 宽度写死 328px", () => {
    assert.match(style, /body\s*\{[^}]*width:\s*328px/,
      "popup 宽度必须是 328px —— Chrome 不给更宽，写别的值只会得到截断或留白");
  });

  // 这里原本有一条「没有会撑破它的 min-width」—— 已删除，它是 L-012 的原样重演：
  // popup 的 <style> 里 min-width 出现 **0 次**，循环体从来没执行过，恒真。
  // 而且断言词里那个因果（"min-width 会撑破 328px 的盒子"）我从未验证过 —— body 的宽度是
  // 写死的，子元素的 min-width 只会让它自己溢出，并不会把 body 撑宽。
  // 和当年"tokens.css 必须排在 viewer.css 之前"是同一个模子：真变异它会红，但那个性质不存在。

  await t.test("box-sizing:border-box —— 否则 padding 会把内容顶出 328px", () => {
    assert.match(style, /\*\s*\{[^}]*box-sizing:\s*border-box/);
  });
});

test("零网络红线 —— 样式里不许有远程资源", async (t) => {
  for (const [name, css] of [["tokens.css", tokens], ["viewer.css", viewer]]) {
    await t.test(`${name} 无 @import / 远程 url() / CDN 字体`, () => {
      assert.ok(!/@import/.test(css), "@import 会发网络请求");
      assert.ok(!/url\(\s*['"]?https?:/.test(css), "远程 url() 撞零网络红线");
      assert.ok(!/fonts\.googleapis|cdn\./.test(css), "设计稿的 Tailwind CDN / Google Fonts 不许流进来");
    });
  }

  await t.test("popup 内联样式同样干净", () => {
    const style = popupHtml.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.ok(!/@import|url\(\s*['"]?https?:/.test(style));
  });

  await t.test("字体只用系统栈 —— 设计稿的 Inter / JetBrains Mono 是远程加载的，不能要", () => {
    assert.ok(!/Inter/.test(viewer + tokens), "Inter 需要远程字体");
    assert.match(viewer, /system-ui/);
    assert.match(viewer, /ui-monospace/);
  });
});
