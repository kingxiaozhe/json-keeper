# JSON Keeper (v0.2.0)

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

测试:仓库根 `src/json-keeper-smoke.mjs`(本地 http 起 JSON → 验接管 + 大整数保真 + 合法可复制 + Raw 切换)。
