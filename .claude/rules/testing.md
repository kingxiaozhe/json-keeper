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

## 正确性夹具

新发现的解析边界（诡异 JSON）必须**留样**：追加到清单第 7 项的用例串，或存进 `tests/fixtures/`。本产品卖的是正确性，回归一次就伤根基。

## 禁止

- 用「代码看起来对」代替实跑；用 README 里不存在的脚本充当证据。
- 只在 viewer 页验证就下结论——content script 接管路径（真实 JSON 网址）是独立代码路径，必须单独验。
