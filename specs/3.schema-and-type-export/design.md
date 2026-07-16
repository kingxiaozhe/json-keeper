# Schema 与类型导出 — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始设计 |

## 项目架构

- 架构类型: 单体前端应用（Chrome MV3 扩展）
- 涉及层: 内容脚本 · 扩展页面 · 样式层。无后端。

## 设计基准

- **无基准**。Stitch 未生成本组功能的界面稿，经人工确认：UI 由前端按本文档自行实现，**不生成 UI 还原任务**（命令 Step 8.5）。
- UI 须遵循 feature 1 的既有 token 与组件样式，不得另起一套视觉。

## 波及面（B2）

| 改动目标 | 谁引用它 | 可能受影响的老功能 |
| --- | --- | --- |
| 工具栏 `⋯` 菜单新增导出族 | `toolbar.js`（feature 1 产出）的 `addMenuItem` | 现有 Download / Copy JSON —— 同属"导出"语义，须与新项归组，避免两处入口打架 |
| 树节点标红（F-203 校验错误定位） | `tree.js` 的行渲染；`search.js` 的 `jk-current`/`jk-dim` 类 | **搜索高亮**：校验标红与搜索高亮可能同时存在，CSS 类需正交不打架 |
| 面板容器（Schema/TS 输出、Schema 输入） | `core.js` 编排 | 主视图区域布局 |

**不改动**: `jsonbig.js`、`content.js`、`popup.*`。

## 功能模块设计

### 模块 1: schema-infer.js（F-201/F-204）

**核心立场**: 推断即猜测。**每一处猜测都必须可见** —— 这是产品"正确性/可信赖"护城河在类型领域的延伸。别家工具把空数组推成 `any[]`、把大整数推成 `number`，用户拿去就踩坑。

**类型映射**:

| JSON 值 | Schema | TS | 确定性 |
| --- | --- | --- | --- |
| `"abc"` | `{"type":"string"}` | `string` | 确定 |
| `1` | `{"type":"integer"}` | `number` | 确定 |
| `1.5` | `{"type":"number"}` | `number` | 确定 |
| `136986234663732436`（BigInt） | `{"type":"integer","x-bigint":true}` | `bigint` | **确定但需标注**（AC-205） |
| `true` | `{"type":"boolean"}` | `boolean` | 确定 |
| `null` | `{"type":"null"}` | `null` | **不确定**（AC-206）—— 只见过 null，真实类型未知 |
| `[]` | `{"type":"array"}`（无 `items`） | `unknown[]` | **不确定**（AC-204）—— 元素类型无样本 |
| `{}` | `{"type":"object"}` | `Record<string, unknown>` | **不确定** |
| 数组元素类型不一 | `{"type":["integer","string"]}` | `number \| string` | **不确定**（AC-203）—— 样本可能不全 |

**不确定标注的呈现**:
- Schema: 自定义扩展键 `x-inferred-uncertain: "空数组 — 元素类型无样本"`（JSON Schema 允许未知关键字，校验器会忽略，不破坏可用性）。
- TS: 行尾注释 `// ⚠ 空数组 — 元素类型无样本，请确认`。
- UI: 输出面板中不确定行**高亮标注**，并给出计数 `3 处推断不确定`。

**数组元素合并**: 遍历全部元素求类型并集；对象元素求 key 并集，**只在所有元素都有的 key 才进 `required`**（其余为可选，TS 输出 `?`）—— 与 feature 2 的表格"缺失 vs null"是同一条正确性主张。

**契约**:
```js
JK.schema.infer(value) // → {schema, uncertainties:[{path, reason}]}
JK.schema.toTypeScript(value, opts) // → {code, uncertainties:[...]}
```

### 模块 2: schema-validate.js（F-203）

**自研校验器（禁 ajv，零依赖）· 支持的关键字子集**:

| 关键字 | 说明 |
| --- | --- |
| `type` | 含数组形式（联合）。**BigInt 处理见下** |
| `properties` / `required` / `additionalProperties`(boolean) | |
| `items` | 单一 schema 形式 |
| `enum` / `const` | |
| `minimum` / `maximum` / `minLength` / `maxLength` | |
| `$ref` | **仅支持同文档内 `#/...` 引用**，不支持远程引用（零网络红线）。**必须有循环检测，见下** |

### ⚠ 关键字政策必须三分，不能二分（对抗审查采纳）

**原方案自噬**: 模块 1 说 `x-inferred-uncertain`/`x-bigint`「JSON Schema 允许未知关键字，**校验器会忽略**，不破坏可用性」；模块 2 又说「**未支持的关键字必须明确提示，禁止静默跳过**」。「校验器会忽略」对通用校验器成立，对**本项目自研的这个**不成立。

