# 查询与表格视图 — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始设计 |

## 项目架构

- 架构类型: 单体前端应用（Chrome MV3 扩展）
- 涉及层: 内容脚本 · 扩展页面 · 样式层。无后端。

## 设计基准

- **档位: ② 结构基准**（人工确认）。
- 基准路径: `specs/docs/design-baseline/s3-table-diff-dark.{html,png}` —— 表格视图有稿：列头 `# / ID [BigInt] / Username / Email / Role / Is Active`、大整数橙色高亮、缺失值渲染为斜体 `null`、`Load More (96 remaining)`、视图分段器为 `Raw | Pretty | Table | Min`。
- **稿件缺陷**: 仅深色版；`Load More` 的分页交互 PRD 未定义（见风险点）；查询栏在稿中不存在 —— 查询栏 UI 无基准，按本文档实现。
- **稿件的 `null` 渲染有歧义**: 稿中缺失字段渲染为斜体 `null`，但 F-104 要求缺失与真 `null` 可区分。**以 requirements.md AC-104 为准**，稿件此处不还原。

## 波及面（B2）

| 改动目标 | 谁引用它 | 可能受影响的老功能 |
| --- | --- | --- |
| 视图分段器增加 `Table` | `toolbar.js`（feature 1 产出）；`store.set("jk:view", v)` 持久化 | **视图记忆**：老用户 storage 里存的 `jk:view` 为 `pretty`/`raw`/`min`；新增值须向后兼容，读到未知值回落 `pretty` |
| `core.js` 编排新增查询状态 | `content.js` 依赖 `mountViewer` 返回值 | 页面接管（返回 `false` 语义不得变） |
| 搜索框区域并入查询栏 | `search.js`（feature 1 产出） | **现有搜索**：`/` 聚焦、Enter 跳转、命中计数 —— 不得被查询栏挤掉 |
| `tree.js` 增加"跳转到节点"能力 | `rail.js` 已有类似滚动定位逻辑 | 结构栏跳转（复用同一套 `scrollTo + jk-hit` 高亮，勿重复造） |

**不改动**: `jsonbig.js`、`content.js`。

## 功能模块设计

### 模块 1: jsonpath.js（自研求值器）

**约束**: 零依赖 + 禁 `eval`/`new Function`（security.md 红线）。故手写词法/求值，不做表达式编译。

**支持的语法子集（首版）**:

| 语法 | 示例 | 说明 |
| --- | --- | --- |
| 根 | `$` | 必须以 `$` 开头 |
| 子属性 | `$.users` / `$['users']` | 点号与括号等价 |
| 递归下降 | `$..email` | 深度优先搜集 |
| 通配 | `$.users[*]` / `$.*` | |
| 索引 | `$.users[0]` / `$.users[-1]` | 负索引从尾部 |
| 切片 | `$.users[0:3]` | `[start:end]` |
| 多选 | `$.users[0,2]` | |

**不支持（首版）**: filter 表达式 `?(@.age>18)`、脚本表达式 `()`。理由: filter 需要一个安全的表达式求值器（不能用 `eval`），是独立的一大块工作；PRD 未把它列为必须。查询栏遇到 `?(` 时给出明确提示"暂不支持 filter 表达式"，而非报语法错误。

**契约**:
```js
JK.jsonpath.parse(expr)            // → {ok:true, ast} | {ok:false, error:{msg, pos}}
JK.jsonpath.evalPath(ast, value)   // → [{path:"$.users[0].email", apath:"users[0].email", value:...}, ...]
```
- 返回的 `apath` 复用 `tree.js` 的 `childAccessor` 格式，供 F-105 跳转与"复制路径"共用。
- **大整数安全**: 求值全程传引用，不做任何数值转换 —— `BigInt` 必须原样穿过。

### 模块 2: 查询栏 UI（F-101/F-102/F-103）

