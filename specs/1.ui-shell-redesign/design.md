# UI Shell 重做 — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始设计 |

## 项目架构

- 架构类型: 单体前端应用（Chrome MV3 扩展）
- 涉及层: 内容脚本（content script）· 扩展页面（popup / viewer）· 样式层。**无后端、无数据库、无构建**。

## 设计基准

- **档位: ② 结构基准**（人工确认）。页面结构、信息层级、交互流程必须与 `specs/docs/design-baseline/` 一致；视觉样式可再设计。验收为逐页元素清单核对 + 流程走查，**不做 BackstopJS 像素比对**。
- 基准路径: `specs/docs/design-baseline/`（s1-viewer-light、s2-popup-dark、s3-table-diff-dark 各含 HTML + PNG）。
- **基准缺陷已知**（选择结构档的直接原因）：三张稿均为深色（S1 标题写 Light 但渲染为深色）、popup 画在 2560×2048 桌面画布而非 328px、viewer 页粘贴区缺失。这些**不作为还原目标**，按本文档与 PRD 修正。
- **基准不可作为生产代码**：稿件依赖 `cdn.tailwindcss.com` 与 `fonts.googleapis.com` 远程加载，与本项目"零网络、无远程代码"红线（`.claude/rules/security.md`）冲突，且 MV3 CSP 会拦截。还原任务须将 Tailwind 类翻译为 `viewer.css` 原生 CSS，字体使用系统栈。

## 波及面（B2）

本 feature 修改全部存量前端模块。无业务地图（小项目，`.claude/CLAUDE.md` 判定跳过），波及面由直接读码 + Grep 核实得出。

| 改动目标 | 谁引用它 | 可能受影响的老功能 |
| --- | --- | --- |
| `core.js` 拆分为多模块 | `manifest.json` 的 `content_scripts.js` 数组（顺序敏感）；`viewer.html` 的 `<script>` 标签；`content.js` 依赖 `window.JK.mountViewer` / `window.JK.normalize` | 页面接管、viewer 渲染。**加载顺序错 → `window.JK` 未定义 → 接管静默失效** |
| `viewer.css` 重构 | 接管页（`html.jk-active`）与 viewer 页（`.jk-page`）共用；`jk-` 前缀防宿主页 CSS 冲突 | 所有视觉；**前缀丢失会污染被接管的任意网页** |
| `popup.html` / `popup.js` | `manifest.json` 的 `action.default_popup`；经 `chrome.storage.local` 的 `jk:pending` 与 viewer 交接 | 粘贴入口 → viewer 的交接链路 |
| `viewer.html` / `viewer.js` | `popup.js` 的 `chrome.tabs.create` 目标 | 独立工作台 |
| 状态栏 / 徽章 / 警告的渲染 | `mountViewer` 内的 `diag` 收集（`JSONBig.parse(text, diag)`） | **三个信任信号** —— 产品护城河，退化即事故 |

**不改动**: `jsonbig.js`（解析核心）、`content.js` 的接管判定逻辑（先解析成功再替换页面的安全约束不得松动）。

## 功能模块设计

### 模块 1: core.js 拆分

**问题**: `core.js` 现 373 行，`.claude/rules/coding-style.md` 定的上限为 400 行。本 feature 新增状态，后续 4 个 feature 各需挂载新视图/新面板 —— 不拆则必然破线。

**拆法**（全部沿用 IIFE + `window.JK` 命名空间，禁止 ESM / bundler）:

