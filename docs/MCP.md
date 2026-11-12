# MCP 接入 — IELTS Reading Lab

> 现行文档，2026-11-12。描述 `scripts/mcp-server.cjs`：一个 stdio 模式的 MCP server，让 WorkBuddy、Codex CLI、VSCode 等 MCP 客户端读取本软件**运行时产生的真实数据**，并执行一小批白名单命令。

## 1. 它解决什么

源码、测试和文档，Agent 通过工作区文件就能读，不需要 MCP。MCP 补的是两件文件读不到的事：

1. **应用运行时的 SQLite 数据**：文章、训练会话、作答、诊断、观察、错词本、曝光记录。
2. **重复动作**：跑全套回归、打包、核对规格一致性，不用每次手写临时脚本。

方向要说清楚：**这个 server 把软件的数据开放给 Agent，不是把 WorkBuddy 的模型开放给软件**。软件要调用模型，仍需在设置页填任意 OpenAI 兼容端点（见 `docs/DELIVERY.md` §5）。

## 2. 启用步骤

配置已写入用户级文件 `~/.workbuddy/mcp.json`（**不是** `.mcp.json`）：

```json
{
  "mcpServers": {
    "ielts-reading-lab": {
      "command": "<node 绝对路径>",
      "args": ["<项目>/scripts/mcp-server.cjs"],
      "env": { "LAB_ROOT": "<项目根目录>" },
      "description": "IELTS Reading Lab：只读训练数据、项目规格与白名单命令"
    }
  }
}
```

`command` 用绝对路径，因为 WorkBuddy 启动 MCP server 时的 PATH 与终端不同。若已有其他 server，配置脚本是**合并**而非覆盖。

启用：

1. WorkBuddy 左侧「连接器」→ 右上角「自定义连接器」→「配置 MCP」。
2. 保存配置，**彻底退出并重启 WorkBuddy**（改配置不重启不加载）。
3. 在 MCP 列表找到 `ielts-reading-lab`，点「信任」。
4. 新开对话验证：「用 ielts-reading-lab 查一下我的错词本有多少词」。

漏掉「重启」或「信任」是最常见的失败原因。

## 3. 工具清单（18 个）

### 只读数据（读真实数据库）

| 工具 | 返回 |
|---|---|
| `get_storage_info` | 数据库路径、大小、修改时间、各 kind 记录数 |
| `list_articles` | 文章 id / 标题 / 创建时间 / 字数 / 段落数（limit ≤ 100） |
| `get_article` | 指定文章全文（长文截断） |
| `list_wrong_words` | 错词本全部词条，可按关键字筛选 |
| `get_profile` | 会话/作答/观察/决策/反馈/复测/标记/曝光计数 + 最近会话摘要 |
| `list_sessions` | 最近训练会话列表 |
| `get_session` | 完整训练轨迹：会话 + 作答 + 诊断 + 决策 + 反馈 |
| `export_snapshot` | 全量 records JSON；传 `saveTo` 时写入项目 `.tmp/` 并返回路径 |

### 项目与规格（读源码）

| 工具 | 返回 |
|---|---|
| `get_spec` | `spec.json` 全文 |
| `check_spec_consistency` | spec 与代码的静态核对结果 + 已知文档漂移 |
| `get_git_status` | 工作区状态、HEAD、origin/main、是否同步 |

### 白名单命令（固定脚本，不接收任意命令）

| 工具 | 执行 |
|---|---|
| `run_typecheck` | `npm run typecheck` |
| `run_tests` | `npm run test` |
| `run_smoke` | `npm run smoke` |
| `run_test_all` | `npm run test:all` |
| `verify_interactions` | `verify:middleclick` + `verify:wrongwords` |
| `build_app` | `npm run build` |
| `package_app` | `npm run package` |

每个命令有独立超时；输出截断到 12000 字符（保留头尾）；失败即停止后续脚本并返回退出码与输出。

## 4. 安全边界

- **数据库只读**：用 `sql.js` 从 `fs.readFileSync` 的 Buffer 构造内存数据库，从不写回文件。原因在 `electron/db.ts`：`persist()` 每次写都 `fs.writeFileSync(db.export())` 全量覆写，并发写会互相破坏。
- **不暴露** `deleteAllData`、任意 shell、直接写 DB、`setApiKey`。命令来自 `COMMANDS` 常量表，用户参数不会拼进 shell。
- **文件导出限制**：`saveTo` 只取 `path.basename()`，强制落在 `<root>/.tmp/`，且必须以 `.json` 结尾，杜绝路径穿越。
- **stdout 只走 JSON-RPC**，所有日志写 stderr，避免协议被污染。
- **凭据**：快照包含 `api-config`（只有 baseUrl/model 等非敏感字段），与 `exportData()` 一致；加密的 API Key 从不出现在 records 或导出文件里。

## 5. 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `LAB_ROOT` | server 所在项目根目录 | 定位源码、spec、docs、`.tmp/` |
| `LAB_USER_DATA` | `%APPDATA%\ielts-reading-lab` | 覆盖应用数据目录 |
| `LAB_DB_PATH` | `<userData>/reading-lab.sqlite` | 直接指定数据库文件（测试用） |

## 6. 验证

```bash
npm run verify:mcp
```

用官方 SDK 起一个真实 stdio 客户端，握手 → `tools/list` → 逐个 `tools/call`，19 项断言：工具齐全、描述完整、无危险工具、真实数据库含 100 篇文章、`get_session` 返回完整轨迹、spec 一致性通过、路径穿越被拦、未知工具被拒。已纳入 `npm run test:all`。

`tests/unit/mcp-tools.test.ts` 另锁住工具定义与命令白名单，防止将来误加危险工具。

## 7. 故障排查

| 现象 | 原因 |
|---|---|
| 工具列表为空 / 连不上 | 没彻底重启 WorkBuddy，或没点「信任」 |
| 报「数据库不存在」 | 桌面应用从未启动过；先跑一次应用，或设 `LAB_DB_PATH` |
| 报 `Cannot find module '@modelcontextprotocol/sdk'` | 依赖未装；`npm install` |
| 数据库偶发读取失败 | 应用正好在全量覆写；server 内置 3 次重试，仍失败请稍后再试 |
| 命令工具超时 | 相应 npm 脚本本身耗时；`run_test_all` 超时上限 10 分钟 |

## 8. 后续扩展（当前未做）

写操作（如 `add_wrong_word`）**不能**直接改 SQLite 文件。正确做法是在 Electron 主进程加一个只绑定 `127.0.0.1` 的受控 HTTP 接口，由应用自身的 runtime 写库，MCP server 作为客户端转发。这需要先改 `electron/main.ts` 并重新打包，故第一版保持纯只读。
