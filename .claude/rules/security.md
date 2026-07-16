---
description: 扩展安全红线：签名私钥不入库、注入页面零信任转义、零网络零遥测不可破
---

# 安全规范

本扩展以 content script 身份注入**任意 http/https/file 页面**，并渲染**完全不可信的 JSON**。攻击面就两处，但两处都致命。

## 密钥与凭据

- `*.pem`（Web Store 签名私钥）已在 .gitignore，**任何情况下不得提交、不得移出忽略、不得贴进对话或 commit**。泄露 = 他人可发布冒名更新覆盖用户。
- `manifest.json` 里的 `key` 字段是**公钥**（用于钉死本地扩展 ID），入库是正确的，别把它当密钥删掉。
- 本项目无后端、无 API key、无 .env。若将来出现，一律环境变量 + .gitignore，不进扩展包（打进包 = 明文发给所有用户，扩展包人人可解压）。

## 渲染不可信数据（XSS —— 头号风险）

- 进入 HTML 的每一个用户串，**文本位置走 `esc()`，属性位置走 `escAttr()`**。JSON 的 key、value、path 全部算用户串。
- 新增任何 `innerHTML` 拼接前，问：这里能出现攻击者控制的字符串吗？能 → 必须转义；不确定 → 当作能。
- 优先 `textContent` / `createElement`；`innerHTML` 只在批量建树的性能路径上使用（现状如此）。
- **禁止** `eval`、`new Function`、`setTimeout("字符串")`、`javascript:` URL、注入 `<script>`。MV3 CSP 也禁，但别指望 CSP 兜底。

```js
// Bad：key 进了 title 属性没转义 —— 一个 key 叫 `" onmouseover="alert(1)` 就在别人的页面上执行了
el.innerHTML = '<span title="' + path + '">' + esc(key) + "</span>";

// Good
el.innerHTML = '<span title="' + escAttr(path) + '">' + esc(key) + "</span>";
```

## 不误伤宿主页（完整性）

- content.js 必须**先解析成功、再替换页面**（解析进 detached 节点，`ok` 为真才 `body.appendChild`）。任何改动不得让「解析失败」路径动到原页面 DOM。
- 接管判定只认：`content-type` 含 json，或整页是单个 `<pre>` 且内容形如 JSON。**不得放宽**成「页面里有 JSON 就接管」。

## 零网络 · 零遥测（产品承诺，写进了商店页与状态栏）

- **禁止**任何 `fetch` / `XMLHttpRequest` / WebSocket / 远程脚本 / 远程字体 / CDN / 分析 SDK / 错误上报。
- 数据只进 `chrome.storage.local`，只存用户偏好与 `jk:pending` 交接串；`jk:pending` 用完立即 `remove`。
- **禁止**记录、拼接、外传用户 JSON 内容 —— 它常是生产 API 响应，含 token 与个人信息。调试用的 `console.log(json)` 也不许留在提交里。

## 权限最小化

- `permissions` 现为 `["storage"]`，`host_permissions` 为 http/https/file。**加任何权限前先问是否真的必要**：新权限会触发 Web Store 重新审核，并让所有用户看到「新权限」告警弹窗，是掉量与掉信任的直接原因。
- 尤其禁止随手加 `tabs`（现有 `chrome.tabs.create` 用的是免权限的 action 上下文能力）、`<all_urls>` 之外的敏感权限、`declarativeNetRequest`。

## 发布前检查

- 打包命令排除 `*.pem`、`.git`、`.claude`、`store-assets`；解压产物自查一遍再上传。
- `grep -rnE "fetch\(|XMLHttpRequest|eval\(|new Function" *.js` 应无命中（除非是注释里的禁令说明）。