| 文件 | 职责 | 暴露 |
| --- | --- | --- |
| `jsonbig.js` | 不动。解析 + 诊断 | `window.JSONBig` |
| `util.js` | `esc` / `escAttr` / `humanSize` / `isContainer` / `idKey` / `store` / **`normalize`** | `window.JK.util` + `window.JK.normalize` |
| `tree.js` | `buildTree` / `valueHTML` / `childAccessor` | `window.JK.tree` |
| `toolbar.js` | 工具栏构建 + IA 分组 + 主题/配色/排序 | `window.JK.toolbar` |
| `search.js` | 搜索、命中计数、跳转、无结果态 | `window.JK.search` |
| `rail.js` | 结构栏 + scroll-spy | `window.JK.rail` |
| `status.js` | 状态栏 + 空态/加载态/降级说明 | `window.JK.status` |
| `core.js` | 编排：`mountViewer`，装配以上模块，持有面包屑元素 | `window.JK.mountViewer` |

**`normalize` 归 util 层，不归编排层**（对抗审查采纳）: 它是纯字符串函数（无 DOM、无 chrome API），被 `content.js` 当独立工具用于接管门禁，且 popup 的就地试解析（F-006）也必须用它 —— 否则粘贴 `)]}'{"a":1}` 或 JSONP `cb({"a":1})` 时 popup 报"非法 JSON"，而同一份内容进 viewer 却能正常渲染（`mountViewer` 走了 `normalize`）。**popup 与 viewer 对同一输入给出相反结论，且误报的恰是本产品宣传的容错能力**（testing.md 冒烟第 7 项）。

**加载顺序**（`manifest.json` 与 `viewer.html` 必须一致）:
`jsonbig.js` → `util.js` → `tree.js` → `toolbar.js` → `search.js` → `rail.js` → `status.js` → `core.js` → `content.js`
popup 额外需要: `jsonbig.js` + `util.js`（仅这两个，不加载整个 viewer 栈）。

### 命名空间合并约定（不可违反）

**现状陷阱**: `core.js:372` 是**整对象赋值** `global.JK = { mountViewer, normalize };`。若照搬且 core.js 排在最后，前 6 个模块挂载的 `JK.util`/`JK.tree`/… **会被整体覆盖** → 打开任意 JSON 网址时 `content.js` 的 `!window.JK` 守卫通过（JK 确实存在）→ `mountViewer` 内 `JK.tree.build` 抛 `TypeError: Cannot read properties of undefined` → 接管 100% 失效。

**每个模块一律用合并写法，禁止整对象赋值**:
```js
(function (global) {
  "use strict";
  var JK = (global.JK = global.JK || {});   // 合并，不覆盖
  JK.tree = { build, valueHTML, childAccessor };
})(typeof window !== "undefined" ? window : globalThis);
```
`core.js` 同样: `JK.mountViewer = mountViewer;`，**不得** `global.JK = {...}`。

### mountViewer 闭包变量归属（定契约前必须先定这个）

对抗审查指出: 原契约是照"应该有哪些模块"写的，不是照 `core.js` 实际数据流写的。故先把 `mountViewer` 内的闭包变量逐个定归属，契约据此推导：

| 闭包变量 | 现位置 | 归属 | 说明 |
| --- | --- | --- | --- |
| `value` / `displayValue` / `sorted` / `pretty` / `minified` | core.js:173-175 | **core.js** | 编排层持有数据 |
| `diag`(`dupKeys`/`bigInts`) | core.js:156 | **core.js** 产出 → 分发给 toolbar(chip) 与 status(warn) | 见下 |
| `_collapse` / `carets()` | core.js:114/218 | **tree.js**，经 `build()` 返回值导出 | 搜索的自动展开、Collapse all 都要它 |
| `scrollEl` | core.js:214 | **core.js** 持有，传给 search / rail | 两者都要 |
| `crumbEl` | core.js:215 | **core.js** 持有；tree 通过 `onCrumb` 事件回传路径 | 面包屑由 tree 的行点击驱动，不是 rail 的产物 |
| `rawText.length` / `topInfo` | core.js:177/202 | **core.js** 计算 → 传给 toolbar(meta) 与 status(heavy 文案) | 两处都要字节数 |

**信任信号的实际分布**（对照 `core.js` 实测，勿凭直觉划分）:
- `chipHTML`（`✓ N big-ints exact`）在**工具栏**右侧（core.js:202）
- `warnHTML`（`⚠ N duplicate keys`）在**状态栏**（core.js:220/255）
- 状态栏常驻信任文案在**状态栏**（core.js:221/258）