- 位置: 工具栏的"查询/搜索"区，与现有搜索框**并列而非替换**（两者语义不同：搜索 = 全文高亮，查询 = 结构化筛选）。
- 交互: 输入 + Enter 求值（**不做输入即查** —— JSONPath 求值成本高于字符串 includes，且半截表达式必然语法错，逐字符报错是噪音）。
- 结果态: 主视图替换为"结果树"（复用 `tree.js` 渲染 matches 数组），工具栏显示 `N matches` + `✕ 清除`。
- 错误态（F-103）: 查询栏下方一行错误摘要 + 错误位置指示；**保留上一次成功结果**（`lastResult` 不清空）。

### 模块 3: table.js（F-104~F-107）

**可用性判定（F-106）**:
```
可表格化 = Array.isArray(value) && value.length > 0 && value.every(v => v 是普通对象)
```
不满足 → `Table` 分段 `disabled` + tooltip 说明具体原因（非数组 / 空数组 / 元素不是对象）。

**列生成**: 各元素 key 的**并集**，保持首次出现顺序（不排序 —— 与现有 `⇅ Sort` 解耦，排序由用户显式触发）。

**缺失 vs null（F-104，核心正确性点）**:

| 情况 | 渲染 |
| --- | --- |
| `"b" in row === false` | 空单元格 + 弱色 `—` + tooltip `该记录没有 b 字段` |
| `row.b === null` | `null`，使用 `--jk-null` 语法色（与树视图一致） |

这是本 feature 的护城河延伸：**别家表格把两者都渲染成空白**，用户会误判接口行为。

**嵌套（F-107）**: 值为对象/数组 → 单元格显示 `{…}` / `[N]`，点击弹出子树面板（复用 `tree.js`）。**不拍平成列**（人工确认）。

**大整数**: 单元格内 `bigint` 沿用 `valueHTML` 的 `jk-precise` 高亮与 tooltip。

**行数**: > 1000 行时只渲染前 1000 + 底部 `还有 N 条` 提示。**首版不做分页/无限滚动** —— 稿件的 `Load More` 交互 PRD 未定义，且虚拟滚动是 feature 5 的范围，避免两处各做一套。

### 模块 4: 表格 ↔ 树互跳（F-105）

- 表格单元格 → 记录其 `apath` → 调 `tree.jumpTo(apath)`（**feature 1 的 T-003b 提供的实例方法**）。
- **⚠ 不要抄 `rail.js`**（对抗审查纠正）: 原方案说"复用 `rail.js` 的 `scrollEl.scrollTop = t.head.offsetTop - 6`"。那段能工作**只因为它的目标永远是顶层节点、永远不会被折叠隐藏**。`jumpTo` 的目标是任意深度节点，直接抄有四条失败路径（折叠行 `offsetTop` 为 0、树是懒构建的、`rows` 是闭包局部变量、Sort 会重建树）。正确的先例是 `runSearch`。详见 feature 1 design.md 的「tree.jumpTo」专节。

### 结果树的 basePath（F-101 的隐藏前提）

**失败场景**（就是 AC-101 的输入）: `{"users":[{"email":"a@b.c"},{"email":"d@e.f"}]}` 查 `$.users[*].email` → 把 2 个 match 当数组喂给 `build()` → apath 从空基址现推（`childAccessor("", k, arr)`，`core.js:130`）→ 结果树行的 `_apath` 变成 `[0]`/`[1]`，而不是 `users[0].email` → ① 点 `path` 复制出**错误路径**；② `jumpTo("[0]")` 在完整树里**匹配到根数组的第 0 项**（若根是数组，`[0]` 合法且存在）→ **跳到完全无关的节点**。

**修正**: 每个 match 用自己的 `apath` 作 `basePath` 单独 build，或结果树按 match 分组渲染并注入基址 —— `JK.tree.build(value, mountEl, { basePath })`（feature 1 已按此修正契约）。

## 接口契约

