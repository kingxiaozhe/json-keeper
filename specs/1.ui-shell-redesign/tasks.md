# UI Shell 重做 — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始任务 |

## 项目信息

- 项目名: json-keeper
- 架构类型: 单体前端应用（Chrome MV3 扩展 · 零依赖 · 无构建）
- specs 路径: `specs/1.ui-shell-redesign/`

## 任务列表

### 防护网基线（B3 · 必须最先完成）

- [x] T-001: 建立现状快照测试锁住将被修改模块的当前行为 ~1h（实际 ~1h30，含对抗审查后的返工）
  - 项目**无测试资产**（`.claude/rules/testing.md`），故须新建：`node --test tests/`，Node 内置 `node:test` + `node:assert`，零依赖。
  - 锁住 `jsonbig.js`: 大整数保真、重复 key 诊断、JSONC/尾逗号容错、错误 position。
  - 锁住 `core.js` 的 `normalize()`: XSSI 前缀剥离、JSONP 解包。
  - 锁住 `esc`/`escAttr` 的转义行为（含属性上下文的引号中和）。
  - **只锁现状，不判断对错**。开发后复跑，变红即碰坏老行为。
  - DOM 层无法单测 → 以 `.claude/rules/testing.md` 的 10 条手动冒烟清单兜底，本 feature 每个任务完成后至少跑对应项。

### 功能 1: core.js 模块拆分（F-013）

- [ ] T-002: 拆出 `util.js`（含 **`normalize`**）与 `tree.js`，更新 `manifest.json` / `viewer.html` 加载顺序 ~1h
  - 涉及模块: `core.js`、`util.js`(新)、`tree.js`(新)、`manifest.json`、`viewer.html`
  - **必须用命名空间合并写法** `var JK = (global.JK = global.JK || {})`，**禁止** `global.JK = {...}` 整对象赋值 —— 现状 `core.js:372` 正是整对象赋值，照搬会把先加载的子模块整体覆盖，导致 `JK.tree.build` 抛 TypeError、接管 100% 失效。
  - `normalize` 归 `util.js`（纯字符串函数，`content.js` 与 popup 都要用），**不留在编排层**。
  - `tree.js` 同步补两处（jumpTo 与 feature 2/3 的前置）：**容器根行补 `apath = ""`**（现状 `core.js:127` 只传 3 参 → 根行无 `_apath`）；`build` 增加 `{ basePath, onCrumb }` 入参。
  - `util.js` 新增 `isIntegerLike(v)`（feature 2/3 类型判定共用）。
  - 完成后复跑 T-001 基线 + 冒烟清单第 1/2/3/7 项（接管 / 不误伤普通页 / 大整数保真 / **XSSI+JSONP 容错**）。
- [ ] T-003: 核对闭包变量归属 → 拆出 `toolbar.js` / `search.js` / `rail.js` / `status.js`，`core.js` 收敛为编排层 ~1h30
  - 涉及模块: `core.js`、上述 4 个新文件、`manifest.json`、`viewer.html`
  - **动手前先核对 design.md 的「mountViewer 闭包变量归属」表** —— 逐个确认 `_collapse`/`carets`/`scrollEl`/`crumbEl`/`displayValue`/`diag` 的去处。跳过这步会在"保持契约不变"与"保持行为不变"之间被迫二选一。
  - `tree.build` 的返回值必须导出 `expandAll`/`collapseAll`/`hasContainers`/`rows` —— 搜索的自动展开（`core.js:352`）与 Collapse all 的标签切换/自动隐藏（`core.js:296`/`260`）都依赖它们，缺了即行为退化。
  - 面包屑元素由 `core.js` 持有，tree 经 `onCrumb` 回传路径（面包屑由行点击驱动，不是 rail 的产物）。
  - 保持 `mountViewer` / `normalize` 对外契约不变（`content.js` 依赖返回值 `false` 不替换页面）。
  - 验证 `wc -l *.js` 无文件 > 400 行。
- [ ] T-003b: 实现 `JK.tree.jumpTo(apath)` + apath→row 反查 + 重建失效 ~1h
  - 涉及模块: `tree.js`、`core.js`
  - **抄 `runSearch`（`core.js:347-352`）的做法，不要抄 `rail.js`** —— rail 的 `offsetTop` 定位只对永不隐藏的顶层节点成立。
  - 必须五步齐全: `renderTree()` → `setView("pretty")` → **展开祖先链** → 滚动 → `jk-hit` 高亮。
  - `rows` 索引提到模块态，`⇅ Sort` 重建树时（`core.js:319`）必须失效重算。
  - 本任务是 feature 2 的 F-105 与 feature 3 的 AC-207 的前置 —— 缺它两者都做不出来。

### 功能 2: 工具栏信息架构（F-003/F-004）

