# IELTS Reading Lab — 英语长难句阅读训练（Windows 桌面应用）

离线可用的 IELTS 学术阅读训练软件：100 篇原创练习文章、逐句中文译文与英文主谓宾、完全离线的 ECDICT 查词、证据驱动的中文自由表达诊断、L0–L3 渐进反馈，可选接入 OpenAI 兼容第三方 API 做真实模型诊断。

**当前状态（2026-11-10）：已交付可运行 MVP；89 项单测 + 52 项 Electron 自检全通过；真实 Key 链路已实测但目标端点返回 503，未拿到模型输出。**

## 文档入口（按你的角色读）

| 你是谁 | 先读 | 再看 |
|---|---|---|
| **最终用户** | [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) — 安装、启动、阅读/训练/查词/设置/备份 | 本文件「开发交付」小节 |
| **接手开发的 Agent / 工程师** | [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — 文档地图、当前架构、模块索引、改动场景、红线 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) + [`docs/DELIVERY.md`](docs/DELIVERY.md) |
| **教学规则 / 诊断质量** | [`docs/CONTRACT.md`](docs/CONTRACT.md) — 证据规则、L0–L3、状态机与裁决策略、人工基准 | `tests/benchmark.test.ts` |
| **测试 / 验收** | [`docs/TESTING.md`](docs/TESTING.md) — 四层测试体系与改动回归流程 | [`docs/DELIVERY.md`](docs/DELIVERY.md) §4/§8 + `tests/` |
| **项目历史 / 真实性边界** | [`docs/POC-RESULT.md`](docs/POC-RESULT.md) — 阶段 0 核查（结论 BLOCKED，不代表当前架构） | [`docs/DELIVERY.md`](docs/DELIVERY.md) §8 |

> ℹ️ 早期的设计构想文档（产品与架构、测试计划、开发 Agent 提示词）已移除，不再随项目分发。它们当中**仍然有效的部分**——教学契约、诊断证据规则、验收原则——已整理进 [`docs/CONTRACT.md`](docs/CONTRACT.md)；其余被后续范围变更取代的内容不要恢复。当前事实以本表所列的现行文档为准。

## 本项目已经确定的选择

- Windows Electron + React + TypeScript，本地 SQLite。
- 阅读与训练双核心；左键取词、右键看语义悬浮窗、中键弹三选菜单（直接解析/推导训练/加入复测）。
- 轻量 AI 侧栏 + 同窗口专注模式。
- 自由中文表达式阅读诊断；无须填写语法术语。
- 渐进式反馈 L0–L3；重要局部错误智能触发二次作答。
- 证据驱动且支持争议；用户随时停止；默认最多一条新句迁移。
- 首选官方 Sign in with ChatGPT（是否可用需真实授权验证）；标准付费 API 与本地模型作为可替换 Provider，Codex App Server 预留后期实验适配器。

## 官方依据与核验提醒

- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform

这些在线接口与授权约束可能更新。文档不会替代开发当日官方文档确认或用户本人授权。

---

## 从零开始（克隆仓库后）

本仓库只含源码与文档，**所有依赖与构建产物均不入库**。在 Windows 上（Node.js 22+ / npm）执行：

```bash
git clone <本仓库地址>
cd 英语阅读训练软件
npm install          # 安装依赖（含 Electron 二进制与 sql.js WASM）
npm run test         # 89 项单元测试，确认源码完整
npm start            # 构建并启动桌面应用
```

`npm start` 会先执行 `npm run build`（编译主进程 + Vite 打包渲染进程），再启动 Electron。其他命令：

```bash
npm run smoke        # Electron + SQLite / 加密凭据端到端自检（52 项）
npm run dev:web      # 纯浏览器预览（localStorage，不互通，仅看界面）
npm run package      # 构建并组装免命令行的便携版到 release/IELTS Reading Lab v4/
```

`npm run package` 用 `scripts/package-app.cjs` 直接组装（复制 Electron 运行时 + 把应用放在 `resources/app/` 真实目录），不依赖 electron-builder 的临时目录重命名，便于在受限环境打包。`npm run dist` 是 electron-builder 标准路径，普通 Windows 环境可用。

若从某些终端启动后没有窗口，是宿主注入了 `ELECTRON_RUN_AS_NODE=1`；`scripts/start-app.cmd` 已自动清除，或手动用 `ELECTRON_RUN_AS_NODE= npm start`。

## 开发交付（2026-11-10）

初版按「完整可运行 MVP + 内置 Mock/规则 Provider」实现；**2026-11-10 后续按用户要求改为：设置页只保留一个 OpenAI 兼容第三方 API，并接入真实调用**。SIWC / 本地模型 / Codex 等旧 Provider 已从界面与注册表中移除，内部只保留不展示的离线兜底。阶段 0 的官方真人授权验证从未执行，详见 `docs/POC-RESULT.md`；完整交付说明见 `docs/DELIVERY.md`。