**契约不变**: `window.JK.mountViewer(rootEl, rawText, opts)` 与 `window.JK.normalize(text)` 的**对外**签名与返回值保持不变 —— `content.js` 依赖 `mountViewer` 返回 `false` 时不替换页面，这是安全约束。

### 模块 2: 工具栏信息架构（F-003）

**问题**: 现有 11 组控件已排满；后续 4 组新功能（查询栏、表格视图、Schema 导出、历史/Diff）需要位置。

**方案**: 三段式 + 溢出收纳。

```
[ 主操作 ] [ 视图分段器 ] [ 查询/搜索 ]        [ 工具菜单 ▾ ] [ 元信息 · 信任徽章 ]
  Copy JSON   Tree|Table|Raw|Min   搜索框         ⋯            1.2MB · 8 keys · ✓ N big-ints
```

| 区 | 内容 | 理由 |
| --- | --- | --- |
| 主操作（常驻左） | `⧉ Copy JSON` | 产品核心卖点，永不收纳 |
| 视图分段器 | `Tree \| Table \| Raw \| Min`（Table 由 feature 2 加入） | 主视图切换是高频、互斥、需一眼可见 |
| 查询/搜索 | 搜索框（`/` 聚焦），feature 2 在此并入查询栏 | 高频 |
| 工具菜单 `⋯` | Collapse all · Sort · Download · 主题 · 配色 · （后续）Schema 导出 · 历史 · Diff | 低频或偶发，收进菜单 |
| 元信息 + 信任徽章（常驻右） | 大小 · 计数 · `✓ N big-ints exact` | **信任信号常驻，不收纳** |

**扩展约定**: 后续 feature 新增控件**默认进工具菜单**；要提到一级必须在该 feature 的 design.md 说明理由。这条约定是本模块的主要产出 —— 它防止工具栏被后续 4 个 feature 再次挤爆。

### 模块 3: 缺失态（F-005~F-011）

| 状态 | 归属模块 | 设计 |
| --- | --- | --- |
| popup 空输入 | `popup.js` | 输入框 `input` 事件驱动按钮 `disabled`；禁用态按钮 tooltip `先粘贴 JSON` |
| popup 非法 JSON | `popup.js` | 输入 300ms 防抖后调 `JSONBig.parse` 试解析；失败 → 输入框加警示描边 + 下方一行摘要（复用 `jsonbig.js` 的报错文案）。**popup 需引入 `jsonbig.js`**（当前未引入） |
| popup 超长 | `popup.js` | `value.length > 1_000_000` → 提示"将以大文件模式打开" |
| 建树加载态 | `status.js` | 见下方专节 —— **单层 rAF 不成立**（对抗审查纠正） |
| 空对象/空数组 | `tree.js` | `entries.length === 0` → 渲染 `{ }` + 说明行 `空对象 — 没有任何 key` / `空数组 — 没有任何元素` |
| 搜索无结果 | `search.js` | `matches.length === 0` → 不加 `jk-dim`（避免"全暗像坏了"），改为在树区顶部插入无结果条 + 计数显示 `0/0` |
| 大文件降级 | `status.js` | 现有 `— large file, tree built on demand` 文案后追加可点击的 `构建树` 按钮 |

### 建树加载态的正确做法（对抗审查纠正）

**原方案错误**: "插骨架 → `requestAnimationFrame(buildTree)` 让骨架先绘制一帧"。**这是错的** —— rAF 回调执行在浏览器 "update the rendering" 步骤里、**在本帧的 style/layout/paint 之前**。真实时序: 骨架 DOM 进树但未绘制 → 下一帧 rAF 回调触发 → 同步建树阻塞主线程数秒 → 回调返回 → 浏览器才 paint，**一次性画出成品树**。骨架从头到尾一帧都不会出现。

