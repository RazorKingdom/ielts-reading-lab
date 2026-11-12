# 开发交付报告 — IELTS Reading Lab

**日期：2026-11-10 | 版本 v0.2.0（第三方 API 改造） | Windows (win32) | Node 22.22.2 / npm 10.9.7 | Electron 33.4.11（内置 Node 20.18.3）| Vitest 2.1.9**

**总判定：离线教学闭环 + OpenAI 兼容第三方 API 接入已完成并全量自动验证 ✅ / 真实 Key 端到端诊断已于 2026-11-12 复测通过 ✅。** 用户本轮明确要求「设置里其他 Provider 全部去掉，只留独立第三方 API，并接入真实调用」，已按此改造。阶段 0 的官方 SIWC 真人授权验证从未执行，相关代码与界面已移除；历史核查记录保留在 [`POC-RESULT.md`](./POC-RESULT.md)（含其 BLOCKED 结论），但**不再代表当前架构**。


## 2026-11-12 真实模型链路复测（覆盖 11-10 的 503 结论）

用户提供可用凭据，用 `moyuu.cc/v1` + `deepseek-v4.1-flash-1017` 跑完整 `createRuntime` 链路。凭据只在进程内存中使用，未写入任何文件、日志或提交。

| 步骤 | 结果 |
|---|---|
| `testConnection` | HTTP 200，约 4.1s，模型返回 `OK` |
| D01 正确作答 | `state=PASS`；`providerId=third-party-api`；`validation.valid=true`、`issues=[]`；两个目标均 `correct` 且带非空逐字 `answerQuote`、`originalSpan` 严格取目标区间；`decision=PASS`，L0 pass 反馈 |
| D01 错误作答 | `state=RETRY`；`validation.valid=true`、`issues=[]`；依赖方向判 `incorrect` 并带逐字引用，程度范围判 `insufficient` 空引用；模型建议 `EXPLAIN`，应用侧 `decide()` 裁决为 `RETRY`（上限策略生效）；L1 correction 反馈 |

修复后的 `SYSTEM_PROMPT` 在真实模型上生效：输出为纯 JSON、无 markdown 围栏、逐字引用准确、区间对应正确。§8 的 503 表格是 2026-11-10 当时的历史事实，不代表当前端点状态。

**仍未验证**：样本仅 2 条；误判率 / 证据准确率 / 9 条对抗样本 / 跨模型兼容性 / 超时与流式边界均未评测。


---

## 1. 已实现 / 未实现清单（区分 mock 与真实能力）

### 已实现