**失败场景（产品自己的两个功能串起来）**: `{"id":136986234663732436}` → 导出 Schema（AC-205 要求含 `x-bigint`）→ 复制 → 用"用 Schema 校验"贴回去 → **满屏假警告**：`暂不支持关键字 x-bigint`、`暂不支持 x-inferred-uncertain`。

**更普遍的**: 真实世界的 Schema 几乎必带 `$schema` 与 `description`。用户贴一份 OpenAPI 导出的 Schema → 满屏"暂不支持"。AC-207 的样例 `{"type":"object","required":["b"]}` 恰好干净，**验收因此过得去，真实输入必炸**。

**三分政策**:

| 类别 | 处置 | 清单 |
| --- | --- | --- |
| **支持** | 正常校验 | 上表 |
| **注解型**（不影响校验结论） | **静默忽略**（白名单） | `$schema` `$id` `$comment` `title` `description` `default` `examples` `deprecated` `readOnly` `writeOnly` `$defs` `definitions`，以及 **`x-*` 前缀**（含我们自己产出的 `x-bigint`/`x-inferred-uncertain`） |
| **断言型未支持**（影响结论） | **明确提示** | `allOf` `anyOf` `oneOf` `not` `if/then/else` `patternProperties` `pattern` `format` `uniqueItems` 等 |

理由: 静默跳过**断言型**关键字会让用户误以为"校验通过"（比不支持更危险）；但静默忽略**注解型**关键字是 JSON Schema 规范本来的语义 —— 把它们也报出来是噪音，且会让产品自己的产物在自己的校验器里报警。

### ⚠ BigInt 会被自家校验器判违规（对抗审查采纳）

原方案的大整数一节只覆盖 `minimum`/`maximum`，**漏了 `type` —— 而 `type` 才是最常走的分支**。

**失败场景**: 校验 `{"id":136986234663732436}` against `{"type":"object","properties":{"id":{"type":"integer"}}}` → `typeof 136986234663732436n === "bigint"` → 常规写法 `typeof v === "number" && Number.isInteger(v)` 判 false → **报"id 不是 integer"**。这个值正是产品存在的理由（`jsonbig.js` 文件头亲口点名）。`{"type":"number"}` 同理。

**min/max 的原规则也埋雷**: 「仅当两边都是整数转 BigInt 比」—— 但 `Number.isInteger(136986234663732436n)` 返回 **`false`**（不抛，就是 false）→ **恰好把最需要走 BigInt 的值路由进 `Number()` 分支 → 静默丢精度**。另一边 `BigInt(1.5)` 抛 RangeError，所以也不能无脑转。

**修正**: 用 `JK.util.isIntegerLike(v)`（feature 1 提供，与 feature 2/4 共用）:
```js
isIntegerLike = (v) => typeof v === "bigint" || Number.isInteger(v);
// type 分支：bigint 同时满足 "integer" 与 "number"
// min/max：两边 isIntegerLike → BigInt 比较；否则 Number 比较
```

### ⚠ $ref 必须有循环检测（对抗审查采纳）

**失败场景**: `{"$ref": "#"}`，或递归 Schema 的**标准写法**（链表/树，随处可见）:
```json
{"$defs":{"Node":{"type":"object","properties":{"next":{"$ref":"#/$defs/Node"}}}},"$ref":"#/$defs/Node"}
```
解引用后原地递归 → 栈溢出 RangeError 或**标签页卡死**。**AC-208 覆盖不到** —— 它只兜了"非法 Schema"，而自引用 Schema 是**完全合法**的，`JSONBig.parse` 会成功，然后才挂。

**修正**:
- `(schema, value)` 对的已访问集 + 硬性深度上限（64），超限报明确错误。
- **JSON Pointer 的转义必须实现**: `~1` → `/`、`~0` → `~`，以及百分号解码。漏了会让 key 含 `/` 的 Schema 定位到错误节点。

**不支持**: 远程 `$ref`（红线，明确拒绝并说明是零网络约束，不是能力缺失）。

**错误定位**: 每个错误产出 `{apath, keyword, msg}`，`apath` 复用 `tree.js` 的 `childAccessor` 格式 → 调 `JK.tree.jumpTo(apath)` 定位 + 加 `jk-invalid` 类标红。

**大整数**: `minimum`/`maximum` 比较需处理 `BigInt` 与 `Number` 混比 —— 统一转 `BigInt` 比较（仅当两边都是整数），否则按 `Number` 比。**不得用 `JSON.parse` 重解析 Schema**（会毁掉 Schema 里的大整数边界值）。

### 模块 3: 导出 UI

