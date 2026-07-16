# 历史记录与 Diff — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始设计 |

## 项目架构

- 架构类型: 单体前端应用（Chrome MV3 扩展）
- 涉及层: 内容脚本 · 扩展页面 · 存储层（`chrome.storage.local`）· 样式层。无后端。

## 设计基准

- **档位: ② 结构基准**（人工确认），**仅覆盖 Diff 视图的部分结构**。
- 基准路径: `specs/docs/design-baseline/s3-table-diff-dark.{html,png}` —— 含左栏 `Tree / History / Diff / Compare` 与右上 `Table View | Diff View` 切换。这两处结构可参考。
- **无稿部分**: 历史面板、三个 Diff 入口、空差异态、开启历史的引导 —— 由前端按本文档实现，遵循 feature 1 的 token。
- **稿件与本设计的冲突**: 稿中左栏把 `Tree/Table/History/Diff` 并列为主导航，而 feature 1 的 IA 决定主视图切换走**顶部分段器**、低频功能走 `⋯` 菜单。**以 feature 1 的 IA 为准** —— 否则会出现两套导航打架。稿件此处不还原。

## 波及面（B2）

| 改动目标 | 谁引用它 | 可能受影响的老功能 |
| --- | --- | --- |
| `chrome.storage.local` 新增键 | 现有 `jk:pending`/`jk:view`/`jk:theme`/`jk:sort`/`jk:skin`；`util.js` 的 `store` 封装 | **storage 配额**：`QUOTA_BYTES = 10485760`。历史撑爆配额 → `store.set` 失败 → **偏好设置（主题/视图/排序）一起写不进去**。`jk:view` 尤其危险 —— 每次 `setView` 都写（`core.js:287`），**含接管路径** |
| popup 新增最近 3 条 | `popup.html`/`popup.js`；feature 1 的 T-008 刚重做过 popup | popup 布局与三个状态（空/非法/超长）—— 高度会增加 |
| 主视图新增 Diff 模式 | `core.js` 编排；`toolbar.js` 分段器 | 视图记忆 `jk:view` |
| 拖放入口 | `viewer.html`/接管页的 `drop` 事件 | **宿主页拖放**：content script 在任意页面注入，`drop` 监听须限定在 `.jk-root` 内，否则劫持宿主页的拖放行为 |

**不改动**: `jsonbig.js`、`content.js` 的接管判定。

## 功能模块设计

### 模块 1: history.js（F-301~F-304/F-308）

**默认关闭（F-308）** —— 本模块最重要的约束。

```js
// 开关键；未设置 = 关闭。读不到就是关，不做"首次默认开"的花招。
"jk:history:on" → boolean（默认 undefined = 关）
"jk:history"    → [{id, ts, size, preview, text}]  // 仅开启后写入
```

- **关闭态**: `record()` 直接 return，**一个字节都不写**（AC-301）。
- **开启入口**: 历史面板空态 + popup 的历史区，均给"开启历史记录"按钮 + 一行说明 `仅存在本机，不会上传`。
- **摘要 `preview`**: 原文前 80 字符，**存前必须截断**（存全文摘要没意义且占配额）。

**容量上限（F-304）** —— 对抗审查纠正了计量单位:

`chrome.storage.local.QUOTA_BYTES = 10485760`（10MB，未申请 `unlimitedStorage`）—— 这个数字对。**但 Chromium 的 `SettingsStorageQuotaEnforcer` 按「JSON 序列化结果的 UTF-8 字节数 + key 长度」计，不是按 `text.length`（UTF-16 code unit）计。**

**失败场景**: 开启历史后打开 20 份中文 API 响应，每份 20 万字符 → 按 `text.length` 算 = 4MB「未超线」→ 实际占用 **12MB+**（中文 1 char = 3 字节，再叠加存成 JSON 字符串时 `"` → `\"` 的 10~15% 膨胀）→ 超 10MB 配额 → set 失败 → **历史和主题/视图/排序一起写不进去** —— 正是这条红线声称要防的事故。

