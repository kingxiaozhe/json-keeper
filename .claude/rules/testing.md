---
description: 本项目无自动化测试框架，改动靠固定的手动冒烟清单 + 正确性夹具兜底
---

# 测试规范

## 自动化测试（v0.8 起有了，T-001 建立）

```bash
node --test "tests/*.test.mjs"     # 引号必须有
```

- **不要写 `node --test tests/`** —— Node 24 会把目录当模块解析，报 `MODULE_NOT_FOUND`。glob 必须加引号，否则 shell 先展开、Node 收到多个路径时行为不一致。
- 框架：Node 内置 `node:test` + `node:assert/strict`，零依赖，与项目的零依赖原则一致（不引 Vitest/Jest 及其依赖树）。
- 加载被测代码走 `tests/_load.mjs` —— 源码是 IIFE 挂 `window`，Node 里靠 `new Function(src)` 求值后挂到 `globalThis`。**不为了可测性改造源码**。
- 覆盖现状：`jsonbig.js`（大整数保真 / 诊断 / 容错 / 报错）、`normalize`（XSSI / JSONP）、`esc`+`escAttr`（XSS 防线）。
- DOM 层（tree/rail/search/content）需要 chrome API 与 DOM 打桩，成本高 —— 由下面的手动冒烟清单兜底。

### 防护网纪律（B3）

- 这些测试是**特征化测试**：锁的是"今天它就是这么干的"，**不是"它应该这么干"**。
- 因此**已知缺陷也照实锁住并标注 `[现状缺陷]`**（如 `[1e]` → `NaN` → Copy 出 `null`）。修复它们时必须**显式地改测试** —— 那个动作就是让改动被看见的机制。
- 改动存量模块前后各跑一次。**变红 = 碰坏了老行为**，不是"测试过时了"。
- browser_driver: chrome-mcp（cm-qa-engineer 读取本字段；本项目是扩展，Playwright 需额外加载解压扩展的配置）

### ⚠ 自动化测试测不到什么（别高估它）

产品用 `innerHTML` 字符串建 UI，而 `tests/_dom.mjs` 是手写桩、**不解析 HTML** —— 所以 `$('[data-act="fold"]')` 这类查询拿到的是幻影元素。**凡依赖工具栏按钮的行为，自动化测试一律测不到**（实测：把 Collapse all 变成死键、删掉 `rail.render()`、`currentView()` 硬编码 —— 变异全部存活）。

不引 jsdom 是有意的：这个扩展的立身之本是零依赖、无远程代码、审核可读，为测试拉进几十个传递依赖与之冲突。

**代价是下面第 11–15 项必须人工跑，它们是那一层唯一的网。**

## 手动冒烟清单（每次发版前全跑，改哪块至少跑对应项）

1. **接管**：起本地 JSON（`python3 -m http.server` + 一个 .json）→ 访问 → 页面被树视图接管。
2. **不误伤**：访问任意普通 HTML 页（如 example.com）→ 页面**完全不变**。这是 content.js 的红线。
3. **大整数保真**：喂 `{"id": 136986234663732436}` → 树里显示原值不是 ...430，`✓ N big-ints exact` 徽章出现，Copy 出来的文本粘回去仍是原值。
4. **合法可复制**：Copy 的结果能被 `JSON.parse` 接受（BigInt 不带引号、不带 `n` 后缀）。
5. **Raw / Pretty / Min 三态**：Raw 显示原始源（含 XSSI 前缀原样），切换不丢数据。
6. **重复 key 警告**：喂 `{"a":1,"a":2}` → 出现 `⚠ 1 duplicate keys — last value shown`，显示值为 2。
7. **容错解析**：`)]}'`前缀、`while(1);`、JSONP `cb({...})`、JSONC 注释、尾逗号——各一条，均能解析。
8. **大文件不卡**：> 1MB JSON → 默认 Raw、标签页不冻结；切 Pretty 才建树。
9. **XSS**：喂 `{"<img src=x onerror=alert(1)>": "<script>alert(1)</script>"}` → 页面**无弹窗**，恶意串以纯文本显示（含 hover title 属性内）。
10. **popup → viewer**：粘贴框输入 → 打开 viewer 且内容已渲染；`jk:pending` 已被清除。

> 以下 11–15 项覆盖自动化测试**结构性测不到**的工具栏交互层（见上）。改了 `toolbar.js`/`search.js`/`rail.js`/`core.js` 的装配就必须跑。每一项都对应一个实测存活过的变异 —— 不是假想。

11. **Collapse all 不是死键**：打开嵌套 JSON → 点 `⤢ Collapse all` → 树**真的折叠**、标签变 `⤡ Expand all` → 再点 → 真的展开。（变异「删掉 `ctx.onFold`」自动化测试抓不到。）
12. **Collapse all 的显隐**：喂 `{"a":1,"b":2}`（纯标量顶层）→ 按钮**不出现**；喂嵌套 JSON → 出现。（变异「删掉 `setFoldable`」抓不到。）
13. **结构栏渲染**：喂 3 个以上顶层 key 且有嵌套的 JSON → 左侧 `STRUCTURE` 栏出现、点击能跳、滚动时高亮跟随。（变异「删掉 `rail.render`」抓不到。）
14. **Raw 下搜索能切回**：切到 Raw → 在搜索框输入 → **自动切回 Pretty 并高亮命中**。（变异「`ensurePretty` 空操作」抓不到。）
15. **排序不留悬空状态**：搜一个词（计数显示 `1/N`）→ 点 `⇅ Sort` → **计数清空、搜索框清空**，不再报「1/N」也不再有高亮。折叠后点 Sort → 折叠按钮回到 `⤢ Collapse all`，**一次点击就能折叠**（不是两次）。
16. **结构栏跳转本身能用**：点任一 `STRUCTURE` 条目 → 滚到对应区块、目标行短暂高亮。点**不同**条目要跳到**不同**位置（变异「rail 点击写死 `items[0]`」自动化测试抓不到）。
17. **Raw 下点结构栏会切回 Pretty**：切到 Raw → 点结构栏条目 → **自动切回 Pretty 并定位**。（`setView("raw")` 不隐藏 `railEl`，所以结构栏在 Raw 下仍在屏幕上。变异「`jumpToPath` 删掉 `setView`」抓不到。）
18. **点结构栏不改视图偏好**：在 Raw 下点结构栏（会切到 Pretty）→ **关掉标签页重开一个 JSON → 仍应是 Raw**。导航不该改写跨会话偏好。
19. **折叠块不漏内容**：`⤢ Collapse all` → 手动点开某一个块 → 它内部**仍折叠的子块**不该露出内容（caret 显示折叠、内容却可见 = bug）。

## 正确性夹具

新发现的解析边界（诡异 JSON）必须**留样**：追加到清单第 7 项的用例串，或存进 `tests/fixtures/`。本产品卖的是正确性，回归一次就伤根基。

## 禁止

- 用「代码看起来对」代替实跑；用 README 里不存在的脚本充当证据。
- 只在 viewer 页验证就下结论——content script 接管路径（真实 JSON 网址）是独立代码路径，必须单独验。
