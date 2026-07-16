# 修复模式与虚拟滚动 — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| ---- | ---- | ---- |
| 2026-07-16 | v1 | 初始设计 |

## 项目架构

- 架构类型: 单体前端应用（Chrome MV3 扩展）
- 涉及层: 内容脚本 · 扩展页面 · 样式层。无后端。

## 设计基准

- **无基准**。Stitch 未生成本组功能的界面稿，经人工确认：UI 由前端按本文档自行实现，**不生成 UI 还原任务**。
- 须遵循 feature 1 的 token 与组件样式。

## 波及面（B2）

| 改动目标 | 谁引用它 | 可能受影响的老功能 |
| --- | --- | --- |
| **`jsonbig.js` 的 `err()` 增加行列信息** | `core.js` 的 `mountViewer` catch 分支；`content.js` 经 `mountViewer` 返回值判定 | **这是唯一被本 feature 修改的正确性核心资产**。改错 → 解析行为变化 → 接管判定失效。现有 `err()` 抛 `SyntaxError(msg + " at position " + i)`，**`position` 已有，只需加行列换算** —— 不动解析逻辑本身 |
| `tree.js` 改为虚拟渲染 | `rail.js` 的 `t.head.offsetTop` 滚动定位；`search.js` 的 `matches` 行集合与 `scrollTop` 跳转；`table.js`（feature 2）的 `jumpTo` | **结构栏跳转、搜索跳转、逐行 hover 复制** —— 三者全部依赖"所有行都在 DOM 里"这个前提。虚拟滚动打破该前提，**这是本 feature 最大的波及面** |
| `mountViewer` 的错误分支 | `content.js`（`showErrors:false` 时返回 `false` 不替换页面） | **接管安全约束**：修复模式只能在 viewer/popup 出现，**接管页解析失败仍必须不动宿主页** |

**不改动**: `content.js` 的接管判定、`history.js`、`schema-*.js`。

## 功能模块设计

### 模块 1: jsonbig.js 行列定位（F-401）

现状: `function err(msg) { throw new SyntaxError(msg + " at position " + i); }`。

**⚠ 原方案的"position 已经有了，只需加行列换算"不成立**（对抗审查纠正）—— **有非 `err()` 的抛错路径**:

| 输入 | 实际路径 | 结果 |
| --- | --- | --- |
| `{"a": -}` | `lit = "-"` → `Number("-")` = NaN → 非 safe integer → `BigInt("-")` 抛**原生** `SyntaxError: Cannot convert - to a BigInt`（`jsonbig.js:102-116`，**不走 `err()`**） | 无 `position`/`line`/`col` |
| 深嵌套 JSON | `value()` 递归 → `RangeError: Maximum call stack size exceeded` | 同上 |

**后果**: 错误面板显示"第 undefined 行第 undefined 列"；`JK.repair.suggest(text, err)` 的规则探测（"出错位置附近为 `'`"）全部无从下手。

**故 `err()` 加字段不够，`parse()` 需要一层统一的错误包装**:
```js
function parse(text, diag) {
  let i = 0;
  try {
    /* ...现有解析主体不动... */
  } catch (e) {
    if (e.position === undefined) {          // 原生 SyntaxError / RangeError 兜底
      e.position = i;                        // i 是闭包里的当前位置，仍然可用
      Object.assign(e, posToLineCol(text, i));
    }
    throw e;
  }
}
```

**最小改动原则**（这是正确性核心资产，动它必须克制）:
```js
function posToLineCol(text, pos) {   // 新增纯函数，不碰解析主流程
  let line = 1, col = 1;
  for (let k = 0; k < pos && k < text.length; k++) {
    if (text[k] === "\n") { line++; col = 1; } else col++;
  }
  return { line, col };
}
function err(msg) {
  const e = new SyntaxError(msg + " at position " + i);
  e.position = i;                     // 新增：结构化字段
  Object.assign(e, posToLineCol(text, i));
  throw e;                            // message 保持原样 —— 现有测试与调用方依赖它
}
```
**约束**: `message` 文案**不得变更**（防护网基线锁了它）；只新增 `position`/`line`/`col` 字段。