- [ ] T-004: 实现三段式工具栏 + `⋯` 溢出菜单 + `addMenuItem` 契约 ~1h
  - 涉及模块: `toolbar.js`、`viewer.css`
  - Collapse all / Sort / Download / 主题 / 配色 收进菜单；Copy JSON、视图分段器、搜索框、元信息+信任徽章常驻。
  - 信任徽章 `✓ N big-ints exact` 常驻右侧，不得进菜单。

### 功能 3: 三界面视觉重做（F-001/F-002/F-012）

- [ ] T-005: 重构 `viewer.css` token 与组件样式（浅/深双主题 + 四套语法配色机制保持不变）~1h
  - 涉及模块: `viewer.css`
  - 基准: `specs/docs/design-baseline/`（**结构基准** — 元素与层级对齐，视觉可再设计）。
  - **必须剔除设计稿的 Tailwind CDN 与 Google Fonts 依赖**，翻译为原生 CSS + 系统字体栈。
  - 新增类一律 `jk-` 前缀。
- [ ] T-006: 重做接管页/viewer 页的树、结构栏、面包屑、状态栏视觉 ~1h
  - 涉及模块: `tree.js`、`rail.js`、`status.js`、`viewer.css`
  - 结构栏自动隐藏条件不变（无嵌套 或 顶层项 < 3）。
- [ ] T-007: 重做 popup（328px）+ viewer 页粘贴区 ~30min
  - 涉及模块: `popup.html`、`popup.js`、`viewer.html`、`viewer.js`、`viewer.css`
  - popup 宽度严格 328px；viewer 页保留 `⌘/Ctrl+Enter` 渲染。

### 功能 4: 缺失态补齐（F-005~F-011）

- [ ] T-008: popup 三态 — 空输入禁用、非法 JSON 就地报错、超长提示 ~30min
  - 涉及模块: `popup.html`、`popup.js`、`manifest.json`
  - **popup 需新引入 `jsonbig.js`** 以就地试解析（现状未引入）—— 这是本任务的主要结构改动。
- [ ] T-009: 树的空态（空对象/空数组）+ 搜索无结果态 ~30min
  - 涉及模块: `tree.js`、`search.js`、`viewer.css`
  - 无结果时**不再给全部行加 `jk-dim`**，改为顶部无结果条 + 计数 `0/0`。
- [ ] T-010: 大文件降级说明 + "构建树"入口 + 建树加载态 ~30min
  - 涉及模块: `status.js`、`core.js`、`viewer.css`
  - 用 `requestAnimationFrame` 让骨架先绘制一帧再同步建树。

### 集成与测试

- [ ] T-011: 三界面 × 深浅两版逐页元素清单核对（结构基准验收）~30min
  - 对照 `design-baseline/` 与 requirements.md 的 AC-001，逐元素核对。
- [ ] T-012: 全量手动冒烟清单 + 复跑 T-001 防护网基线 ~30min
  - `.claude/rules/testing.md` 10 条全跑，含 XSS 项（AC-011）与不误伤普通页（AC-012）。
  - 基线变红 = 碰坏老行为，必须修复后才算完成。

> **无 T-012 部署任务**：本项目为纯本地 Chrome 扩展，无 Dockerfile / CI / 部署脚本，无 staging 形态。发布走手动打包上传 Web Store，不纳入任务单。

## 依赖关系

- T-002 依赖 T-001（防护网先行）
- T-003 依赖 T-002（拆分分两步，先 util/tree 再其余）
- T-004、T-005 依赖 T-003（模块边界确定后才动工具栏与样式）
- T-006 依赖 T-005（token 先行）
- T-007 依赖 T-005
- T-008 依赖 T-007（popup 视觉定稿后再加状态）
- T-009、T-010 依赖 T-006
- T-011 依赖 T-006、T-007、T-008、T-009、T-010
- T-012 依赖 T-011

## 风险点

- **拆分静默失效**: 加载顺序错 → `window.JK` 未定义 → `content.js` 安静 return，页面不接管且**无任何报错**。T-001 基线与冒烟第 1 项是唯一防线。
- **设计稿不可直接用**: 稿件依赖 Tailwind CDN + Google Fonts，与零网络红线冲突且 MV3 CSP 会拦。T-005 的实际工作量是"翻译"而非"复制"，预估 1h 可能偏乐观。
- **基准自带缺陷**: 三张稿全深色、popup 尺寸错、viewer 页无粘贴区 —— 已定为结构基准，不还原这些缺陷；但执行时容易被稿件带偏，T-011 核对以 requirements.md 的 AC 为准，稿件为辅。
- **无测试资产**: 本 feature 从零建测试骨架，T-001 的 1h 预估含框架搭建，可能偏乐观。
