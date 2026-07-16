# Schema 与类型导出 — 需求规格

## 概述

从当前 JSON 反推 JSON Schema、导出 TypeScript 类型定义、用 Schema 校验当前文档，并**诚实标注推断不确定处**。

## 项目信息

- 项目名: json-keeper
- 架构类型: 单体前端应用（Chrome MV3 扩展 · 零依赖原生 JS · 无构建）

## 需求版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始需求（源: `specs/docs/PRD-json-keeper-ui.md` §5.2） |

## 用户故事

- 作为**拿到 API 响应的开发者**，我想要一键得到 TypeScript 类型定义，以便我不用手抄字段。
- 作为**对接第三方接口的人**，我想要用官方 Schema 校验实际响应，以便我能指出到底是哪个字段不符合约定。
- 作为**看到推断结果的人**，我想要知道哪些类型是"猜的"，以便我不会把空数组推断成 `never[]` 就直接用。

## 功能需求

1. [F-201] 从当前 JSON 反推 JSON Schema（Draft 2020-12），可复制 / 下载。
2. [F-202] 导出 TypeScript 类型定义（`interface` / `type`），可复制。
3. [F-203] Schema 校验：贴入一份 JSON Schema 校验当前文档，**错误定位到具体节点**并在树上标红。
4. [F-204] **推断不确定处必须显式标注**：可空、联合类型、空数组、空对象、大整数 —— 不许假装确定。

## 非功能需求

- **性能**: 1MB 以内 JSON 的推断与校验在 500ms 内完成。
- **安全**: 贴入的 Schema 是不可信输入，解析走 `JSONBig.parse`，渲染一律 `esc()`；**禁止** `eval` / `new Function`。
- **兼容性**: 零依赖 —— Schema 推断与校验器自研，不得引入 ajv 等 npm 包或 CDN。
- **体积**: 新增 `jsonschema.js` ≤400 行；如超限拆为 `schema-infer.js` + `schema-validate.js`。

## 验收标准

- [ ] [AC-201] 对 `{"id":1,"name":"a"}` 推断 Schema → 输出含 `"type":"object"`、`properties.id.type === "integer"`、`properties.name.type === "string"`、`required` 含两者。
- [ ] [AC-202] 对 `{"id":1}` 导出 TS → 输出 `interface Root { id: number }`（可复制，粘贴进 .ts 文件不报语法错）。
- [ ] [AC-203] 对 `[{"a":1},{"a":"x"}]` 推断 → `a` 被标为联合类型（Schema 中 `"type":["integer","string"]`；TS 中 `number | string`），**且带不确定标注**。
- [ ] [AC-204] 对 `{"a":[]}` 推断 → 空数组的元素类型标注为不确定（TS 输出 `unknown[]` 并附注释，**不得输出 `never[]` 或 `any[]` 而不加说明**）。
- [ ] [AC-205] 对 `{"id":136986234663732436}` 推断 → 标注为大整数（TS 输出 `bigint` 或附精度注释），**不得静默输出 `number`**（会丢精度，与产品护城河冲突）。
- [ ] [AC-206] 对 `{"a":null}` 推断 → 标注为可空且类型不确定（TS `null` 并附注释，不得直接断言为某具体类型）。
- [ ] [AC-207] 贴入 `{"type":"object","required":["b"]}` 校验 `{"a":1}` → 报告缺失 `b`，且树上对应位置（root）标红。**前置: feature 1 的 T-002 必须已给容器根行补上 `apath = ""`** —— 现状根行没有 `_apath`，本条否则无法实现。
- [ ] [AC-208] 贴入非法 Schema（`{"type":`）→ 就地报错，不崩溃、不清空当前文档视图。
- [ ] [AC-209] `grep -nE "eval\(|new Function" schema-infer.js schema-validate.js` 无命中。
- [ ] [AC-210] 复跑防护网基线（`node --test tests/`）全绿。
- [ ] [AC-211] **自产自校验不报警**：对 `{"id":136986234663732436}` 导出 Schema → 原样贴回校验 → **零警告**（`x-bigint` / `x-inferred-uncertain` 属注解型，静默忽略）。
- [ ] [AC-212] **BigInt 不被判违规**：校验 `{"id":136986234663732436}` against `{"type":"object","properties":{"id":{"type":"integer"}}}` → **通过**，不报"不是 integer"。
- [ ] [AC-213] **真实 Schema 不满屏报警**：贴入含 `$schema` / `title` / `description` 的 Schema → 这三个关键字**不产生任何提示**。
- [ ] [AC-214] **循环 `$ref` 不卡死**：贴入 `{"$ref":"#"}` → 报明确错误（超出深度上限），标签页不卡死、不栈溢出。
- [ ] [AC-215] **递归 Schema 可用**：贴入 `{"$defs":{"Node":{"type":"object","properties":{"next":{"$ref":"#/$defs/Node"}}}},"$ref":"#/$defs/Node"}` 校验 `{"next":{"next":null}}` → 正常出结果，不卡死。
- [ ] [AC-216] **JSON Pointer 转义**：Schema 中 `#/$defs/a~1b` 正确解析为 key `a/b`。

## 依赖

- 前置 feature: `1.ui-shell-redesign`（工具栏 `addMenuItem` 契约 —— 导出族收纳进 `⋯` 菜单）。
- 无外部依赖。

## 开放问题

- **无设计稿**（Stitch 未生成本组功能的界面）。经人工确认：**本组 UI 由前端按 design.md 自行实现，不生成 UI 还原任务**（命令 Step 8.5 规定）。
- 遗留（不阻塞）：Schema Draft 版本固定为 2020-12，不做多版本切换。