| 限制 | 值 | 计量方式 |
| --- | --- | --- |
| 条数 | 20 | — |
| 单条 | 256KB | **`new TextEncoder().encode(text).length`（UTF-8 字节）**，不是 `text.length` |
| 总量 | 4MB | 同上，且**按整个 `jk:history` 数组序列化后的字节数**估算，留 6MB 给偏好设置与 `jk:pending` |

**两个上限自相矛盾需靠淘汰兜住**: 20 条 × 256KB = 5.12MB > 4MB 总线。故**总量是硬线，条数是软线** —— 先按总字节从最旧淘汰到 4MB 以下，再按条数截到 20。

> 注: 既有的 `humanSize(rawText.length)` 用的是 UTF-16 口径 —— 那是**显示**用途，可以不改；但**配额计算不得复用它**。

淘汰: 先按总字节从最旧淘汰，再按条数。UI 明说规则（AC-305）。

**契约**:
```js
JK.history.isOn()            // → boolean
JK.history.enable(on)        // → Promise
JK.history.record(text)      // → 关闭时 no-op
JK.history.list()            // → Promise<[{id, ts, size, preview, truncated}]>
JK.history.get(id)           // → Promise<text|null>（truncated 条目返回 null）
JK.history.remove(id) / JK.history.clear()
```

### 模块 2: jsondiff.js（F-305/F-307/F-309）

**算法**: 递归结构化 diff（非文本行 diff）。文本 diff 对 JSON 是错的 —— key 顺序变化会产生海量假差异。

**分支表必须先铺满再谈递归**（对抗审查采纳 —— 原表只有四行，漏的正是 JSON 里最常见的东西）:

```
kind(v) =  v === null            → "null"        // typeof null === "object"，必须先判！
           Array.isArray(v)      → "array"       // typeof [] === "object"，与对象必须分开
           typeof v === "object" → "object"
           bigint | number       → "number"      // 归一！不能按 typeof 分，见下
           其他                  → typeof v

diff(a, b, apath) →
  kind 不同        → changed
  null / null      → 无差异（不得走 object 分支）
  object / object  → key 并集：只在 a → removed；只在 b → added；都有 → 递归
  array / array    → 按索引对齐递归；长度差 → added/removed（首版不做 LCS，见技术决策）
  number / number  → numEq(a,b) ? 无 : changed
  其他基本类型      → Object.is(a,b) ? 无 : changed
```

**三个必须显式处理的坑**（每条都有具体崩溃/误报场景）:

| 坑 | 失败场景 | 修法 |
| --- | --- | --- |
| **`null` 崩溃** | `typeof null === "object"` → 走 object 分支 → `Object.keys(null)` 抛 `TypeError: Cannot convert undefined or null to object`。输入 `{"a":null}` vs `{"a":null}`（最普通的 API 响应）→ **Diff 面板白屏**。AC-306 的样例测不到 | `kind()` 先判 `null` |
| **数组 vs 对象** | 两侧 `typeof` 都是 `"object"`，落哪个分支未定义。若先判 object，`[1,2]` vs `{"0":1,"1":2}` → key 并集 `["0","1"]` 全等 → **报"无差异"**，直接踩中 F-307 的"两份 JSON 完全相同"文案 | `kind()` 用 `Array.isArray` 分开 |
| **BigInt 混比被"类型不同"短路** | `typeof 1n !== typeof 1` → 原方案的"类型不同 → changed"排在最前，**混比规则永远跑不到**。真实输入: `{"n":1e20}`（`jsonbig.js` 走 isFloat → Number）vs `{"n":100000000000000000000}`（→ BigInt）—— 数学相等却报 changed。**这正是本模块声称要防的误报** | `kind()` 把 number/bigint 归一为 `"number"`，比较在 `numEq` 内部处理 |

