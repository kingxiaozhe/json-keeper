# 查询与表格视图 — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始任务 |

## 项目信息

- 项目名: json-keeper
- 架构类型: 单体前端应用（Chrome MV3 扩展 · 零依赖 · 无构建）
- specs 路径: `specs/2.query-and-table-view/`

## 任务列表

### 防护网基线（B3）

- [x] T-101: 复跑并扩充防护网基线，锁住将被触碰的存量行为 ~30min
  - `1.ui-shell-redesign` 的 T-001 已建 `node --test tests/` 骨架，**复用，不重造**。
  - 本 feature 触碰视图切换与搜索 → 补锁：`jk:view` 读到未知值时回落 `pretty`；`search` 的命中计数与跳转行为。
  - 涉及模块: `tests/`

### 功能 1: JSONPath 求值器（F-101 基础）

- [x] T-102: 实现 `jsonpath.js` 词法与 AST 解析 ~1h
  - 涉及模块: `jsonpath.js`(新)、`manifest.json`、`viewer.html`（加载顺序）
  - 支持: `$`、`.key`、`['key']`、`..key`、`[*]`、`[n]`、`[-n]`、`[a:b]`、`[a,b]`
  - 遇 `?(` → 返回明确的"暂不支持 filter 表达式"错误，而非语法错。
  - **禁 `eval`/`new Function`**（AC-108 用 grep 验证）。
- [x] T-103: 实现 `evalPath` 求值 + 单元测试 ~1h
  - 涉及模块: `jsonpath.js`、`tests/`
  - 返回 `{path, apath, value}`，`apath` 复用 `tree.js` 的 `childAccessor` 格式。
  - **大整数原样穿过**，不得触碰 `Number()`/`parseInt`。
  - 单测覆盖切片、负索引、递归下降、通配的边界（这是新的正确性资产，不能只靠手测）。

### 功能 2: 查询栏（F-101/F-102/F-103）

- [x] T-104: 查询栏 UI + 结果视图 + 计数 + 清除出口 + 语法错误态 ~1h
  - 涉及模块: `query.js`(新)、`toolbar.js`、`core.js`、`viewer.css`
  - Enter 触发求值；与搜索框并列，不替换（`/` 聚焦搜索的老行为不得失效）。
  - 错误态**保留上一次成功结果**（AC-103）。
  - 错误摘要含表达式原文 → 必须 `esc()`。

### 功能 3: 表格视图（F-104~F-107）

- [x] T-105: 实现 `table.js` — 可用性判定 + 列并集 + 缺失/null 区分 + 大整数高亮 ~1h
  - 涉及模块: `table.js`(新)、`viewer.css`、`manifest.json`、`viewer.html`
  - **F-104 是本 feature 的核心正确性点**：缺失字段渲染弱色 `—` + tooltip，真 `null` 渲染 `--jk-null` 色，两者视觉可区分。
  - 列头来自用户 JSON 的 key，**是不可信数据**，必须 `esc()`/`escAttr()`。
  - > 1000 行 → 只渲染前 1000 + `还有 N 条` 提示（不做分页，见 design.md 技术决策）。
- [ ] T-106: 表格嵌套单元格 `{…}` / `[N]` + 点开子树面板 ~30min
  - 涉及模块: `table.js`、`tree.js`、`viewer.css`
  - 不拍平成列（AC-107：列头不得出现 `user.city`）。
- [x] T-107: `Table` 接入视图分段器 + 不可用态置灰与原因说明 ~30min
  - 涉及模块: `toolbar.js`、`table.js`、`core.js`
  - 非数组/空数组/元素非对象 → 分段 `disabled` + tooltip 具体原因（AC-106）。
  - `jk:view` 新增 `table` 值，读到未知值回落 `pretty`（向后兼容老用户 storage）。

### 功能 4: 表格 ↔ 树互跳（F-105）

- [ ] T-108: 接入表格单元格点击 → `tree.jumpTo(apath)` ~30min
  - 涉及模块: `table.js`
  - **`jumpTo` 本身已移到 feature 1 的 T-003b 实现** —— 对抗审查指出它需要"renderTree → setView → 展开祖先链 → 滚动 → 高亮"五步，且要补根行 apath、rows 提到模块态、Sort 重建失效，远非 30min 的活，且 feature 3 的 AC-207 也依赖它。本任务只剩接线。
  - **不要抄 `rail.js` 的 `offsetTop` 定位** —— 那只对永不隐藏的顶层节点成立。

### 集成与测试

- [ ] T-109: 查询与表格的联调走查 + 元素清单核对 ~30min
  - 对照 `design-baseline/s3-table-diff-dark.png` 做**结构基准**核对（列头、大整数高亮、分段器）。
  - 注意：稿件的 `Load More` 与斜体 `null` 渲染**不还原**，以 AC-104/AC-107 为准。
- [ ] T-110: 复跑全部防护网基线 + 手动冒烟清单 + XSS 项 ~30min
  - `node --test tests/` 全绿（AC-110）。
  - XSS: 喂含 `<script>` 的字段值切表格，无弹窗（AC-109）。
  - `grep -nE "eval\(|new Function" jsonpath.js` 无命中（AC-108）。

## 依赖关系

- **本 feature 整体依赖 `1.ui-shell-redesign` 完成**（需要其模块拆分、工具栏 IA、视图分段器契约）
- T-102 依赖 T-101
- T-103 依赖 T-102
- T-104 依赖 T-103
- T-105 依赖 T-101
- T-106 依赖 T-105
- T-107 依赖 T-105
- T-108 依赖 T-105（jumpTo 本身由 feature 1 的 T-003b 提供）
- T-109 依赖 T-104、T-106、T-107、T-108
- T-110 依赖 T-109

## 风险点

- **自研 JSONPath 的正确性**：新解析器与 `jsonbig.js` 同属正确性资产，边界（切片、负索引、递归下降）易错。T-103 的单测是唯一防线，不可省。
- **列头漏转义**：列头来自用户 JSON 的 key，直觉上像"我们的 UI 文案"，最容易漏 `esc()` —— 这正是 XSS 的入口。
- **⚠ 与 feature 5 的"回来统一"没有任何任务承接（待人工裁决）**：本版表格用"前 1000 行 + 提示"兜底，理由是"虚拟滚动是 feature 5 范围"。但对抗审查查证：feature 5 的 T-501~T-510 **没有一条改表格渲染**，且 `JK.vlist` 吃的是树的行模型（无列模型、无 sticky 表头、无单元格 apath），**装不下表格**。落地结果：feature 5 交付后表格照旧卡在 1000 行，两套长列表策略原样并存。**一个 5000 条的用户列表 JSON，Table 视图永远只能看前 1000 条 —— 无分页、无 Load More、无虚拟滚动，全轮 66 条 AC 里没有任何一条覆盖"第 1001 条怎么看"。** 裁决选项：① feature 2 内做分页/Load More（+1 任务）② feature 5 扩 vlist 支持列模型（+工时，且要在 T-507 就设计好）③ 接受 1000 行上限并写进产品说明。
- **稿件带偏**：设计稿的 `Load More` 分页与斜体 `null` 与本设计冲突，执行时须以 AC 为准。