失败场景: 20MB JSON → 点"构建树" → 页面冻结数秒后直接出树，全程零反馈 → **F-008 / AC-007 不通过，但会被误判为已实现**（代码里确实有 rAF）。

**采纳的做法**:

| 阶段 | 做法 |
| --- | --- |
| 本 feature（最小正确） | **双层 rAF**（`rAF(() => rAF(build))`）或 `rAF(() => setTimeout(build, 0))` —— 让第一帧的 paint 先完成，骨架真的出现。**主线程仍会阻塞**，这是诚实的局限，不假装解决 |
| feature 5 落地后（真进度） | **分片建树** —— feature 5 的 T-506 会把 `buildTree` 拆出扁平的 `buildModel`，届时按帧 yield 分批建模，才能给出真实进度条。**两处不各做一套** |

**本版明确不覆盖的一条路径（不是漏了）**：大文件停在 Raw 时**打字搜索**，`search.run` 走的是同步的 `ctx.renderTree()` —— 直接冻结、**零骨架**。而 F-008 的措辞是"大文件切 Pretty 时有进度或骨架反馈"，搜索**确实会切到 Pretty**（`ensurePretty`），所以严格读**这条路径不满足 F-008**。

不在本版解决的理由：给它加骨架要让 `search.run` 变成异步，涟漪进 search/core/三个测试文件，而**双层 rAF 并不能消除阻塞** —— 真正的解药是 T-506 的分片建树，届时这条路径与 Pretty 路径共用同一套分批机制。**现在做等于先写一套要被拆掉的异步语义。** 随 T-506 一并解决。

原方案的技术决策表用"Worker 无法操作 DOM"否掉方案①是在错误的轴上比较 —— 真正的对照项是分片建树，而它当时不在选项里。

### 模块 4: 三界面视觉（F-001/F-002/F-012）

- **token**: 沿用 `viewer.css` 现有 CSS 自定义属性体系（浅色 `:root` + `@media (prefers-color-scheme: dark)` + `[data-jk-theme]` 强制覆盖 + `[data-jk-skin]` 语法重着色）。重做只改值与结构，**不改这套四层机制** —— 手动主题与四套配色依赖它。
- **popup 328px**: `body { width: 328px }`（现状已是），重做不得改动；验收实测。
- **viewer 页粘贴区**: `viewer.html` 顶部 textarea + `Format` 按钮 + `⌘/Ctrl+Enter`（现状已有，本次仅重做视觉并补空态）。
- **字体**: 系统栈 `system-ui` + `ui-monospace`。**禁止**引入设计稿使用的 Inter / JetBrains Mono 远程字体。

## 接口契约

### 组件契约（模块间）

> 以下契约按上表的闭包变量归属推导得出，**不是照"应该有哪些模块"臆造的**。后续 feature（2–5）全部挂在这套契约上，故此处的缺口会被放大四次 —— 对抗审查已据此修正三处。

### ⚠ tree 必须是实例，不是模块级单例（对抗审查采纳 · 最深的一处修正）

**原契约错在哪**: `JK.tree.build(value, mountEl)` 返回数据、`JK.tree.jumpTo(apath)` 是模块级函数 —— 全程没有 tree 实例参数。但这个产品**同时存在多棵树**:

| 谁 | 树 | 来自 |
| --- | --- | --- |
| 主视图 | 1 棵 | 现状 |
| 结果树（JSONPath matches） | +1 棵 | feature 2 |
| 嵌套子树面板（表格 `{…}` 点开） | +1 棵 | feature 2 |
| **Diff 左右分栏** | **+2 棵** | feature 4 |

**失败场景**: Diff 面板打开后按 `/` 搜索，或从表格点单元格 `jumpTo` → 实现只能持有"最后一次 build 的那棵树"的引用 → 跳转打到 Diff 的右树上，主视图纹丝不动；feature 3 的 `markInvalid` 同理标错树。

