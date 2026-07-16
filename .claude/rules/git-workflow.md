---
description: 版本即发布的 commit 约定：标题 `vX.Y.Z — 卖点`，正文写「解决了什么/为什么」
---

# Git 工作流

## 分支

- 主分支 `main`，有远程 `origin`（github.com/kingxiaozhe/json-keeper）
- 历史是线性的、直接在 main 上推进（4 个 commit 全在 main）。功能性改动可直接在 main 提交；较大改动开 `feature/xxx` 或沿用 `claude/xxx` 命名后合回。
- 合并方式：保持线性（rebase 或 squash），不制造 merge commit

## Commit（本项目风格 ≠ conventional commits，别改成 feat:/fix:）

- **发版 commit 标题**：`vX.Y.Z — 本版卖点，逗号分隔`。历史真实示例：
  - `v0.8.0 — correctness report: duplicate-key warning + big-int count`
  - `v0.7.0 — sort keys, JSONC/trailing-comma tolerance, color skins`
  - `JSON Keeper v0.6.0 — trustworthy JSON viewer`
- **非发版 commit**：祈使句短标题，如 `Add MIT license`
- **正文必写**（发版 commit 尤其），3–6 行，回答：解决了什么用户痛点 / 为什么这么修 / 对调用方是否破坏兼容。示例（v0.8.0）：
  > Deepens the trust moat: the parser now collects diagnostics... Diagnostics are opt-in via `JSONBig.parse(text, diag)`; callers without it are unaffected.
- 一次 commit 一个逻辑变更；禁止 `wip`、`fix`、`update` 这类无信息量消息
- 结尾保留 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`（历史一致）

## 发版三件套（必须同一个 commit 里同步，漏一个就对不上）

1. `manifest.json` 的 `version` 升号
2. README「本版已含」追加带 `[vX.Y]` 标记的条目
3. commit 标题的 `vX.Y.Z` 与 1 一致

README 头部仍写着 `(v0.2.0)`，与 manifest 的 `0.8.0` 已经不符 —— 下次动 README 时顺手修掉。

## 不进仓库

`*.pem`、`design/`、`node_modules/`、`.DS_Store`、`*.log`（见 .gitignore）。提交前 `git status` 确认没有 pem 混入。

## 合入前置

无 CI。人工前置：@rules/testing.md 的手动冒烟清单跑过对应项，且 `git diff` 自查无 `console.log(用户 JSON)`、无新增网络调用。