### 第三方 API（OpenAI 兼容）

设置页现在只有一张「第三方 API（OpenAI 兼容）」卡片：填 **Base URL + 模型名 + API Key**，勾选费用确认，保存后可「测试连接」，再点「启用诊断」才会真正调用。兼容 OpenAI、DeepSeek、Moonshot、OpenRouter、自建代理等 `/chat/completions` 服务。

- API Key 用 Electron `safeStorage`（Windows DPAPI）加密存于主进程，**不进入渲染进程、日志、SQLite 记录或导出文件**；浏览器预览只在内存保存，刷新即丢失且可能受 CORS 限制。
- 未启用时零请求零费用；网络失败 / 额度不足 / 密钥失效会明确报错并完整保留作答，不自动重试、不自动切换其他计费来源。
- 模型输出必须逐项通过原文片段与答案引用的证据校验；模型只给建议，教学动作由应用状态机裁决。
- **真实 Key 端到端实测已执行（2026-11-10）**：配置已填入桌面应用数据目录并持久化，密钥经 DPAPI 加密。测试结果：端点 `https://moyuu.cc/v1` 返回 Cloudflare **HTTP 503（`Service temporarily isolated`）**，鉴权前即被拒，未产生诊断或费用；应用侧失败路径正确（作答完整保留、错误类别 `NETWORK`、不重复写 session）。**真实模型输出质量仍未验证**，换可用端点后需重测；详见 `docs/DELIVERY.md` §8。

### 三键交互：左键取词 / 右键语义 / 中键菜单（完全离线）

阅读工作台的交互是：**左键点击单词 → 本地词典卡片**；**右键点句 → 扇贝式小悬浮窗显示原句与中文语义**（不标记答案已暴露，训练仍算无提示）；**中键点句 → 三选菜单**：直接解析（右栏完整解析，标记答案已暴露）、推导训练（进入引导训练）、加入复测（排入稍后复习）。拖拽划选短语仍可查词，键盘 Enter 等同「直接解析」。解析栏底部也可进入训练或稍后复习。词卡显示音标、中文释义、雅思/四六级/考研/牛津 3000/柯林斯星级等标签；不规则词形还原到原形；未收录词如实提示并给出相近词。按 Esc 或点击空白区域关闭。

词库来自 **ECDICT**（MIT，Copyright (c) 2025 Linwei），由 `scripts/build-dictionary.mjs` 从官方 66 MB 全量 CSV 过滤生成：本项目 100 篇文章的全部实词 + IELTS/考试标签词，共 **11,828 条、约 1.3 MB**。许可全文见 `third_party/ECDICT-LICENSE.txt`。运行时零网络、零 AI、零费用。离线包不含 66 MB 源文件；如需重新生成，自行下载 `ecdict.csv` 到 `.tmp/` 后运行 `npm run build:dictionary`。

### 关于内置 100 篇文章

文章库内置 **100 篇原创 IELTS 风格练习文本**，每篇 **700–900 词**（实测 706–794，平均 765，总计约 7.6 万词），与 IELTS 阅读单篇长度相当：前 3 篇为手写重点文（含 D01–D12 基准目标句，已扩写至同等长度），其余 97 篇由 `scripts/generate-article-bank.mjs` 用 20 个学术主题 × 5 个子话题 + 长句句架库确定性合成，5–7 段、篇内无重复句。

**这些不是官方真题，也没有复制任何受版权保护的原文。** 真实 IELTS / 剑桥真题改编自期刊、杂志与图书，需授权方可分发；官方仅提供少量免费样题。若你手上有自己有权使用的语料，可在「文章库」直接粘贴导入，或替换 `src/core/articleBank.ts` 后重新运行 `npm run generate:articles` 并递增 `ARTICLE_BANK_VERSION`。

数据库已有内容也不会被覆盖：应用按 `sampleBankVersion` 只在首次注入时补齐缺失文章；**语料版本升级时会把已有内置文章刷新为新内容**（保留原创建时间），删除过的内置文章不会复活，自行导入的文章始终保留。当前 `ARTICLE_BANK_VERSION = 2`，旧库下次启动会自动刷新成 700–900 词长文。100 篇文章的**每一句都随应用附带完整中文参考解析**（3,605 句，含前 3 篇人工基准句）：点「直接解析」即可看到参考译文、结构、意群、分层解读与追问，**不联网、不调用模型、不产生费用**。结构切分与诊断目标仍由本地规则生成，参考译文只作理解对照；你自己导入的文章没有内置解析，会显示「本地保守解析」。启用第三方 API 后，训练诊断才会走你所选的模型。
