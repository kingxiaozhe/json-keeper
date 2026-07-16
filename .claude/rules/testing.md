---
description: 本项目无自动化测试框架，改动靠固定的手动冒烟清单 + 正确性夹具兜底
---

# 测试规范

## 现状（不要假装有测试）

- **无测试框架、无 CI、无覆盖率**。README「测试」一节提到的 `src/json-keeper-smoke.mjs` **在仓库中不存在**，不要引用它作为通过证据。
- 因此：**任何声称「测试通过」的说法必须来自下面的手动清单实跑**，不得从代码推断。

## 引入自动化测试时（尚未发生）

- 首选 Node 内置 `node:test` + `node:assert`，`*.test.mjs` 放 `tests/`，命令 `node --test tests/`。理由：与零依赖原则一致，不引 Vitest/Jest 及其依赖树。
- `jsonbig.js` 是纯函数、无 chrome API 依赖，可直接 import 测——**优先补它**，它承载全部正确性叙事。
- DOM 层（core/content）需要 chrome API 打桩，成本高，非必要不做。
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