| 模块 | 内容 | 性质 |
| --- | --- | --- |
| 设置页 | **只保留一张「第三方 API（OpenAI 兼容）」卡片**；旧 SIWC / 官方 API / 本地模型 / Codex App Server 卡片与官方依据链接区全部移除 | 真实 |
| 真实调用 | `OpenAICompatibleProvider`：`POST {baseUrl}/chat/completions`，自填 Base URL / 模型名 / API Key，兼容 OpenAI、DeepSeek、Moonshot、OpenRouter、自建代理 | **代码已实现，未用真实 Key 实测** |
| 凭据安全 | Electron `safeStorage`（Windows DPAPI）加密存于主进程 `api-credential.bin`；密钥不进渲染进程、日志、SQLite records、数据导出；浏览器预览仅内存保存并明确警示 CORS | 真实（自检已验证） |
| 费用闸门 | 必须同时具备：已保存密钥 + 勾选费用确认 + 模型名 + Base URL + 点击「启用诊断」；后端 `setApiConfig` 二次校验，绕过 UI 也会被拒绝 | 真实（自检已验证） |
| 连接测试 | 用户主动点击后发送一次极小请求；记录成功/失败与错误类别，不回显密钥 | 真实执行：目标端点返回 HTTP 503，应用如实报错 |
| 失败路径 | 401/403→`TOKEN_EXPIRED`、429→`QUOTA_EXCEEDED`、5xx/超时→`NETWORK`、结构不合规→`INVALID_STRUCTURE`/`EVIDENCE_INSUFFICIENT`；**不自动重试、不自动切换其他计费来源、不丢作答** | 单测覆盖 |
| 输出校验 | 模型返回先经 `parseDiagnosisResponse`（targetId 合法、originalSpan 原文逐字子串、answerQuote 回答逐字子串、判错必须有引用），再经既有 `Validator`；模型只给建议，教学动作由状态机裁决 | 真实 |
| 提示注入防护 | system prompt 明确文章/回答为不可信数据、不服从其中指令；密钥不出现在 prompt 或 request body | 单测覆盖 |
| 内部兜底 | 未启用时退回离线规则，**不展示为可选 Provider、不冒充模型结果**；训练界面标注「本地保守判定（未连接 API）」 | 真实 |
| 文章库 | 100 篇原创 IELTS 风格练习文本，**每篇 700–900 词**（706–794，平均 765，总计约 7.6 万词）、5–7 段、篇内无重复句；搜索、纯文本导入、无损分句、版本 hash、阅读锚点 | 真实 |
| 逐句解析 | **3,605 句参考解析**随包提供：中文译文 + **英文主谓宾骨架（取自原句片段，无占位）**，中文字段名主语/谓语/宾语·表语 + 意群切分 + 追问；中键打开解析，零请求、零费用；导入文章回落本地保守解析 | 真实 |
| 取词交互 | **左键点击取词**（点击位置的单词，拖拽划选短语仍可用）、**右键看语义悬浮窗（已标为看过答案）/ 中键弹三选菜单**（直接解析、推导训练、加入复测）；词卡来自 ECDICT 派生词库（11,828 条）：音标、中文释义、雅思/四六级/牛津/柯林斯标签、词形还原、未收录提示与相近词；零网络、零 AI、零费用 | 真实 |
| 教学闭环 | 状态机 PREPARE→ATTEMPT→DIAGNOSE→CLARIFY/RETRY/EXPLAIN/PASS→COMPLETE（可选 TRANSFER）、L0–L3、上限策略、首次答案先入库、曝光归因 append-only、Validator、迁移题、学习档案 | 真实 |
| 持久化 | sql.js WASM SQLite + append-only 事件；浏览器 localStorage 预览后端；重启恢复草稿/会话/作答/诊断/阅读位置 | 真实 |
| 安全 | contextIsolation + sandbox、最小权限 IPC 白名单（已加入 5 个新配置方法）、文章纯文本渲染、日志不含凭据与作答 | 真实 |
| 自动测试 | 89 项单元测试 + 52 项 Electron 端到端自检 | 真实 |

### 未实现 / 未验证

| 项目 | 原因 |
| --- | --- |
| **用真实 API Key 拿到一次成功的端到端诊断** | 用户提供了密钥，已填入桌面应用真实数据目录并持久化（DPAPI 加密、无明文）。链路真实执行到网络层，但 `moyuu.cc` 返回 503，未产生诊断。需换可用端点后重测。 |
| 流式输出 / 请求中途取消 | 当前为非流式单次请求；失败按错误类别处理、不自动重试（符合 P0 要求） |
| 模型质量评测（误判率 / recall / 证据准确率）、双人标注 | 依赖真实模型输出；现有 21 条人工基准只验证规则自洽 |
| 30 句 × 3 回答 ≈ 90 条基准 + 10 条对抗样本 | 当前 12 条 D01–D12 + 9 条对抗，未达早期测试计划规模；见 [`CONTRACT.md`](./CONTRACT.md) §6/§8 |
| 流式降级为可解析文本（A10） | 已实现从 markdown 围栏/散文中提取 JSON，但未实现流式分块解析 |
| 手工 GUI 验收与交互截图（R03/R04/R06/R07）、E2E 黄金路径真人跑通 | 自动化只覆盖数据层与渲染启动 |
| PDF/EPUB 导入、云同步、多设备 | 不在范围 |
| 官方 SIWC / ChatGPT 订阅额度集成 | **本轮按用户要求移除**，历史核查见 POC-RESULT.md |

---

## 2. 修改的文件 / 目录与关键架构决定