**修正**: `build()` 返回**实例句柄**，所有操作挂实例上。**这条必须在本 feature 落地** —— 等 feature 4/5 再补，就是把 1/2/3 的契约全部推翻重来。

```js
const tree = JK.tree.build(value, mountEl, { basePath: "", onCrumb });
tree.rows / tree.topLevel / tree.counts / tree.nodes / tree.hasContainers
tree.expandAll() / tree.collapseAll()
tree.jumpTo(apath)            // 实例方法，不是 JK.tree.jumpTo
tree.markInvalid(apath[]) / tree.clearInvalid()   // feature 3 用
tree.scrollToIndex(i)         // feature 5 虚拟滚动接管此处
tree.destroy()
```
`JK.tree` 模块本身只保留无状态工具: `JK.tree.childAccessor(...)`、`JK.tree.valueHTML(...)`。

| 组件 | 入参 | 事件/返回 |
| --- | --- | --- |
| `JK.util.*` | — | `esc` / `escAttr` / `humanSize` / `isContainer` / `idKey` / `store` / `normalize` / **`isIntegerLike`** |
| `JK.tree.build(value, mountEl, opts)` | `opts`: `{ basePath = "", onCrumb(path) }` | **返回实例句柄**（见上） |
| `JK.toolbar.mount(rootEl, ctx)` | `ctx`: `{ onView, onSort, onTheme, onSkin, onCopy, onDownload }` | 返回 `{ setView(v), setFlash(t), setMeta(text), setChip(html), addMenuItem(item) }` |
| `JK.search.mount(rootEl, ctx)` | `ctx`: `{ scrollEl, renderTree, setView, getTree }` —— **`getTree()` 返回当前活动树实例**，不是固定引用 | 返回 `{ run(q), next(), prev() }` |
| `JK.rail.mount(railEl, ctx)` | `ctx`: `{ scrollEl, getTree }` | 自动隐藏条件：无嵌套 或 顶层项 < 3（与现状一致） |
| `JK.status.mount(statusEl)` | — | 返回 `{ render(state) }` |

**"活动树"的定义**（避免 Diff/面板争用）: `core.js` 持有 `activeTree` 指针；打开 Diff/子树面板时**不改变** `activeTree`（面板内的树自带局部搜索或不支持搜索），关闭面板不需恢复。搜索与 rail 只作用于 `activeTree`。

**`toolbar` 必须有数据入口**（对抗审查采纳）: 原契约全是回调、零数据字段，而工具栏右侧要渲染 `humanSize(rawText.length)`、`topInfo`、`chipHTML` —— 三者无处传入，`✓ N big-ints exact` 徽章将没有渲染入口（AC-009 不通过），实现者只能绕过契约直接操作 toolbar 的 DOM，拆分即失去意义。故加 `setMeta` / `setChip`。

**`status.render(state)` 的 state**（补 `size`，对抗审查采纳）:
```js
{ valid, dupes[], nodes, counts, heavy, size, loading, empty }
```
`size` 不可省 —— heavy 分支文案是 `humanSize(rawText.length) + " — large file, tree built on demand"`，缺它则大文件状态栏的 `1.2 MB` 前缀渲染不出来。**`bigInts` 不在 state 里** —— 徽章在工具栏（`core.js:202`），不在状态栏。

**工具菜单项契约**（后续 feature 挂载新功能的唯一入口）:
```js
const item = JK.toolbar.addMenuItem({ id, label, onClick, group });
item.setLabel("⤡ Expand all");   // Collapse all 要在两个标签间切换（core.js:296）
item.setVisible(false);           // 无容器节点时整项隐藏（core.js:260）
```
`setLabel`/`setVisible` 不可省 —— 否则喂 `{"a":1,"b":2}`（纯标量顶层）时，菜单里会留一条点了没反应的 Collapse all。

### tree.jumpTo(apath) —— 必须抄 runSearch，不要抄 rail