### 模块 2: repair.js（F-402/F-403）

**候选修复规则**（每条 = 探测 + 变换 + 人话说明）:

| 规则 | 探测 | 变换 | 说明文案 |
| --- | --- | --- | --- |
| 单引号 | 出错位置附近为 `'` | `'…'` → `"…"`（**仅在字符串外层，不碰字符串内部的撇号**） | `JSON 只认双引号` |
| 无引号 key | 出错位置前为 `{` 或 `,` 且遇标识符 | `{a:1}` → `{"a":1}` | `JSON 的 key 必须带双引号` |
| 被截断 | 解析到文本末尾仍有未闭合的栈 | 按栈补 `]` / `}` | `JSON 在这里断了 — 补齐 N 个括号` |
| 尾逗号 | — | — | **不实现**：`jsonbig.js` 已容错（v0.7 起），不会走到修复模式。AC-402 因此改验组合场景 |

**核心纪律（F-403）**: `repair.js` **只产出候选，绝不自动应用**。

```js
JK.repair.suggest(text, err) // → [{id, label, explain, preview: {text, ops}}]
```
- 每个候选自带 `preview.text`（修复后的全文）与 `ops`（差异位置）。
- **差异计算复用 feature 4 的 `jsondiff.js`？→ 不行**：修复前的文本**根本解析不了**，无法结构化 diff。故预览用**文本级差异**（这是文本 diff 唯一正当的场景 —— 见技术决策）。
- 应用 = 用户点确认后，把 `preview.text` 灌回输入框，**并重新走一遍完整解析**（不信任修复器的自我声明）。

### 模块 3: 错误面板 UI（F-401/F-403）

- 位置: viewer 页与 popup 的错误态（**接管页不出现** —— 接管页解析失败必须不动宿主页）。
- 内容:
  - 原文视图（等宽 + 行号），出错行高亮，列位置用插入符标出。
  - 错误摘要: `第 2 行第 6 列：Unexpected token }`（原文片段必须 `esc()`）。
  - 修复建议列表，每条可点。
- 预览（F-403）: 点建议 → 面板内展示前后对比（差异高亮）→ `应用` / `取消`。**未确认前输入框原文不变**。

### 模块 4: vlist.js 虚拟滚动（F-404/F-405）

**这是本 feature 风险最高的部分** —— 它打破了"所有行都在 DOM 里"这个被三处依赖的前提。

**设计**:
```
buildTree 改为两段：
  ① build model → 扁平行数组 rows[] = [{depth, html, apath, crumb, val, lineNo, visible}]
     （lineNo 在建模时一次算定 → F-405 行号连续性天然成立）
  ② render window → 只渲染视口内 ± 缓冲区的行，用 padding-top/bottom 顶出滚动高度
```

**行高**: 固定行高（现有树本就是等高行）→ 可用 `index * ROW_H` 直接换算位置，无需测量。这是能做虚拟滚动的前提，也是不引入依赖的原因。

**折叠**: 折叠 = 把子树行的 `visible=false` → 重算可见行索引映射。**不能再用 `style.display='none'`**（虚拟渲染下 DOM 里根本没有那些行）。

**依赖方是七处，不是三处**（对抗审查纠正 —— 原方案漏了后四行，每条都有具体崩溃现象）:

