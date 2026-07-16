# 修复模式与虚拟滚动 — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始任务 |

## 项目信息

- 项目名: json-keeper
- 架构类型: 单体前端应用（Chrome MV3 扩展 · 零依赖 · 无构建）
- specs 路径: `specs/5.repair-mode-and-virtual-scroll/`

## 任务列表

> **无 UI 还原任务**：本组功能无设计稿（人工确认），UI 由前端按 design.md 自行实现，须遵循 feature 1 的 token 与组件样式。

### 防护网基线（B3 · 本 feature 尤其关键）

- [ ] T-501: 复跑并加固防护网基线 —— 本 feature 要动 `jsonbig.js` 与 `tree.js` ~30min
  - 复用 `1.ui-shell-redesign` T-001 的 `node --test tests/` 骨架，**不重造**。
  - **加固锁定**：`jsonbig.js` 的 `err()` **message 文案原样**（本 feature 只许加字段，不许改文案）。
  - 加固锁定：`rail.js` 跳转、`search.js` 命中计数与跳转、hover 复制的 `apath` 产出 —— 虚拟滚动会打破它们的前提。
  - 涉及模块: `tests/`

### 功能 1: 错误行列定位（F-401）

- [ ] T-502: `jsonbig.js` 新增 `posToLineCol` 纯函数 + `err()` 挂 `position`/`line`/`col` ~30min
  - 涉及模块: `jsonbig.js`、`tests/`
  - **最小改动**：不碰解析主流程，`message` 文案不得变更（T-501 已锁）。
  - 单测：多行 JSON 报错位置的行列换算正确（含首行、末行、\n 边界）。
- [ ] T-503: 错误面板 — 原文视图（行号 + 出错行高亮 + 列插入符）+ 错误摘要 ~1h
  - 涉及模块: `errorview.js`(新)、`panel.js`（复用 feature 3）、`viewer.css`、`core.js`
  - **仅 viewer 页与 popup 出现；接管页解析失败仍必须不动宿主页**（`content.js` 安全约束）。
  - **原文是任意坏文本 —— 本项目最直接的注入面**，必须 `esc()`；逐字符高亮时勿在转义后拼未转义片段（AC-413）。

### 功能 2: 修复建议与预览（F-402/F-403）

- [ ] T-504: 实现 `repair.js` — 三条规则（单引号 / 无引号 key / 被截断）+ 候选产出 ~1h
  - 涉及模块: `repair.js`(新)、`manifest.json`、`viewer.html`、`tests/`
  - **不实现尾逗号修复**：`jsonbig.js` v0.7 起已容错，走不到修复模式，实现即死代码。
  - **单引号规则必须保守**：只作用于字符串外层引号；`{'a':"it's"}` 里的撇号不得被动 —— 改坏数据比不修更糟，宁可不给建议。
  - **只产出候选，绝不自动应用**。
  - 单测覆盖三条规则 + 保守性反例（撇号不被误换）。
- [ ] T-505: 修复预览 UI + 确认后应用 + 重新解析验证 ~1h
  - 涉及模块: `errorview.js`、`repair.js`、`viewer.css`
  - 差异用**文本级**对比（修复前的文本解析不了，`jsondiff.js` 用不上 —— 见 design.md 技术决策）。
  - **未确认前输入框原文不变**（AC-406）；确认后灌回并**重新走完整解析**，不信任修复器的自我声明（AC-412）。

### 功能 3: 虚拟滚动（F-404/F-405）

- [ ] T-506: `tree.js` 拆出 `buildModel(value)` → 扁平行数组（含 lineNo / apath / visible）~1h
  - 涉及模块: `tree.js`、`tests/`
  - **lineNo 在建模时一次算定** → F-405 行号连续性天然成立（AC-409）。
  - 保持 `buildTree` 对外行为不变（此步只重构，不启用虚拟渲染）。复跑 T-501 基线确认无回归。
- [ ] T-507: 实现 `vlist.js` — 窗口渲染 + padding 撑高 + `scrollToIndex` + 折叠走 `visible` ~1h
  - 涉及模块: `vlist.js`(新)、`viewer.css`、`manifest.json`、`viewer.html`
  - 固定行高，`index × ROW_H` 换算位置。
  - 折叠**不能再用 `display:none`**（行不在 DOM 里），改模型层 `visible` 标记 + 重算可见索引映射。
  - > 5000 行才启用；以下走全量渲染。