```
src/core/     apiProvider.ts（OpenAI 兼容 Provider、prompt、响应解析、错误分类）dictionary.ts（离线查词）
              diagnose.ts（精简为内部兜底 + 错误分类；删除旧 Provider 注册表与 UnverifiedProvider）
              runtime.ts（LabStore/LabAPI 扩展、费用闸门、providerCapabilities、resolveProvider）
              types.ts（ThirdPartyConfig / ApiConnectionResult / AIProvider.testConnection?）
              samples.ts articleBank.ts（100 篇语料）targets.ts machine.ts validator.ts 等
src/data/     dictionary.ts（ECDICT 派生 11,828 条离线词库）explanations.ts（3,605 句中文解析）
src/core/     explanations.ts（解析合并：本地结构 + 内置译文，诊断 targets 不变）
electron/     secureStore.ts（新增：safeStorage 加密凭据）
              db.ts（api-config 非敏感配置 + 凭据读写 + 导出排除密钥）
              main.ts（注入 providerFactory，密钥只在主进程解密）
              apiMethods.ts（白名单新增 5 个方法）preload.ts
src/store/    browserStore.ts（apiConfig 持久化、密钥仅内存、导出排除密钥）
src/ui/       Settings.tsx（重写为单卡片配置表单）Focus.tsx（来源标注）Library.tsx
              App.tsx（顶栏按连接状态显示）
tests/        9 个测试文件（apiProvider.test.ts 11 项、dictionary.test.ts 7 项、explanations.test.ts 4 项）
scripts/      generate-article-bank.mjs、build-dictionary.mjs、smoke-electron.cjs、run-smoke.cjs、start-app.cmd
third_party/  ECDICT-LICENSE.txt（MIT，Copyright (c) 2025 Linwei）
docs/         POC-RESULT.md（历史）、DELIVERY.md
```

关键决定：

1. **一个用户可见 Provider**：`bootstrap()` 动态返回单个 `third-party-api` capability，状态由配置决定；`PROVIDER_CAPABILITIES` 只保留内部兜底描述，永不展示。
2. **密钥不跨边界**：renderer 只能通过白名单 IPC 写入 `setApiKey`，`getApiConfig()` 只返回 `hasKey` 布尔值；主进程用 `safeStorage.encryptString` 写独立文件，`exportAll()` 的 records 表不含密钥。
3. **费用闸门双保险**：UI 禁用 + `runtime.setApiConfig()` 后端校验；旧数据库里残留的 `activeProviderId` 一律降级为内部兜底，不会变成意外请求。
4. **Provider 由宿主注入**：`RuntimeOptions.providerFactory` 支持 async，Electron main 与浏览器 backend 各自构造 `OpenAICompatibleProvider`；核心 runtime 不接触密钥，纯逻辑可测。
5. **模型输出不是最终裁决**：先 `parseDiagnosisResponse` 再 `validateDiagnosis`，教学动作由 `machine.ts` 决定；文章内容与作答作为不可信数据发送。
6. **未启用时零请求零费用**：离线兜底保留但不展示、不冒充模型；失败时作答已在请求前落库。
7. **语料版本刷新**：`ARTICLE_BANK_VERSION = 2`；版本变化时覆盖已存在内置文章的内容（保留原 `createdAt`），只在首次注入时补齐缺失项，删除过的文章不复活。旧库下次启动自动变成 700–900 词长文，旧训练会话仍绑定原 `articleVersion` 可追溯。
8. 其余既有决定（sql.js WASM、append-only 事件、曝光归因、100 篇原创语料合规）保持不变。

---

## 3. 运行命令与 Windows 注意事项

```bash
npm install                  # 依赖（含 Electron 二进制、sql.js WASM）
npm run typecheck            # renderer 类型检查
npm run test                 # 89 项单元测试
npm run generate:articles    # 重新生成 100 篇原创语料 + 3,605 句解析（确定性）
npm run build:dictionary     # 用 .tmp/ecdict-source.csv 重新生成离线词库
npm run build                # 主进程 + bundle preload + renderer
npm run smoke                # Electron + SQLite + 加密凭据 + 词库/解析/骨架/交互/字号/文案自检（52 项）
npm start                    # 构建并启动 Windows 桌面应用（推荐）
npm run dev:web              # 浏览器预览（密钥仅内存、可能受 CORS 限制）
npm run dev:electron         # Vite 热更新 + Electron
```