**对抗审查的核心发现**: `rail.js` 的 `scrollEl.scrollTop = t.head.offsetTop - 6`（`core.js:237`）能工作，**只因为它的目标永远是顶层节点，而顶层节点永远不会被折叠隐藏**。`jumpTo` 的目标是任意深度节点，直接抄它有四条失败路径。正确的先例是同文件里的 `runSearch`（`core.js:347-352`）。

**必须的步骤**（缺一不可）:
```
jumpTo(apath):
  1. renderTree()                      // 树是懒构建的（treeBuilt, core.js:226）；
                                       // Table 视图与 >1MB 文件下压根没建过（core.js:366）
  2. setView("pretty")                 // 不在树视图时先切回
  3. 展开 apath 的祖先链               // 折叠行 display:none → offsetTop 为 0 → 会滚到页顶
  4. scrollEl.scrollTop = row.offsetTop - clientHeight/2
  5. row.classList.add("jk-hit")       // 900ms 后移除
```

**配套的三处修正**（不做则 jumpTo 与 AC-207 无法实现）:

1. **容器根行必须补 `apath = ""`**。现状 `row(0, '<span…>{ </span>…', "root")` 只传 3 个参数（`core.js:127`）→ `apath === undefined` → `if (apath !== undefined)`（`core.js:75`）不成立 → **根行没有 `_apath`**。而标量根行传了 `""`（`core.js:134`）。不补则 feature 3 的 AC-207（"校验 `{"a":1}` 缺失 `b` → root 标红"）**无法实现** —— 树里找不到任何 `_apath === ""` 的行。
2. **`rows` 索引提到模块态**。现状 `rows` 是 `buildTree` 的闭包局部变量（`core.js:57`），而 `jumpTo` 是模块级函数。且 `⇅ Sort` 会 `treeBuilt = false` 并重建整棵树（`core.js:319`）→ 索引必须在重建时失效重算。
3. **`basePath` 注入**。见下。

### basePath —— 结果树的路径基址

feature 2 要把 JSONPath 的 matches 数组喂给 `build()` 渲染"结果树"。但现状 apath 一律从空基址现推（`childAccessor("", k, arr)`，`core.js:130`）。

**失败场景**（就是 feature 2 的 AC-101 输入）: `{"users":[{"email":"a@b.c"},{"email":"d@e.f"}]}` 查 `$.users[*].email` → 结果树行的 `_apath` 被重算成 `[0]`/`[1]`，而非 `users[0].email` → ① 点 `path` 复制出错误路径；② `jumpTo("[0]")` 在完整树里**匹配到根数组的第 0 项**（若根是数组，`[0]` 合法且存在）→ 跳到完全无关的节点。

故 `build(value, mountEl, { basePath })`，由调用方注入每个 match 的真实基址。

### 路径字段命名统一（三个 feature 的共享契约）

feature 2 的 `evalPath` 返回 `apath`、feature 3 的 `validate` 返回 `apath`、feature 3 的 `infer` 返回 `path` —— **三处两名，格式全文未定义**。统一约定：

- **一律叫 `apath`**，格式 = `childAccessor` 产出（`a.b` / `a["x-y"]` / `a[0]`），根为 `""`。
- `childAccessor` 与 apath→row 反查一并沉到 `JK.tree`，**feature 2/3 从这里取，不各造一套**。
- `JK.util.isIntegerLike(v)` = `typeof v === "bigint" || Number.isInteger(v)` —— feature 2/3 的类型判定共用（理由见 feature 3 design）。

### 外部契约（不得变更）

- `window.JK.mountViewer(rootEl, rawText, opts) → boolean`（`false` = 解析失败，调用方不得替换页面）
- `window.JK.normalize(text) → string`
- storage key: `jk:pending` / `jk:view` / `jk:theme` / `jk:sort` / `jk:skin`

## 数据模型

无数据库。持久化仅 `chrome.storage.local`，键名一律 `jk:` 前缀。本 feature 不新增键。

## 安全考虑

