# Schema 与类型导出 — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始任务 |

## 项目信息

- 项目名: json-keeper
- 架构类型: 单体前端应用（Chrome MV3 扩展 · 零依赖 · 无构建）
- specs 路径: `specs/3.schema-and-type-export/`

## 任务列表

> **无 UI 还原任务**：本组功能无设计稿（人工确认），UI 由前端按 design.md 自行实现，须遵循 feature 1 的既有 token 与组件样式。

### 防护网基线（B3）

- [x] T-201: 复跑防护网基线，补锁树节点类与工具菜单契约 ~30min
  - 复用 `1.ui-shell-redesign` T-001 建立的 `node --test tests/` 骨架，**不重造**。
  - 补锁: `jk-current`/`jk-dim` 的搜索高亮行为（本 feature 新增 `jk-invalid` 需与其正交）。
  - 涉及模块: `tests/`

### 功能 1: Schema 推断（F-201/F-204）

- [x] T-202: 实现 `schema-infer.js` — 类型映射 + 数组元素并集 + required 判定 ~1h
  - 涉及模块: `schema-infer.js`(新)、`manifest.json`、`viewer.html`
  - 只在**所有元素都有**的 key 才进 `required`，其余可选。
  - 大整数 → `{"type":"integer","x-bigint":true}`，**不得输出 `number`**。
- [x] T-203: 实现不确定标注（`uncertainties` 收集 + `x-inferred-uncertain` 写入产物）~30min
  - 涉及模块: `schema-infer.js`、`tests/`
  - 覆盖: 空数组、空对象、只见过 null、联合类型、大整数。
  - **标注必须写进产物**（不只 UI 显示）—— 产物会被复制走，UI 提示留不下（AC-203/204/205/206）。
  - 单测覆盖全部五种不确定情形。

### 功能 2: TypeScript 导出（F-202）

- [x] T-204: 实现 `toTypeScript` — interface 生成 + 标识符安全 + 不确定注释 ~1h
  - 涉及模块: `schema-infer.js`、`tests/`
  - 非法 TS 标识符（`a-b`、`1x`、空串）→ 输出 `"a-b": string` 引号形式，不得拼出语法错代码。
  - 空数组 → `unknown[]` + 注释；大整数 → `bigint` + 注释（见 design.md 技术决策）。
  - 单测：产物粘贴进 .ts 不报语法错（AC-202）。

### 功能 3: Schema 校验（F-203）

- [x] T-205: 实现 `schema-validate.js` — 关键字三分政策 + BigInt 类型判定 + `$ref` 循环检测 + 错误定位 ~2h
  - 涉及模块: `schema-validate.js`(新)、`manifest.json`、`viewer.html`
  - 支持: `type`/`properties`/`required`/`additionalProperties`/`items`/`enum`/`const`/`min*`/`max*`/同文档 `$ref`
  - **关键字三分**（见 design.md）：支持 / 注解型静默忽略（白名单含 `$schema` `description` `$defs` 与 `x-*`）/ 断言型明确提示。**二分政策会让产品自己导出的 Schema 在自己的校验器里满屏报警**。
  - **BigInt 必须同时满足 `integer` 与 `number`** —— 用 `JK.util.isIntegerLike`，不得用 `Number.isInteger`（它对 BigInt 返回 false，会把招牌数据判违规）。
  - **`$ref` 循环检测**：已访问集 + 深度上限 64。`{"$ref":"#"}` 与递归 Schema 是合法输入，没有检测会卡死标签页。
  - **JSON Pointer 转义**：`~1`→`/`、`~0`→`~` + 百分号解码。漏了会让 key 含 `/` 的 Schema 定位错节点。
  - **远程 `$ref` 必须拒绝**并说明是零网络红线，不是能力缺失。
  - **不得用原生 `JSON.parse` 重解析 Schema**（会毁掉 Schema 里的大整数边界值）。
  - > 工时由 1h 上调至 2h：对抗审查判定原估时把三分政策、循环检测、Pointer 转义、BigInt 比较全塞进 1h 不现实。
- [ ] T-206: 树节点标红 `JK.tree.markInvalid(apath[])` + 与搜索高亮正交 ~30min
  - 涉及模块: `tree.js`、`viewer.css`
  - `jk-invalid` 与 `jk-current`/`jk-dim` 可能同时命中一行，CSS 需正交不打架。

### 功能 4: 导出 UI

- [ ] T-207: 侧滑面板 `JK.panel` + 三个菜单入口 + 输出/复制/下载 + 不确定计数徽章 ~1h
  - 涉及模块: `panel.js`(新)、`toolbar.js`、`viewer.css`
  - 入口走 feature 1 的 `⋯` 菜单 `export` 组（低频，不申请一级位置）。
  - `panel.js` 设计为通用件 —— feature 4 的历史/Diff 面板复用它，**勿各造一套**。
  - 输出含用户 key 名 → 进 `innerHTML` 前必须 `esc()`。
- [ ] T-208: Schema 输入区 + 校验结果列表 + 非法 Schema 就地报错 ~30min
  - 涉及模块: `panel.js`、`schema-validate.js`、`viewer.css`
  - 非法 Schema **不清空当前文档视图**（AC-208）。
  - 结果列表每条可点击 → 树上定位标红。

### 集成与测试

- [ ] T-209: 联调走查 + 安全核验 ~30min
  - `grep -nE "eval\(|new Function" schema-infer.js schema-validate.js` 无命中（AC-209）。
  - 远程 `$ref` 被拒绝且提示正确。
  - XSS: key 名含 `<script>` 时导出面板以纯文本显示。
- [ ] T-210: 复跑全部防护网基线 + 手动冒烟清单 ~30min
  - `node --test tests/` 全绿（AC-210）。

## 依赖关系

- **本 feature 整体依赖 `1.ui-shell-redesign` 完成**（需要 `addMenuItem` 契约与模块拆分后的挂载点）
- T-202 依赖 T-201
- T-203 依赖 T-202
- T-204 依赖 T-203（不确定标注先成型，TS 导出复用同一份 `uncertainties`）
- T-205 依赖 T-201
- T-206 依赖 T-205
- T-207 依赖 T-204
- T-208 依赖 T-205、T-207
- T-209 依赖 T-206、T-208
- T-210 依赖 T-209

## 风险点

- **自研校验器覆盖面不足**：关键字子集必然不全，用户拿真实 Schema 大概率遇到未支持项。已用"明确提示"缓解，但仍可能被评价为不好用。
- **推断的样本偏差是方法论固有局限**：从一份 JSON 推类型本质是以偏概全，只能靠 F-204 的诚实标注缓解，不能消除。这是本 feature 的价值主张，也是它的天花板。
- **`panel.js` 的复用边界**：本 feature 先造，feature 4 复用。若两者需求分叉（如 Diff 需要左右分栏），需在 feature 4 评估是扩展还是分离，**不要各造一套**。
- **无设计稿**：UI 由前端自行实现，视觉一致性靠 feature 1 的 token 约束，存在跑偏风险 —— T-209 走查时须与 feature 1 产出的组件样式对照。
