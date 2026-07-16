# 历史记录与 Diff — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始任务 |

## 项目信息

- 项目名: json-keeper
- 架构类型: 单体前端应用（Chrome MV3 扩展 · 零依赖 · 无构建）
- specs 路径: `specs/4.history-and-diff/`

## 任务列表

> **UI 还原**：仅 Diff 视图的部分结构有稿（`design-baseline/s3-table-diff-dark`，结构基准）；历史面板与三个入口无稿，由前端按 design.md 实现。稿件左栏的 `Tree/History/Diff` 并列导航**不还原** —— 以 feature 1 的 IA 为准。

### 防护网基线（B3）

- [ ] T-301: 复跑防护网基线，补锁 storage 层现状行为 ~30min
  - 复用 `1.ui-shell-redesign` T-001 的 `node --test tests/` 骨架，**不重造**。
  - 补锁: 现有 5 个 storage 键（`jk:pending`/`jk:view`/`jk:theme`/`jk:sort`/`jk:skin`）的读写行为 —— 本 feature 会挤占同一配额。
  - 涉及模块: `tests/`

### 功能 1: 历史存储层（F-301/F-303/F-304/F-308）

- [ ] T-302: 实现 `history.js` — 开关、记录、上限淘汰、删除、清空 ~1h
  - 涉及模块: `history.js`(新)、`esc.js`(store)、`manifest.json`、`viewer.html`
  - **默认关闭是硬约束**：`jk:history:on` 未设置 = 关；关闭态 `record()` 一个字节都不写（AC-301）。
  - 上限：20 条 / 单条 256KB（超出只存摘要 + `truncated`）/ 总量 4MB。
  - 淘汰先按总字节再按条数，UI 需能说明规则。
  - **让配额失败可感知** —— 现有 `store` 封装 `catch {}` 吞错误，历史撑爆配额会导致主题/视图设置静默写不进去。
  - 单测覆盖：关闭态不写、上限淘汰、truncated 标记。

### 功能 2: 历史 UI（F-302/F-303）

- [ ] T-303: 历史面板 — 列表、空态开启引导、单条删除、一键清空 ~1h
  - 涉及模块: `history.js`、`panel.js`（**复用 feature 3 产出，勿新造**）、`toolbar.js`、`viewer.css`
  - 空态引导："开启历史记录后，最近查看的 JSON 会列在这里 · 仅存在本机，不会上传"。
  - 摘要是不可信数据 → `esc()`（AC-310）。
  - 一键清空必须真删（`storage.local.remove`），不是标记删除。
- [ ] T-304: popup 最近 3 条 + 点击载入 ~30min
  - 涉及模块: `popup.html`、`popup.js`
  - 注意：feature 1 的 T-008 刚给 popup 加了三个状态，本任务会增加 popup 高度，需一并核对布局不破。

### 功能 3: Diff 算法（F-305/F-309）

- [ ] T-305: 实现 `jsondiff.js` — 结构化递归 diff + 大整数相等判定 ~1h
  - 涉及模块: `jsondiff.js`(新)、`manifest.json`、`viewer.html`、`tests/`
  - **禁止** `JSON.stringify(a) === JSON.stringify(b)` 做相等判定（遇 BigInt 抛异常 + key 顺序敏感）。
  - 大整数：两侧皆整数 → 转 BigInt 比较；否则 `Object.is`（AC-309）。
  - 数组按索引对齐（首版不做 LCS，已知会对"头部插入"误报 —— 见风险点）。
  - 单测覆盖：added/removed/changed、大整数混比、嵌套、完全相同。

### 功能 4: Diff 视图与入口（F-305~F-307）

- [ ] T-306: Diff 左右分栏视图 + 差异标色 + 按 apath 同步滚动 + 空差异态 ~1h
  - 涉及模块: `diffview.js`(新)、`tree.js`、`panel.js`、`viewer.css`
  - 空差异态（AC-307）："两份 JSON 完全相同"+ 说明"key 顺序不同也不算差异 —— 我们比的是结构，不是文本"。
  - 走 `⋯` 菜单打开独立面板，**不进顶部分段器**（需两份输入，语义与单文档视图不同）。
  - 若左右分栏超出 `panel.js` 能力 → **扩展它，不新造**。
- [ ] T-307: 三个 Diff 入口 — 历史选两条 / 粘贴第二份 / 拖入 .json ~1h
  - 涉及模块: `diffview.js`、`history.js`、`viewer.html`、`core.js`
  - **拖放监听必须限定 `.jk-root` 内**，绝不挂 `document` —— content script 注入任意页面，全局监听会劫持宿主页拖放。
  - 历史入口在默认（关闭）状态下为空 → 引导开启，而不是显示一个用不了的按钮。

### 集成与测试

- [ ] T-308: 联调走查 + 隐私与安全核验 ~30min
  - 全新 profile 安装后打开若干 JSON → storage 中无历史条目（AC-301）。
  - `grep -rnE "fetch\(|XMLHttpRequest" history.js jsondiff.js` 无命中（AC-311）。
  - XSS: 历史摘要含 `<script>` 时纯文本显示（AC-310）。
  - 拖放：在被接管的普通页面上拖文件到 `.jk-root` 外，宿主页行为不被劫持。
- [ ] T-309: 复跑全部防护网基线 + 手动冒烟清单 ~30min
  - `node --test tests/` 全绿（AC-312）。
  - 冒烟清单 10 条全跑（本 feature 动了 popup 与 storage，第 10 项 popup→viewer 交接必须验）。

## 依赖关系

- **本 feature 依赖 `1.ui-shell-redesign`**（`addMenuItem`、popup 重做后的布局）**与 `3.schema-and-type-export`**（`panel.js` 侧滑面板）
- T-302 依赖 T-301
- T-303 依赖 T-302
- T-304 依赖 T-302
- T-305 依赖 T-301
- T-306 依赖 T-305
- T-307 依赖 T-303、T-306
- T-308 依赖 T-304、T-307
- T-309 依赖 T-308

## 风险点

- **数组按索引对齐会误报**：列表头部插入一个元素 → 后续全部被判 `changed`。而"对比两次 API 列表响应"正是本 feature 的主场景 —— 用户大概率撞上。首版已知缺陷，若反馈强烈需上 LCS（独立 feature）。
- **配额耗尽的连带伤害**：历史撑爆 `storage.local`（约 10MB）→ 主题/视图/排序设置静默写不进去，且现有 `store` 的 `catch {}` 会把错误吞掉，无人知晓。4MB 总量红线 + 让失败可感知是唯一防线。
- **默认关 → 入口空**：F-306 的"历史选两条"在默认状态下永远为空，用户可能以为功能坏了。空态引导是唯一缓解。
- **拖放全局监听的陷阱**：最省事的写法是挂 `document`，那会劫持任意宿主页的拖放行为 —— content script 特有的坑。
- **panel.js 的跨 feature 复用**：feature 3 先造、本 feature 复用。若需求分叉需评估扩展 vs 分离，**不要各造一套**。