**`numEq(a, b)` 的正确实现（AC-309）**:
```js
// isIntegerLike 来自 JK.util（feature 1 提供，与 schema 校验器共用）
// 不能用 Number.isInteger(1n) —— 它返回 false（不抛），恰好把最该走 BigInt 的值
// 路由进 Number 分支静默丢精度；也不能无脑 BigInt(v) —— BigInt(1.5) 抛 RangeError
function numEq(a, b) {
  if (JK.util.isIntegerLike(a) && JK.util.isIntegerLike(b)) return BigInt(a) === BigInt(b);
  return Object.is(Number(a), Number(b));
}
```

- **禁止** `JSON.stringify(a) === JSON.stringify(b)` 做相等判定（遇 BigInt 抛 TypeError，且 key 顺序敏感）。

**契约**:
```js
JK.diff.compare(a, b) // → {same:boolean, ops:[{op:"added"|"removed"|"changed", apath, from, to}]}
```

### 模块 3: Diff 视图（F-305/F-307）

- 左右分栏，各自一棵树（复用 `tree.js`），差异行加类: `jk-d-add` / `jk-d-del` / `jk-d-chg`。
- 同步滚动（两侧行数不同 → 按 `apath` 对齐，不按行号）。
- **空差异态（F-307）**: `same === true` → 面板中央显示"两份 JSON 完全相同"+ 提示（如"key 顺序不同也不算差异 —— 我们比的是结构，不是文本"）。这条提示本身就是产品主张。
- 视图归属: `Diff` **不进顶部分段器**（它需要两份输入，与单文档视图语义不同）→ 走 `⋯` 菜单打开独立面板。**与稿件的左栏并列导航不同，理由见"设计基准"**。

### 模块 4: 三个入口（F-306）

| 入口 | 实现 | 注意 |
| --- | --- | --- |
| 从历史选两条 | 历史面板多选（选满 2 条 → `对比` 按钮激活） | **历史默认关 → 此入口默认为空**。空态须引导"开启历史记录后可在此对比"，而不是显示一个用不了的按钮（已知张力，requirements 开放问题记录） |
| 粘贴第二份 | Diff 面板内 textarea + `对比` | 当前文档为左，粘贴的为右 |
| 拖入 .json | `drop` 事件，走 File API | **监听必须限定在 `.jk-root` 内** —— content script 注入任意页面，全局监听会劫持宿主页拖放。`dragover` 需 `preventDefault` 才能触发 `drop`，但只在自己的容器内 |

## 接口契约

| 组件 | 入参 | 返回 |
| --- | --- | --- |
| `JK.history.*` | 见模块 1 | |
| `JK.diff.compare(a, b)` | 两个解析后的值 | `{same, ops:[{op, apath, from, to}]}` |
| `JK.diffview.mount(el, {left, right, ops})` | 面板容器 + 两值 + 差异 | `{destroy()}` |
| `JK.panel.open(...)` | **复用 feature 3 的 `panel.js`** | 若 Diff 的左右分栏需求超出 panel 能力 → **扩展 panel，不新造** |

## 数据模型

`chrome.storage.local`（唯一持久化，键名一律 `jk:` 前缀）:

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `jk:history:on` | boolean | 开关，**未设置 = 关闭** |
| `jk:history` | array | 条目数组，仅开启后写入 |

**无数据库、无后端、无远程同步。**

## 安全考虑

- **这是全项目最敏感的数据**: 用户看的 JSON 常是生产 API 响应，含 token、身份证、手机号。因此:
  - **默认关闭**（F-308），不做"首次默认开 + 事后告知"的花招。
  - 开启后**只写 `chrome.storage.local`**；`grep` 验证无 `fetch`/`XMLHttpRequest`（AC-311）。
  - 一键清空必须真删（`chrome.storage.local.remove`），不是标记删除。
- **XSS**: 历史摘要、diff 的 from/to 值、文件名 —— 全部不可信，一律 `esc()`。
- **拖放劫持**: `drop`/`dragover` 监听限定 `.jk-root` 内，绝不挂 `document`。

### 配额失败的真实机制（对抗审查纠正了原方案的错误诊断）