| # | 依赖方 | 现状 | 虚拟化后的具体故障 | 改造 |
| --- | --- | --- | --- | --- |
| 1 | `rail.js` **跳转** | `scrollEl.scrollTop = t.head.offsetTop - 6`（`core.js:237`） | 目标行未挂载 → `offsetTop` 为 0 → 滚到页顶 | → `tree.scrollToIndex(i)` |
| 2 | `rail.js` **scroll-spy**（**漏了 —— 与跳转是两段独立代码**） | 每滚动帧跑 `topLevel.forEach(t => if (t.head.offsetTop <= y) active = i)`（`core.js:243-250`） | **detached 元素的 `offsetTop` 恒为 0** → `0 <= y` 对所有项成立 → **结构栏永远高亮最后一个 key**。若改成 head 置空则每帧 TypeError | → 按模型索引区间判定 active，不读 DOM |
| 3 | `search.js` 匹配 | 遍历 `.jk-row` 的 `textContent` | 窗口外的行搜不到 | → 模型层匹配 `rows[].text`（**但复杂度必须一并修，见下**） |
| 4 | hover 复制 / `jumpTo` | 依赖行 DOM 上的 `_apath`/`_val`（`core.js:75`） | 行未挂载 → 取不到 | → 从 `rows[i]` 取，DOM 只做展示 |
| 5 | **Collapse all**（**漏了**） | `carets()` = `prettyEl.querySelectorAll(".jk-caret:not(.jk-leaf)")`（`core.js:218`）；`foldBtn.style.display = carets().length ? …`（`core.js:260`） | 点 Collapse all → **只折叠当前窗口内那 ~50 行的 caret**，滚下去全是展开的；再点变成 Expand all 作用在**另一批**行上 → **树进入无法复位的混合态，按钮文案还在说谎** | → 折叠走模型 `visible`；`hasContainers` 从模型算，不查 DOM |
| 6 | **行级 class 状态**（**漏了**） | `jk-dim`/`jk-current`/`jk-hit` 全靠给 DOM 行加类（`core.js:342-354`） | 节点复用会把上一行的 `jk-dim`/`jk-current` 带到无关行上；滚回来高亮没了 | → 类由模型驱动**重放**，每次渲染窗口时按 `rows[i].flags` 重新施加 |
| 7 | **feature 3 的 `markInvalid`**（**漏了 —— 波及面写"不改动 schema-*.js"字面成立，但契约废了**） | `tree.markInvalid(apath[])` 加 `jk-invalid` 类，前提是行常驻 DOM | 校验标红定位全废 | → 同 #6，走模型 flags |

**启用阈值**: > 5000 行才启用虚拟渲染（小文件直接全量渲染，避免为小 JSON 引入复杂度与滚动抖动）。

### 搜索的复杂度必须一并修（否则 AC-408/410 达不成）

**对抗审查发现**: 虚拟滚动救不了搜索 —— 瓶颈跟行在不在 DOM 里**无关**。`core.js:347-359`:
```js
matches = [...prettyEl.querySelectorAll(".jk-row")].filter(...)
prettyEl.querySelectorAll(".jk-row").forEach((r) => { if (!matches.includes(r)) r.classList.add("jk-dim"); });
```
`matches.includes(r)` 在循环里 → **O(n×m)**。且 `input` 事件**直接触发，无防抖**（`core.js:359`）。

**失败场景**: AC-408 的 10MB JSON ≈ 40 万行，搜 `"e"` 命中约 20 万 → **8×10¹⁰ 次比较，每敲一个字符跑一次** → 标签页挂死。照搬原形状（filter + includes）只换数据源不换复杂度，AC-408（滚动 ≥30fps）与 AC-410（搜索跳转）在 10MB 上都做不到。

**必须的修正**（并入本 feature，不能留给"以后"）:
- `matches` 用 `Set` 或在模型行上打 `flags.match` 布尔位 → O(n)。
- `input` 加 **150ms 防抖**。
- 搜索的"全量展开"（`_collapse(false)`）在模型层是把 40 万行 `visible` 全置 true → 每次击键重算全量可见索引 + 容器高度从几万 px 跳到 ~8.6M px → **滚动位置在击键间乱跳**。故: 展开只针对**命中项的祖先链**，不做全量展开（这同时修好了现状"清空搜索后折叠状态不恢复"的老毛病）。

## 接口契约

| 组件 | 入参 | 返回 |
| --- | --- | --- |
| `JSONBig.parse(text, diag)` | 不变 | 抛错时 error 新增 `position`/`line`/`col`；**`message` 不变** |
| `JK.repair.suggest(text, err)` | 原文 + 错误对象 | `[{id, label, explain, preview:{text, ops}}]` |
| `JK.repair.apply(text, id)` | — | 返回修复后文本；**调用方须重新解析验证** |
| `JK.vlist.mount(el, rows, {rowHeight})` | 扁平行模型 | `{scrollToIndex(i), setVisible(fn), refresh(), destroy()}` |
| `JK.tree.buildModel(value)` | 值 | `rows[]`（供 vlist 与 search 共用） |
| `JK.tree.jumpTo(apath)` | 路径 | 内部改走 `scrollToIndex`；对外签名不变（feature 2 依赖） |