**启用第三方 API 的步骤**：设置 → 填 Base URL（如 `https://api.openai.com/v1`）、模型名、API Key → 勾选费用确认 → 「保存配置」→「测试连接」（发送一次极小请求，可能产生微量费用）→「启用诊断」。之后训练诊断会走真实模型；「停用」或「清除密钥」立即回到零请求的离线状态。

- Windows 也可双击 `scripts/start-app.cmd`。Electron 宿主终端注入的 `ELECTRON_RUN_AS_NODE=1` 会让 electron.exe 退化成纯 Node，`start-app.cmd` 与 `npm run smoke` 已自动清除。
- 凭据文件：`app.getPath('userData')/api-credential.bin`（DPAPI 加密）；「删除全部数据」会一并清除。
- 桌面数据：`reading-lab.sqlite`；浏览器预览在 localStorage，两者不互通。

---

## 4. 自动测试数量、结果与证据

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` / `tsconfig.electron.json` | 通过，0 错误 |
| `npm run test` | **9 文件 / 89 项全通过，0 失败 0 跳过**（约 4.2 s） |
| `npm run smoke` | **52 项全通过（Electron 33.4.11，谓语为英文原句片段）**，证据 `scripts/smoke-result.json` |
| `npm run build` | 成功；JS 2.32 MB（gzip 769 kB，含 100 篇语料 + 1.3 MB 词库 + 0.91 MB 逐句解析与英文主干）/ CSS 17.01 kB。单 bundle 是刻意选择：Electron `file://` 下动态 import 第二 chunk 会被 Chromium 模块 CORS 拦截 |

单元测试分布：`segment.test.ts` 5、`validator.test.ts` 7、`machine.test.ts` 7、`benchmark.test.ts` 26、`runtime.test.ts` 13、`articleBank.test.ts` 7（含每篇 700–900 词断言与版本刷新）、`apiProvider.test.ts` 11、`dictionary.test.ts` 7（含点击位置取词的边界规则）、`explanations.test.ts` 6（全量逐句解析覆盖、英文片段、targets 不变、导入句回落）。

新增覆盖：请求 URL/鉴权头/模型、密钥不进请求体与 prompt、markdown 围栏容错、伪造 span / 未知 target / 无证据判错被拒、401/429/5xx 分类、连接测试不泄露密钥、**未启用不调用外部 API、启用后走真实 Provider、费用闸门、导出不含密钥、清除密钥自动停用、请求失败保留作答**。

Electron 自检新增：3,605 句解析与**英文原句主干**随包（零占位谓语）、右键菜单移除与栏底按钮、工作台介绍性文案已清理、离线词库（11,828 条）；单 Provider 暴露、disabled 状态、无密钥不发起连接、未确认费用拒绝启用、**密钥写入加密文件且文件不含明文**、导出不含密钥、清除后自动停用、渲染进程只读非敏感配置、白名单暴露密钥写入入口。

---

## 5. 需要用户本人完成的动作

1. 若端点不可用，在设置页换一个**你自己的**可用 OpenAI 兼容端点与 Key（应用不代填、不代购、不读取其他客户端凭据）。
2. 点「测试连接」验证该服务商、模型名与密钥可用，并确认你接受其计费。
3. 勾选费用确认并「启用诊断」，跑一次完整训练，记录 provider/model、状态码、开始/完成时间、错误类别（凭据打码）。
4. 若服务商不支持跨源请求，请使用桌面应用而非浏览器预览。

该流程已于 2026-11-12 完成一次成功的端到端诊断（见下方复测记录）；但样本仅 2 条，**仍不能声称模型诊断质量已通过评测**。

---

## 8. 真实 Key 实测记录（2026-11-10）

用户提供配置后执行了一次真实端到端测试（密钥仅经环境变量传入，未写入仓库、日志或导出）：

