# JSON Keeper (v0.14.1)

可信赖的 JSON 查看/格式化插件。重写自 JSONVue,差异化:**有明显粘贴入口 + 一键复制合法 JSON + 大整数永不失真 + 可折叠树/搜索**。设计语言 "Quiet Precision"(浅/深双主题,设计稿见 `design/`)。

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
- 可折叠 JSON 树(caret + 节点数 `n keys`/`n items`)、行号、语法高亮、Collapse/Expand all。
- **节点 hover 复制**:每行浮出 `⧉`(复制值/子树)+ `path`(复制访问路径如 `customer.email`)。
- **真搜索**:高亮 + `1/2` 计数 + ↑↓ 跳转 + 自动展开命中父级;`/` 聚焦。
- **手动主题**:auto / ☀ / ☾ 切换并记住(Pretty/Raw/Min 选择也记住)。
- **左侧结构栏**(点顶层 key 跳转 + 滚动高亮当前区块,扁平 JSON 自动隐藏)+ **面包屑**(`root › customer › email`)。
- **Pretty / Raw / Min** 三态切换;**下载 .json**;可见 Copy(合法JSON);`✓ big-ints precise` 徽章。
- **底部状态栏**:节点数 + 类型统计 + `big integers kept exact · no ads · no telemetry`。
- **大文件保护**:超过 1MB 默认走 Raw,切到 Pretty/搜索时才懒构建树,避免卡死标签页。
- **容错解析**:自动剥离 XSSI 前缀(`)]}'`、`while(1);`)和 JSONP 包裹(`callback({...})`);v0.7 起兼容 **JSONC**(注释)和**尾逗号**。
- **按 key 排序**(递归,A→Z,显示与复制一致)+ **多皮肤**(Default / Solarized / Monokai / GitHub)。[v0.7]
- **正确性提示**[v0.8]:**重复 key 警告**(规范后者覆盖、其余被静默丢弃,我们标出来)+ **大整数计数徽章**("✓ N big-ints exact",在别处会被四舍五入)。这是别家没认真做的可信赖护城河。
- **更多正确性诊断**[v0.9]:**数字溢出提示**(超出 float64 范围 → 变成 `Infinity` → 合法 JSON 无 `Infinity`,序列化回 `null` 静默丢数据,我们标出来)+ **浮点丢精度提示**(有效位超过 float64 能表示的范围,复制出来已不等于你粘贴的值);畸形数字(如孤立的 `-`)给出带位置的 `SyntaxError` 而非晦涩报错。
- **值可读性**[v0.10]:字符串里的 **http/https 链接可点击**(严格限定 scheme + href 属性转义,杜绝 `javascript:`/`data:` 注入)+ 疑似 **Unix 时间戳**(epoch 秒/毫秒)的数字 hover 显示人类可读 UTC 时间(纯提示,无视觉噪音)+ **搜索输入防抖**(大树逐字输入不再卡顿)。
- **嵌套 JSON 字符串内联展开**[v0.11]:字段值本身是被转义的 JSON 字符串(真实 API 响应极常见)时,自动识别并作为可折叠子树**内联展开**,带 `{ } JSON string` 徽章、**默认折叠**保持整洁;折叠/搜索/复制全部复用现有机制(复制得到解析后的 JSON)。检测有首尾字符快速判定 + 体积上限,不影响普通字符串性能。
- **大数字千分位提示**[v0.12]:大整数(BigInt)与较大整数 hover 显示带千分位分隔的可读形式(如 `136,986,234,663,732,436`),便于核对位数。
- **搜索命中子串高亮**[v0.13]:命中处用 `<mark>` 实际高亮(此前仅淡化非命中行),只切分文本节点、不破坏语法高亮 span 与折叠监听器;切换查询时干净清除并重新合并文本节点,跨旧切分边界仍可命中。
- **按层级展开**[v0.14]:工具栏新增 `Depth` 下拉(仅当存在多层嵌套时出现),一键把整棵树折叠/展开到指定深度(深度 ≥ N 的容器折叠、更浅的展开),与 Collapse/Expand all 联动。`buildTree` 给每个容器 caret 标注深度并返回 `maxDepth`。
- **审查修正**[v0.14.1]:对抗式 review 后修复——丢精度诊断对尾随零的圆整数误报(`1.000…`)、畸形浮点(`1e`、`1e+`)被当作有效值/误计入溢出、`\u` 转义对非十六进制或截断输入静默产出 NUL;搜索改为单趟扫描(去掉 O(n²) 成员判定),深度下拉与"折叠全部"按钮的状态/标签去歧义。
- **安全**:所有用户数据经 `esc`/`escAttr` 转义(含属性上下文),无注入面;零网络、零遥测、无远程代码。
- UI 设计语言:B(Linear 冷静)底 + A(IDE 结构栏/状态栏)+ C(信任文案);浅/深双主题。设计探索见 `design/`。

## 已知限制(后续迭代)
- 超大 JSON 虚拟滚动(性能)= P2,未做;极大文件可能卡。
- `file://` 需用户手动授权(扩展无法代勾)。
- 仅 Chrome。

## 结构
- `manifest.json` — MV3,content script(`jsonbig.js`+`core.js`+`content.js`)注入 http/https/file。`key` 钉死本地 ID。
- `jsonbig.js` — 保真大整数的 JSON parse/stringify(核心正确性)。
- `core.js` — 共享渲染:高亮树 + 工具栏(Copy 合法JSON / Raw 原始源)。
- `content.js` — 检测 JSON 文档→**先解析成功再替换页面**(失败不动原页)。
- `popup.html/js` — 粘贴入口 → 存 storage、开 `viewer.html`。
- `viewer.html/js` — 独立粘贴/格式化工作台。
- `viewer.css` — 接管页 + viewer 页共用样式(含深色)。

## 测试
- `npm test`(零依赖):
  - `test/jsonbig.test.js` —— 核心 `parse`/`stringify`:大整数保真与计数、重复 key、溢出/丢精度诊断、畸形数字报错、JSONC(注释 + 尾逗号)、转义往返与控制字符、Pretty/Min。
  - `test/core.test.js` —— 视图纯函数 `linkify`/`epochHint`/`embeddedJSON`/`groupDigits`:URL 仅 http(s) 可点、其余 scheme 拒绝、注入面转义,时间戳 UTC 格式与边界,嵌套 JSON 字符串的识别与快速拒绝,千分位分隔与非整数兜底。
  - `test/tree.test.js` —— 借 `test/dom-stub.js`(零依赖 DOM 桩)在 node 下跑真实 `buildTree` 渲染路径:类型/节点计数、折叠隐藏与展开恢复、嵌套 JSON 内联展开(徽章 + 默认折叠 + 计入解析结构)、深度标注与 `applyDepth` 按层级折叠。
  - `test/highlight.test.js` —— 搜索高亮手术 `markText`/`clearMarks`:命中包裹与计数、保留嵌套结构、清除后文本还原、跨旧切分边界重搜可命中。
  - 重构前的安全网。共 113 条断言。