- **入口**: 工具栏 `⋯` 菜单的 `export` 组 —— `导出 JSON Schema` / `导出 TypeScript` / `用 Schema 校验`。依 feature 1 的扩展约定，低频功能进菜单，**此处不申请一级位置**。
- **输出面板**: 侧滑面板，含代码框（等宽、语法弱高亮）+ `复制` + `下载` + 不确定计数徽章。
- **校验输入**: 面板内 textarea 贴 Schema + `校验` 按钮；结果为错误列表，每条可点击 → 树上定位标红。
- **非法 Schema**（AC-208）: 就地一行报错，**不清空当前文档视图**（与 feature 2 的 F-103 同一条纪律）。

## 接口契约

| 组件 | 入参 | 返回 |
| --- | --- | --- |
| `JK.schema.infer(value)` | 解析后的值 | `{schema, uncertainties:[{path, reason}]}` |
| `JK.schema.toTypeScript(value, {rootName})` | 值 + 根类型名 | `{code, uncertainties}` |
| `JK.schema.validate(schema, value)` | Schema 对象 + 值 | `{ok, errors:[{apath, keyword, msg}]}` |
| `JK.tree.markInvalid(apath[])` | 路径数组 | 加 `jk-invalid` 类；`clearInvalid()` 清除 |
| `JK.panel.open({title, body, actions})` | — | `{close()}`（侧滑面板，供本 feature 与 feature 4 共用） |

## 数据模型

新增 storage 键: 无。**贴入的 Schema 不持久化** —— 它是用户数据，且历史记录（feature 4）已明确默认关闭，此处不应偷偷存盘。

## 安全考虑

- **贴入的 Schema 是不可信输入**: 用 `JSONBig.parse` 解析（非原生 `JSON.parse`，保 Schema 内大整数边界值精度）；错误信息与 Schema 片段渲染一律 `esc()`。
- **禁 eval**: 校验器手写递归；`$ref` 只做同文档字符串路径解析，**不做任何动态求值**。AC-209 用 grep 验证。
- **零网络**: `$ref` 远程引用**必须拒绝**并给出明确提示 —— 这是红线，不是能力缺失。
- **XSS**: TS/Schema 输出含用户 JSON 的 key 名（`interface Root { <用户key>: string }`），进 `innerHTML` 前必须 `esc()`。
- **TS 标识符安全**: 用户 key 可能不是合法 TS 标识符（`"a-b"`、`"1x"`、空串）→ 输出 `"a-b": string` 引号形式，不得直接拼接产生语法错代码。

## 技术决策

| 决策 | 选项 | 理由 |
| ---- | ---- | ---- |
| 校验器 | ① 引入 ajv ② 自研子集 | **选 ②**。零依赖是硬约束（`coding-style.md`）；ajv 还会用到 `new Function` 编译，直接撞 security 红线 |
| 不支持的关键字 | ① 静默跳过 ② 明确提示 | **选 ②**。静默跳过让用户误以为"校验通过"，比不支持更危险 —— 违背产品的正确性主张 |
| 空数组 TS 输出 | ① `any[]` ② `never[]` ③ `unknown[]` + 注释 | **选 ③**。`any` 关掉类型检查（有害），`never` 是错的（数组可以有元素），`unknown` + 显式注释是唯一诚实的答案 |
| 大整数 TS 输出 | ① `number` ② `bigint` + 注释 | **选 ②**。输出 `number` 会让用户在自己代码里丢掉我们辛苦保住的精度 —— 与护城河直接冲突 |
| 不确定的记录方式 | ① 只在 UI 显示 ② 写进产物（`x-` 键 / 注释） | **选 ②**。产物会被复制走，UI 提示留不下来；写进产物才能跟着代码走 |
| Schema Draft | ① 多版本可选 ② 固定 2020-12 | **选 ②**。多版本切换的收益低于复杂度；PRD 未要求 |
| 模块拆分 | ① 单文件 ② infer/validate 分离 | **选 ②**。推断与校验是两套独立逻辑，合起来必破 400 行上限 |

## 风险点

- **自研校验器的覆盖面**: 关键字子集必然不全，用户拿真实 Schema 来大概率遇到未支持项。缓解: 明确提示而非静默跳过；但仍可能被评价为"不好用"。
- **推断的样本偏差**: 从一份 JSON 推类型本质上是以偏概全（只见过一个元素的数组、只见过 null 的字段）。这是方法论固有局限，只能靠 F-204 的诚实标注缓解，不能消除。
- **TS 标识符边界**: 用户 key 含特殊字符/数字开头/空串时，拼出的 TS 代码可能语法错（AC-202 只验了简单情形）。
- **与搜索高亮的类冲突**: `jk-invalid` 与 `jk-current`/`jk-dim` 可能同时命中一行，CSS 需正交设计。
