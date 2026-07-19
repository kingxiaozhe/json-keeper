# JSON Keeper (v0.10.0)

可信赖的 JSON 查看/格式化插件。重写自 JSONVue,差异化:**有明显粘贴入口 + 一键复制合法 JSON + 大整数永不失真 + 可折叠树/搜索**。设计语言 "Quiet Precision"(浅/深双主题)。

## 加载（手动）
1. `chrome://extensions` → 开**开发者模式**
2. **加载已解压的扩展程序** → 选 `json-keeper/` 目录
3. 看本地 `.json` 文件需在该扩展上勾**"允许访问文件网址"**

## 三个 P0(对标 JSONVue 的根因)

| P0 痛点(JSONVue) | 根因(逆向确认) | JSON Keeper 的修法 |
|---|---|---|
| "用不了/不知道怎么用"(44) | 纯页面转换器,**无 popup、无粘贴框、无入口** | **popup 粘贴框** + 独立 viewer 页;JSON 网址仍自动美化 |
| 吐不回合法 JSON / View Source 坏(25) | 复制藏在右键菜单;切不回原文 | 树视图上**可见的 Copy(合法JSON)/ Raw(原始源)按钮** |
| 大整数被四舍五入(8) | `supportBigInt` 选项默认关,走原生 `JSON.parse` | **默认 BigInt 保真**(`jsonbig.js`,显示+复制都不失真) |

## 本版已含
- **左右分屏工作台**[v0.10]:左栏是**可编辑的源码**、右栏是格式化树,中间**可拖拽分隔条**(双击复位,比例跨会话记住)。左栏改字,右栏树/结构/状态实时跟随(防抖);坏 JSON 就地标红报错、**保留上一版好树**不清空。取代了旧的 Raw/Min 视图标签——源码常驻左侧,不必再切模式看原文;`Min` 变成 ⋯ 里的 **Copy minified**。
- 可折叠 JSON 树(caret + 节点数 `n keys`/`n items`)、行号、语法高亮、Collapse/Expand all。
- **节点 hover 复制**:每行浮出 `⧉`(复制值/子树)+ `path`(复制访问路径如 `customer.email`)。
- **真搜索**:高亮 + `1/2` 计数 + ↑↓ 跳转 + 自动展开命中父级;`/` 聚焦。
- **手动主题**:auto / ☀ / ☾ 切换并记住(Pretty/Table 视图选择也记住)。
- **结构大纲抽屉**[v0.10]:工具栏 `☰` 弹出顶层 key 大纲(点击跳转 + 滚动高亮当前区块,扁平 JSON 自动隐藏该按钮)+ **面包屑**(`root › customer › email`)。
- **Pretty / Table** 视图切换;**下载 .json**;可见 Copy(合法JSON);`✓ big-ints precise` 徽章。
- **底部状态栏**:节点数 + 类型统计 + `big integers kept exact · no ads · no telemetry`。
- **大文件保护**:超过 1MB 时右栏不自动建树、给出 **Build tree** 入口(源码仍在左栏可读),避免卡死标签页。
- **容错解析**:自动剥离 XSSI 前缀(`)]}'`、`while(1);`)和 JSONP 包裹(`callback({...})`);v0.7 起兼容 **JSONC**(注释)和**尾逗号**。
- **按 key 排序**(递归,A→Z,显示与复制一致)+ **多皮肤**(Default / Solarized / Monokai / GitHub)。[v0.7]
- **正确性提示**[v0.8]:**重复 key 警告**(规范后者覆盖、其余被静默丢弃,我们标出来)+ **大整数计数徽章**("✓ N big-ints exact",在别处会被四舍五入)。这是别家没认真做的可信赖护城河。
- **JSONPath 查询栏**[v0.9]:输入 `$.users[*].email` 筛出子集,`N matches` 计数 + 清除出口;语法错误就地提示、**保留上一次结果**;自研求值器,**禁 eval**,大整数原样穿过。
- **表格视图**[v0.9]:数组型 JSON 用表格看,列 = 各元素 key 并集(首次出现顺序);**字段缺失渲染为弱色 `—`、值为 `null` 渲染为 `null`,视觉可区分**(别家都渲染成空白,让人误判接口行为);嵌套 `{…}`/`[N]` 点开子树面板;超 1000 行诚实截断提示。
- **Schema / TypeScript 导出**[v0.9]:从当前 JSON 反推 **JSON Schema**(Draft 2020-12)与 **TypeScript 类型定义**,可复制/下载;**推断不确定处显式写进产物**——空数组 `unknown[]`(不是 `any[]`)、大整数 `bigint`(不是 `number`,不丢精度)、联合类型、只见过 null,都带 ⚠ 标注,不假装确定。
- **Schema 校验**[v0.9]:贴入一份 JSON Schema 校验当前文档,错误**定位到具体节点并在树上标红**、点击跳转;大整数正确判为 `integer`/`number`(不误伤招牌数据);未支持的断言型关键字**明确提示**而非静默放过;循环 `$ref` 不卡死;远程 `$ref` 拒绝(零网络红线)。
- **安全**:所有用户数据经 `esc`/`escAttr` 转义(含属性上下文),无注入面;零网络、零遥测、无远程代码。
- UI 设计语言:B(Linear 冷静)底 + A(IDE 结构栏/状态栏)+ C(信任文案);浅/深双主题。

## 已知限制(后续迭代)
- 超大 JSON 虚拟滚动(性能)= P2,未做;极大文件可能卡。
- `file://` 需用户手动授权(扩展无法代勾)。
- 仅 Chrome。

## 结构
MV3,零依赖、零构建。content script 按 manifest 顺序注入 http/https/file;每个文件是一个 IIFE,挂 `window.JK` / `window.JSONBig`。`manifest.json` 的 `key` 钉死本地 ID。核心正确性资产(全部自研、禁 eval、零网络):
- `jsonbig.js` — 保真大整数的 JSON parse/stringify + 诊断(重复 key / big-int 计数)。
- `jsonpath.js` — JSONPath 查询求值器(query 用)。
- `schema-infer.js` / `schema-validate.js` — Schema/TS 推断与 JSON Schema 校验。
渲染与 UI 拆成:`util` · `tree` · `toolbar` · `search` · `rail`(结构大纲抽屉)· `status` · `query` · `table` · `panel` · `split`(左右分屏拖拽分隔条)· `export-panel`(Schema/TS 导出与校验菜单)· `core`(编排,挂 `mountViewer`)。
- `content.js` — 检测 JSON 文档 → **先解析成功再替换页面**(失败不动原页)。
- `popup.html/js` — 粘贴入口 → 存 storage、开 `viewer.html`。
- `viewer.html/js` — 独立粘贴/格式化工作台。
- `tokens.css` + `viewer.css` — 设计 token(四层主题机制)+ 组件样式(接管页与 viewer 页共用)。

## 测试

**自动化**(v0.8 起,零依赖):`node --test "tests/*.test.mjs"`(引号必须有)——Node 内置 `node:test`,不引 Vitest/Jest。覆盖 `jsonbig`(大整数保真/诊断)、`jsonpath`、`schema-infer`/`schema-validate`(三个自研正确性资产,单测是唯一防线)、转义防线,以及 DOM 层用手写桩验装配。

**手动冒烟**(发版前必跑):`.claude/rules/testing.md`——DOM 桩测不到的渲染/交互层由它兜底。**尤其:content script 接管真实 JSON 网址、不误伤普通页、popup 作为弹窗、打包产物,是独立代码路径,必须在加载解压扩展后单独验**(自动化测试与 harness 都覆盖不到)。