| 环节 | 结果 |
| --- | --- |
| 配置填入桌面真实数据目录 | `%APPDATA%\ielts-reading-lab\reading-lab.sqlite` + `api-credential.bin`；重启后 `persisted=true` |
| 凭据加密 | DPAPI 加密，读取 `api-credential.bin` 原始字节不含明文密钥 |
| 费用闸门 | `enabled=true`、`costConfirmed=true`、`hasKey=true`、模型名与 Base URL 均持久化 |
| `GET /v1/models` | **HTTP 503 `Service temporarily isolated`**（Cloudflare，`cf-cache-status: DYNAMIC`，CF-RAY 节点 AMS） |
| `POST /v1/chat/completions` | **HTTP 503**；最小请求与带应用头请求均如此 |
| 绕开系统代理直连 | 仍 503；`www.` / `api.` / `http` 变体同样失败 |
| 应用内「测试连接」 | 如实返回「第三方 API 返回 HTTP 503」，不回显密钥 |
| 应用内真实训练提交 | 状态 `DIAGNOSE_FAILED`、错误类别 `NETWORK`、提示"回答已保存，可稍后重试" |
| 作答保留复查 | `resumeSession` 仍为 1 条作答，文本完整，无重复 session |

**结论（2026-11-10 历史记录，已被 2026-11-12 复测覆盖）**：503 发生在 Cloudflare 边缘、鉴权之前，与密钥有效性无关；应用侧配置/加密/闸门/失败路径全部按设计工作。一次性测试脚本与误填目录已清理，仓库无明文密钥残留。端点恢复后的复测结果见本文件顶部「真实模型链路复测」。

---

## 6. 安全、计费、稳定性与诊断质量风险

| 类别 | 风险 |
| --- | --- |
| 模型诊断质量评测样本不足 | 2026-11-12 已用真实 Key 完成 2 条端到端诊断（D01 正确/错误，validator 零 issues）；但误判率、证据准确率、对抗样本与跨模型兼容性**仍未评测**，不能据 2 条样本宣称质量达标。 |
| 费用 | 启用后每次训练诊断都会调用你填写的服务商并按其标准计费；测试连接也会产生一次极小请求。应用不会自动重试或切换计费来源。 |
| 凭据 | 依赖 OS `safeStorage`；若系统不提供加密，应用**拒绝以明文保存**。浏览器预览只在内存保存且刷新丢失，跨域可能被拦截。密钥绝不进入日志或导出。 |
| 诊断质量 | 模型输出虽经双重证据校验，但误判率、证据准确率、教学建议适切性**未做人工评测**；不得据此宣称模型质量达标。 |
| 语料性质 | 100 篇为原创合成 IELTS 风格文本，**长度已对齐 IELTS 单篇 700–900 词**，但由句架与主题词库生成，仍有模板痕迹；非官方真题，难度与词汇分布未做等值校准，不适合分数预测。 |
| 离线词库 | ECDICT 派生、11,828 条，覆盖内置语料实词与考试标签词；用户自行导入文章中的生僻词/专有名词可能未收录（会如实提示），如需扩词需重新运行构建脚本。 |
| 稳定性 | sql.js 每次写全库导出；WASM 文件依赖 `node_modules/sql.js/dist`，打包分发需确认随包；无自动备份。 |
| 验收完整性 | 手工 GUI 用例与交互截图缺失；发布阻断项 P0/P1 不能仅凭自动化宣告关闭。 |

---

## 7. 下一步最小任务

1. **用户填真实 Key 完成一次「测试连接 + 训练诊断」**，留存脱敏证据；按实际服务商调整兼容性。
2. 真人跑一遍 E2E-01 黄金路径，补 R03/R04/R06/R07 交互确认与截图。
3. 用真实模型输出补齐 30 句 × 3 回答基准与双人标注，做误判率 / 证据准确率评测。
4. 之后才考虑流式输出、取消、模型列表发现等增强。

> 准确定位：**可运行、可测试、可恢复的离线教学闭环 + 已实现的第三方 API 接入**；真实模型调用能力**已由真人密钥完成端到端验证（2 条基准）**，但诊断质量评测尚未完成；也不是官方订阅集成或官方真题题库。
