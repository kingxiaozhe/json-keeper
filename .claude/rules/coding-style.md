---
description: 零依赖原生 JS Chrome 扩展的编码风格：IIFE 全局模块、2 空格双引号、注释只写「为什么」
---

# 编码风格

无 eslint/prettier 配置，风格靠本文件与现有代码保持一致。改动前先读 `core.js` 前 30 行，那是本项目风格的样板。

## 量化标准

| 项 | 上限 | 现状基线 |
| ---- | ---- | ---- |
| 函数长度 | 40 行 | `buildTree` 是已知例外，新函数不得再破例 |
| 文件长度 | 400 行 | `core.js` 373 行已接近上限，再加功能先拆文件 |
| 嵌套深度 | 3 层 | |
| 函数参数 | 4 个 | 超过就传 options 对象（如 `mountViewer(el, text, opts)`） |

## 模块组织（不可改的硬约束）

- 每个文件是一个 IIFE，首行 `"use strict";`，通过 `window.JK` / `window.JSONBig` 暴露。**禁止 ES module / import / export / bundler**：content script 注入环境不便 ES import，且零构建是本项目的审核卖点。
- 加载顺序固定 `jsonbig.js` → `core.js` → `content.js`（见 manifest.json）。core 可用 JSONBig，反之不行。
- **禁止引入任何 npm 依赖**。需要的能力自己写（parser 已自研）。零依赖 = 无远程代码 = 商店审核与信任叙事的一部分。

## 命名

- 文件命名：kebab 单词小写、扁平放仓库根（`jsonbig.js`、`viewer.js`），不建 src/ 层级
- 变量/函数：camelCase（`buildTree`、`humanSize`、`childAccessor`）
- 常量：UPPER_SNAKE（`const LARGE = 1_000_000;`），数字字面量用 `_` 分隔提高可读性
- CSS 类与 storage key 一律 `jk-` / `jk:` 前缀（`jk-tree`、`jk-null`、`"jk:pending"`）—— content script 注入别人的页面，前缀是防冲突的唯一手段
- 小工具函数用 `const fn = (x) => ...` 箭头；有控制流的用 `function` 声明

## 格式

- 2 空格缩进；字符串用**双引号**；语句加分号
- 单行 if 允许写成 `if (!ok) return;`；短函数体允许单行 `{ ... }`

## 注释

- 只解释「为什么」，尤其是**安全与正确性的理由**——这是本项目注释的主要价值。文件头写模块职责 + 存在意义。
- 每个反直觉的防御性写法必须留下原因，否则后人会「优化」掉它。

```js
// Bad：复述代码做了什么，删掉它下一个人照样看得懂
// 把 s 里的引号替换成 &quot;
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

// Good：写出没有它会怎样（这是现有代码的真实注释）
// esc() for text-node content; escAttr() also neutralizes quotes for use inside
// double-quoted HTML attributes (without it, a crafted JSON key could break out
// of a title="" attribute and inject markup — an XSS in the viewed page).
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
```

## Bad / Good：渲染用户数据

```js
// Bad：JSON 内容直接进 innerHTML —— 任意页面可控的字符串 = XSS
row.innerHTML = '<span class="jk-key">' + key + "</span>";

// Good：文本位置 esc()，属性位置 escAttr()，一个都不能漏
row.innerHTML = '<span class="jk-key" title="' + escAttr(path) + '">' + esc(key) + "</span>";
```

## Bad / Good：解析与序列化

```js
// Bad：原生 JSON 把 136986234663732436 变成 136986234663732430 —— 本产品存在的理由就是这个 bug
const data = JSON.parse(text);

// Good：一律走 JSONBig，显示和复制都保真
const data = JSONBig.parse(text, diag);
```