| 组件 | 入参 | 返回/事件 |
| --- | --- | --- |
| `JK.jsonpath.parse(expr)` | 表达式字符串 | `{ok, ast}` / `{ok:false, error:{msg,pos}}` |
| `JK.jsonpath.evalPath(ast, value)` | ast + 解析后的值 | `[{path, apath, value}]` |
| `JK.table.canRender(value)` | 值 | `{ok:true}` / `{ok:false, reason:"非数组"\|"空数组"\|"元素非对象"}` |
| `JK.table.mount(el, arr, ctx)` | `ctx: {onJump(apath)}` | `{destroy()}` |
| `JK.tree.jumpTo(apath)` | 访问路径 | 滚动定位 + 高亮；找不到返回 `false` |
| `JK.query.mount(el, ctx)` | `ctx: {getValue, onResult, onClear}` | `{run(expr), clear()}` |

**工具栏挂载**: 查询栏走 feature 1 的一级区（理由: 高频，且与搜索同区语义相邻）；`Table` 走视图分段器（feature 1 已预留）。**不走溢出菜单** —— 依 feature 1 的扩展约定，此处说明理由。

## 数据模型

新增 storage 键: 无。查询表达式**不持久化**（含用户数据，且 `jk:view` 记忆到 `table` 已足够）。

## 安全考虑

- **禁 eval**: JSONPath 求值器手写递归，禁止 `eval`/`new Function`/`with`。AC-108 用 grep 验证。
- **XSS**: 表格单元格、列头（**列头来自用户 JSON 的 key，同样不可信**）、查询错误摘要一律 `esc()`；tooltip 走 `escAttr()`。
- **大整数保真**: 求值与表格渲染全程不得触碰 `Number()` / `parseInt` / `JSON.parse`。
- **零网络**: 无新增外部资源。

## 技术决策

| 决策 | 选项 | 理由 |
| ---- | ---- | ---- |
| 查询语法 | ① JSONPath ② jq ③ 两者可切 | **选 ①**（人工确认）。零依赖下需自研引擎，jq 的工作量数倍于 JSONPath，且学习成本高 |
| filter 表达式 `?()` | ① 首版支持 ② 首版不支持 | **选 ②**。安全实现 filter 需要自研表达式求值器（禁 eval），是独立大块工作；遇到时给明确"暂不支持"提示而非语法错 |
| 查询触发 | ① 输入即查 ② Enter 触发 | **选 ②**。求值成本高于字符串搜索；半截表达式必然语法错，逐字符报错是噪音 |
| 查询栏与搜索框 | ① 合并为一个框 ② 并列两个 | **选 ②**。语义不同（全文高亮 vs 结构化筛选），合并会让 `/` 聚焦与命中跳转的老心智失效 |
| 嵌套对象 | ① `{…}` 可点开 ② 拍平成列 ③ 可切换 | **选 ①**（人工确认）。深嵌套拍平会爆出几十列，异构数组更甚 |
| 表格行数上限 | ① 分页 ② 虚拟滚动 ③ 前 1000 + 提示 | **选 ③**。虚拟滚动是 feature 5 范围，两处各做一套必然分叉；首版先给诚实的截断提示 |
| 列顺序 | ① 字母序 ② 首次出现顺序 | **选 ②**。与现有 `⇅ Sort` 解耦 —— 排序应由用户显式触发，而非表格偷偷改变数据呈现顺序 |

## 风险点

- **JSONPath 自研引擎的正确性**: 这是新的解析器，与 `jsonbig.js` 同属"正确性"资产。切片/负索引/递归下降的边界容易错 —— 必须有单测覆盖，不能只靠手测。
- **稿件的 `Load More` 与 `null` 渲染与本设计冲突**: 已明确以 AC 为准不还原，执行时容易被稿件带偏。
- **列头是不可信数据**: 容易被当作"我们自己的 UI 文案"而漏转义 —— 这正是 `escAttr` 存在的原因。
