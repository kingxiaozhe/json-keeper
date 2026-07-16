# JSON Keeper

Chrome MV3 扩展：可信赖的 JSON 查看/格式化器。差异化护城河 = **明显的粘贴入口 + 一键复制合法 JSON + 大整数永不失真 + 正确性提示（重复 key / big-int 计数）**。

## 技术栈

- 语言: JavaScript (ES2020+，无 TypeScript、无转译)
- 框架: 无。原生 Chrome Extension MV3 + 原生 DOM；模块用 IIFE 挂 `window.JK` / `window.JSONBig`（content script 不便 ES import）
- 包管理: 无（零依赖、零 node_modules、零构建步骤 —— 这是刻意的：无远程代码、审核可读）
- 版本控制: remote (github.com/kingxiaozhe/json-keeper)
- 交付形态: 桌面浏览器扩展（仅 Chrome / Chromium，MV3）
- 业务地图: 跳过(小项目，源码 5 个 JS 文件)

## 常用命令

- 安装依赖: 无（零依赖）
- 开发运行: `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选仓库根目录；改完代码点该卡片的 ⟳ 重新加载，content script 改动需刷新目标页
- 构建: `zip -r json-keeper.zip . -x '.git/*' '.claude/*' 'store-assets/*' '*.pem' '.DS_Store'`（打包上传 Web Store；`*.pem` 签名私钥绝不入包）
- 测试: 无自动化测试框架。README 提到的 `src/json-keeper-smoke.mjs` **实际不存在**，见 @rules/testing.md 的手动冒烟清单
- Lint: 无（无 eslint/prettier 配置；风格靠 @rules/coding-style.md 人工保持）

## 目录结构

```
json-keeper/
├── manifest.json      # MV3 清单；key 钉死本地扩展 ID；content script 注入 http/https/file
├── jsonbig.js         # 【正确性核心】保真大整数的 JSON parse/stringify + 诊断(dupKeys/bigInts)
├── core.js            # 【最大文件 373 行】共享渲染：树/搜索/工具栏/结构栏/状态栏，挂 window.JK
├── content.js         # JSON 文档检测 → 先解析成功再替换页面（失败不动原页）
├── popup.html/.js     # 粘贴入口 → 存 storage → 开 viewer
├── viewer.html/.js    # 独立粘贴/格式化工作台
├── viewer.css         # 接管页 + viewer 页共用样式（含深色与皮肤）
├── icons/             # 16/32/48/128 扩展图标
├── docs/privacy.html  # Web Store 要求的隐私政策页
└── store-assets/      # 商店截图等营销素材（不入包）
```

## 规则

@rules/coding-style.md
@rules/testing.md
@rules/security.md
@rules/git-workflow.md