- **XSS（头号风险）**: 树/状态栏/搜索均把不可信 JSON 拼进 `innerHTML`。拆分后每个模块必须从 `JK.util` 引 `esc`/`escAttr`，**不得各自重写**。新增的空态/错误态文案若含用户数据（如错误摘要含原文片段）必须 `esc()`。
- **宿主页完整性**: `content.js` 的"先解析成功再替换页面"不得松动；`mountViewer` 失败仍须返回 `false`。
- **前缀隔离**: 新增 CSS 类一律 `jk-` 前缀 —— content script 注入任意页面，前缀是唯一防冲突手段。
- **零网络**: 重做不得引入 CDN、远程字体、远程脚本。设计稿的 Tailwind/Google Fonts 依赖必须在还原时剔除。
- **无遥测**: 禁止 `console.log(用户 JSON)` 留在提交里。

## 技术决策

| 决策 | 选项 | 理由 |
| ---- | ---- | ---- |
| core.js 拆分 | ① 不拆，继续加 ② 拆为 7 个模块 | **选 ②**。373/400 行已触顶，4 个后续 feature 必破线。拆分是后续所有 feature 的前置 |
| 模块机制 | ① ES module ② IIFE + window.JK | **选 ②**。content script 不便 ES import；零构建是商店审核与信任叙事的一部分（`coding-style.md` 硬约束） |
| 工具栏 IA | ① 全部平铺 ② 命令面板 ⌘K ③ 三段式 + 溢出菜单 | **选 ③**。① 已证明排不下；② 对"偶尔打开一个 JSON"的用户过重，且发现性差；③ 高频可见、低频收纳，且给后续 feature 一个明确挂载点 |
| 表格视图归属 | ① 第四视图分段 ② 正交维度 | **选 ①**（设计稿已如此实现）。代价：Table 仅对数组有意义 → 非数组时该分段置灰 + tooltip 说明（feature 2 实现 F-106） |
| 加载态实现 | ① Web Worker ② 单层 rAF ③ 双层 rAF（本版）+ 分片建树（feature 5） | **选 ③**。② 是错的 —— rAF 回调在本帧 paint 之前，骨架一帧都不会出现（对抗审查纠正）；① 无法操作 DOM 且建树产物是 DOM；真正的对照项是分片建树，但它依赖 feature 5 的扁平模型，故本版先用双层 rAF 让骨架可见，**不假装解决阻塞** |
| 字体 | ① 内嵌 Inter/JetBrains Mono（base64） ② 系统栈 | **选 ②**。内嵌字体使扩展包膨胀数百 KB，且与"轻量本地工具"定位冲突；系统栈零成本 |

## 风险点

- **拆分是高危改动，但失败模式与直觉相反**（对抗审查纠正）: 原以为"加载顺序错 → `window.JK` 未定义 → 静默失效不报错"。**这只在 `core.js` 整个没加载时成立**。子模块缺失/顺序错的真实表现是 `mountViewer` 内抛未捕获异常（`content.js` 调用处没有 try），控制台**有**红色报错；且 `body.textContent = ""` 在 `ok` 判断之后，宿主页不会被误伤。**防护网必须照真实失败模式建，不要照错误假设建。**
- **整对象赋值是最可能的翻车点**: 见"命名空间合并约定"。`global.JK = {...}` 会让 `content.js` 的 `!window.JK` 守卫通过、随后 `JK.tree.build` 抛 TypeError。
- **契约缺口会被放大四次**: feature 2–5 全挂在本 feature 的契约上。对抗审查已修正三处（toolbar 无数据入口、status 缺 size、tree 缺 basePath/jumpTo 语义）。**T-003 之前必须先完成"闭包变量归属"表的核对**，否则会在"保持契约不变"与"保持行为不变"之间被迫二选一。
- **无测试资产**: 项目当前零自动化测试（`.claude/rules/testing.md`），拆分无回归网兜底 → T-001 必须先建。