## 数据模型

无新增 storage 键。

## 安全考虑

- **修复不得静默改数据（F-403 是安全要求）**: 用户的 JSON 可能是生产数据；工具擅自"修好"再展示，等于篡改证据。必须预览 + 确认 + 重新解析验证。
- **XSS**: 错误面板会把**原始坏文本**渲染出来 —— 这是全项目最直接的注入面（坏 JSON 里可以塞任意 HTML）。原文视图必须 `esc()`，逐字符高亮时尤其注意不要在转义后再拼未转义片段。
- **接管页不启用修复模式**: 接管页解析失败必须保持"不动宿主页"（`content.js` 的安全约束），不得因为要显示错误面板而替换页面。
- **单引号修复的边界**: 变换必须只作用于字符串**外层**引号；`{'a':"it's"}` 里 `it's` 的撇号不能被动 —— 改坏用户数据比不修更糟。
- **零网络**: 无新增外部资源。

## 技术决策

| 决策 | 选项 | 理由 |
| ---- | ---- | ---- |
| 行列信息 | ① 重写 parser 记录行列 ② 复用已有 `position` 换算 | **选 ②**。`jsonbig.js` 是正确性核心，动解析主流程风险极高；`position` 已存在，换算是纯函数 |
| `err()` message | ① 改成含行列 ② 保持不变，新增字段 | **选 ②**。防护网基线锁了 message；调用方可能依赖文案。新增结构化字段是非破坏性的 |
| 修复预览的差异 | ① 复用 `jsondiff.js` ② 文本级差异 | **选 ②**。修复前的文本**解析不了**，结构化 diff 无从谈起。这是文本 diff 唯一正当的场景 |
| 尾逗号修复 | ① 实现 ② 不实现 | **选 ②**。`jsonbig.js` v0.7 起已容错尾逗号与 JSONC 注释，根本走不到修复模式。实现它是死代码 |
| 修复应用 | ① 直接改输入 ② 预览 + 确认 + 重新解析 | **选 ②**。①是篡改用户数据；且不重新解析就是信任修复器的自我声明 |
| 虚拟滚动行高 | ① 动态测量 ② 固定行高 | **选 ②**。现有树本就等高行；固定行高使 `index × ROW_H` 直接换算，无需 ResizeObserver，也是零依赖自研可行的前提 |
| 虚拟滚动阈值 | ① 全量启用 ② > 5000 行才启用 | **选 ②**。小 JSON 引入虚拟渲染只会带来滚动抖动与复杂度，没有收益 |
| 折叠实现 | ① `display:none` ② 模型层 `visible` 标记 | **选 ②**。虚拟渲染下折叠的行根本不在 DOM 里，`display:none` 无从施加 |
| 行号 | ① 按渲染窗口重新计数 ② 建模时一次算定 | **选 ②**（人工确认的技术决策）。① 会让行号随滚动变化，"复制路径"与搜索跳转的心智模型直接断裂 |

## 风险点

- **虚拟滚动是本轮最危险的改动**: 它打破"所有行都在 DOM 里"的前提，而 `rail.js` 跳转、`search.js` 匹配、hover 复制、feature 2 的 `table.jumpTo` **四处**都依赖该前提。改造面比"加个虚拟列表"直觉上大得多。
- **与 feature 2 的表格截断需统一**: feature 2 用"前 1000 行 + 提示"兜底，本 feature 上虚拟滚动后应回来统一，否则同一个产品里两套长列表策略。
- **动了 `jsonbig.js`**: 全项目唯一的正确性核心。虽然只加字段不动主流程，但防护网基线必须在改前后各跑一次。
- **错误面板是最直接的注入面**: 它渲染的是**任意坏文本**，比正常 JSON 更容易塞进 HTML。
- **单引号修复可能改坏数据**: 字符串内的撇号被误换 → 用户数据被破坏且不易察觉。此规则的探测必须保守，宁可不给建议。
