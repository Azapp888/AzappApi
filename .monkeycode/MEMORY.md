# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[User Instruction Summary]
- Date: 2026-09-12
- Context: 用户要求把项目改动自动同步到远端仓库
- Instructions:
  - 每次与用户对话结束后，自动将所有项目改动提交并 push 到远端仓库（不等待用户再次确认）。
  - 仓库：分支 `main`，remote `origin` = https://github.com/Azapp888/AzappApi

[Project Knowledge Summary]
- Date: 2026-09-12
- Context: Discovered by Agent while performing 网关开发与验证
- Category: Environment Configuration
- Instructions:
  - 项目要求 Node >= 22（使用内置 node:sqlite），本机为 Node v22.22.0。
  - 本机环境无 docker / psql / redis，内存紧张；本地预览默认用 SQLite + 内存限流。
  - 无上游密钥时 MOCK_UPSTREAM 自动为 true；未配置模型调用返回 mock。
  - 本地 8100 端口用于 preview，启动命令：`GATEWAY_STORE=sqlite GATEWAY_REDIS=memory MOCK_UPSTREAM=true SQLITE_PATH=data/preview-3.db PORT=8100 node --no-warnings server.js`。