- [ ] T-508: 改造**七处**依赖（对抗审查把原本的"三处"补全）~2h30
  - 涉及模块: `rail.js`、`search.js`、`tree.js`、`toolbar.js`、`table.js`(f2)、`schema-validate.js` 相关的 `markInvalid`(f3)
  - **这是本 feature 的波及面核心，也是全轮 51 个任务里最危险的一个**：七处都依赖"所有行都在 DOM 里"。
  1. `rail.js` **跳转** → `tree.scrollToIndex(i)`
  2. `rail.js` **scroll-spy**（原方案漏了）→ 按模型索引区间判 active。**detached 元素 `offsetTop` 恒为 0** → 不改则结构栏永远高亮最后一个 key
  3. `search.js` 匹配 → 模型层 `rows[].text`（AC-410）
  4. hover 复制 / `jumpTo` → 从 `rows[i]` 取（AC-411）
  5. **Collapse all**（原方案漏了）→ `carets()` 查 DOM 会**只折叠当前窗口那 ~50 行**，再点变 Expand all 作用在另一批行上 → 树进入无法复位的混合态。改走模型 `visible`；`hasContainers` 从模型算
  6. **行级 class 状态**（原方案漏了）→ `jk-dim`/`jk-current`/`jk-hit` 必须由模型 flags **重放**，否则节点复用会把上一行的高亮带到无关行
  7. **feature 3 的 `markInvalid`**（原方案漏了）→ 同 #6 走模型 flags。波及面原写"不改动 schema-*.js"字面成立，但它的契约前提（行常驻 DOM）已废
  - > 工时由 1h 上调至 2h30。
- [ ] T-508b: 修复搜索复杂度与防抖（虚拟滚动救不了它）~1h
  - 涉及模块: `search.js`、`tree.js`
  - **现状是 O(n×m) 且无防抖**：`matches.includes(r)` 在循环里（`core.js:353`）+ `input` 直接触发（`core.js:359`）。10MB≈40 万行搜 `"e"` → **8×10¹⁰ 次比较，每敲一字符跑一次** → 标签页挂死。**跟行在不在 DOM 里无关，照搬原形状换数据源不换复杂度，AC-408/410 做不到。**
  - 改 `Set` 或模型行 `flags.match` 布尔位 → O(n)；`input` 加 150ms 防抖。
  - **搜索不再做全量展开** —— 只展开命中项的祖先链。原先 `_collapse(false)` 全量展开在模型层 = 40 万行 `visible` 全置 true → 每击键重算全量可见索引 + 容器高度跳到 ~8.6M px → 滚动位置乱跳。（顺带修好"清空搜索后折叠状态不恢复"的老毛病。）

### 集成与测试

- [ ] T-509: 大文件性能走查 ~30min
  - 10MB JSON 切 Pretty：可滚动、不卡死；DevTools 抽查帧率 ≥ 30fps（AC-408）。
  - 滚到第 10000 行：行号正确且连续（AC-409）。
  - 搜索跳转、结构栏跳转、hover 复制路径在虚拟滚动下全部正确（AC-410/411）。
- [ ] T-510: 复跑全部防护网基线 + 手动冒烟清单 ~30min
  - `node --test tests/` 全绿，**尤其 `jsonbig.js` 的 message 文案未变**（AC-414）。
  - 冒烟清单 10 条全跑；第 2 项（不误伤普通页）与第 8 项（大文件保护）必须重点验。

## 依赖关系

- **本 feature 依赖 `1.ui-shell-redesign`**（模块拆分后的 `tree.js`）；`5.功能2` 的预览**不依赖** feature 4 的 `jsondiff.js`（见 design.md）；错误面板复用 `3.schema-and-type-export` 的 `panel.js`
- T-502 依赖 T-501
- T-503 依赖 T-502
- T-504 依赖 T-502（需要 error 的 line/col 定位错误位置）
- T-505 依赖 T-504、T-503
- T-506 依赖 T-501
- T-507 依赖 T-506
- T-508 依赖 T-507
- T-508b 依赖 T-507
- T-509 依赖 T-508、T-508b
- T-510 依赖 T-505、T-509

## 风险点

- **虚拟滚动是本轮全部 5 个 feature 里最危险的改动**：它打破"所有行都在 DOM 里"的前提，而**七处**依赖该前提（对抗审查从原以为的三处补全到七处：rail 跳转、rail scroll-spy、search、hover 复制、Collapse all、行级 class 状态、feature 3 的 markInvalid）。即便上调到 2h30，T-508 仍可能超支。
- **`vlist` 装不下表格（跨 feature 缺口，待裁决）**：`JK.vlist.mount(el, rows, {rowHeight})` 吃的是**树的行模型**（`{depth, html, apath, crumb, val, lineNo, visible}`）—— 没有列模型、没有 sticky 表头、没有单元格 apath。feature 2 的"回来统一"在本 feature 的 T-501~T-510 里**没有任何任务承接**。落地结果：表格照旧卡在 1000 行，一个产品两套长列表策略并存。见摘要卡风险点。
- **动了 `jsonbig.js`**：全项目唯一的正确性核心资产。虽只加字段不动主流程，但 T-501 的基线必须在改前后各跑一次。
- **错误面板渲染任意坏文本**：比正常 JSON 更容易塞 HTML —— 本项目最直接的注入面。
- **单引号修复可能改坏数据**：字符串内撇号被误换，用户不易察觉。规则须保守到"宁可不给建议"。
- **与 feature 2 的长列表策略分叉**：feature 2 用"前 1000 行 + 提示"，本 feature 上虚拟滚动后需回来统一，否则一个产品两套策略。