**原方案错在哪**: 说"现有 `store` 封装的 `catch {}` 吞掉了配额错误，本 feature 要让它可感知"。**这个诊断是错的**。看 `core.js:24`:
```js
set(k, v) { try { chrome.storage.local.set({ [k]: v }); } catch {} },
```
MV3 下 `set()` 不传 callback 时返回 Promise，**配额超限是异步 reject（或 `chrome.runtime.lastError`），同步 try/catch 根本捕不到**。它只挡得住 `chrome` 未定义 / extension context invalidated 这类同步抛错。**把 `catch {}` 去掉，行为一个字节都不会变** —— 现状是变成 unhandled promise rejection，在被接管的宿主页控制台里静默刷日志。

**真改法**: 传 callback 检 `chrome.runtime.lastError`，或 `.catch()` 显式处理。

**改它的波及面（必须谨慎）**: `store.set` 的调用方是 `jk:view`（`core.js:287`，**每次 `setView` 都写，含接管路径**）、`jk:theme`、`jk:sort`、`jk:skin`。**把它改成会抛/会 reject 而不在各调用点加处理，等于把一个原本无害的偏好写入变成接管路径上的未捕获异常** —— 那比配额静默失败更糟。

**采纳的做法**: `store.set(k, v, onError)` —— 新增**可选**的错误回调；不传时保持现状（吞掉，偏好写入不该因为写不进去而炸掉接管）。**只有 `history.js` 传 `onError`**，把配额失败显示给用户。

## 技术决策

| 决策 | 选项 | 理由 |
| ---- | ---- | ---- |
| 历史默认 | ① 默认开 ② 默认关 ③ 默认开+首次告知 | **选 ②**（人工确认）。JSON 常含生产 token；默认存盘与状态栏常年印着的 `no telemetry` 气质冲突。代价: 功能发现率低 —— 用空态引导缓解 |
| diff 算法 | ① 文本行 diff ② 结构化递归 diff | **选 ②**。文本 diff 对 JSON 是错的：key 顺序变化 → 海量假差异 |
| 数组 diff | ① LCS 移动检测 ② 按索引对齐 | **选 ②**（首版）。LCS 能识别"元素移动"，但复杂度高；按索引对齐对"列表新增一项"会误报大量 changed —— **已知缺陷，写入风险点**，视反馈再上 LCS |
| 大整数相等 | ① `JSON.stringify` 比较 ② 显式 BigInt/Number 混比规则 | **选 ②**。`stringify` 遇 BigInt 直接抛异常，且 key 顺序敏感 —— 两个致命问题 |
| Diff 视图归属 | ① 顶部分段器 ② `⋯` 菜单 + 独立面板 | **选 ②**。Diff 需两份输入，与单文档视图语义不同；塞进分段器会让"当前视图"的心智失效 |
| 单条上限 | ① 存全文 ② 超 256KB 只存摘要 | **选 ②**。一个 5MB 响应就吃掉半个配额，连带打死偏好设置 |
| 面板 | ① 新造 diff 面板 ② 复用 feature 3 的 `panel.js` | **选 ②**。两处各造一套是重复资产；如左右分栏超出能力则扩展它 |

## 风险点

- **数组按索引对齐会误报**: 列表头部插入一个元素 → 后续全部元素被判为 `changed`。这是首版的已知缺陷，用户在"对比两次 API 列表响应"这个主场景下就会撞上。**若反馈强烈需上 LCS**，届时是独立 feature。
- **配额耗尽的静默失败**: 现有 `store` 封装用 `catch {}` 吞错误，历史撑爆配额时主题/视图设置会静默写不进去且无人知晓。本 feature 必须让它可感知。
- **默认关 → 入口空**: "从历史选两条"在默认状态下永远是空的，用户可能以为功能坏了。空态引导文案是唯一缓解。
- **稿件的左栏导航与 feature 1 的 IA 冲突**: 已明确以 feature 1 为准，执行时容易被稿件带偏。
- **拖放全局监听的诱惑**: 最简单的写法是挂 `document`，但那会劫持任意宿主页的拖放 —— 这是 content script 特有的陷阱。
