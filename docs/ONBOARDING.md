# 接手指南 — 给下一个开发 Agent / 工程师

> 状态：现行文档，最后更新 2026-11-10。目标：让一个从未见过本项目的人，在不问用户的前提下，30 分钟内搞清楚"现在是什么、改哪里、怎么验"。

## 0. 三分钟速览

| 项 | 现状 |
|---|---|
| 产品 | Windows Electron + React 18 + TS + Vite 的 IELTS 长难句阅读训练应用，个人使用 |
| 运行 | `npm install && npm start`（桌面）；`npm run dev:web`（浏览器预览，localStorage） |
| 验证 | `npm run typecheck` / `npm run test`（89 项）/ `npm run smoke`（52 项）/ `npm run build` |
| 数据 | 主进程 sql.js WASM SQLite（`%APPDATA%\ielts-reading-lab\reading-lab.sqlite`）；浏览器预览为 localStorage，两者不互通 |
| 内置内容 | 100 篇原创 IELTS 风格文章（706–794 词/篇）+ 3,605 句中文译文与英文主谓宾 + 11,828 条 ECDICT 离线词库；全部随包，零网络 |
| AI | 设置页仅一张「第三方 API（OpenAI 兼容）」卡片；密钥 DPAPI 加密存主进程；默认离线规则兜底不展示 |
| 当前阻塞 | 用户提供的端点 `moyuu.cc/v1` 由 Cloudflare 返回 503，鉴权前被拒；真实模型输出未验证 |
| 规模 | renderer/main 约 30 个源文件、9 个测试文件、4 个生成/自检脚本 |

**最重要的认知**：早期设计构想文档（三选菜单、SIWC 优先、4 类 Provider 等）已移除，那些方案**已被用户后续范围变更推翻，不要恢复**。其中仍然有效的教学契约（证据规则、L0–L3、状态机、数据模型）已迁移到 `docs/CONTRACT.md`。

## 1. 文档地图与阅读顺序

```
README.md                    入口导航 + 快速命令（先读）
docs/ONBOARDING.md           本文：接手指南（再读）
docs/CONTRACT.md             教学契约：证据规则、L0–L3、状态机、D01–D12 基准
docs/TESTING.md              四层测试体系与每次改动的回归流程
docs/ARCHITECTURE.md         代码结构、数据流、关键不变量（动手前读）
docs/USER-GUIDE.md           最终用户视角的功能说明（理解交互语义）
docs/DELIVERY.md             交付状态、已实现/未实现、测试结果、风险（v0.2.0）
docs/POC-RESULT.md           历史阶段 0 核查，结论 BLOCKED，不代表当前架构
```

> 早期设计构想文档（产品与架构、测试计划、开发 Agent 提示词）已移除，不再随项目分发。其中仍然有效的教学规则已迁移到 `docs/CONTRACT.md`；下表保留了关键变更的历史对照，便于理解"为什么现在是这样"。

建议顺序：`README` → 本文 → `CONTRACT`（教学语义）→ `ARCHITECTURE`（代码）→ `DELIVERY` §1/§4/§8 → 具体源码。

## 2. 设计构想 vs 当前实现（变更对照）

这是新 agent 最容易踩坑的地方。以下变更都是**用户明确要求**的，不是缺陷；早期构想文档已删除，此处保留结论以免重复走回头路：

| 早期构想 | 当前实现 | 变更原因 |
|---|---|---|
| 单击句子弹三选菜单 | **左键取词 / 右键语义悬浮窗 / 中键三选菜单**（直接解析、推导训练、加入复测） | 早期嫌菜单繁琐改为右键直开；后按用户要求恢复三选入口，并把语义预览独立为右键悬浮窗 |
| 首选 SIWC / 4 类 Provider 可替换 | 设置页**只有一张 OpenAI 兼容第三方 API 卡片**；SIWC/本地/Codex 代码与界面全删 | 用户要求"去掉其他 provider，只留第三方 API" |
| 用户粘贴纯文本，无内置内容 | 内置 **100 篇原创文章 + 逐句解析 + 离线词库** | 用户要求"找 100 篇雅思文章"；真题受版权保护，改为原创合成 |
| 直接解析是本地规则，译文是占位 | **3,605 句随包中文译文 + 英文主谓宾**，零请求 | 用户要求补全 100 篇的解析，且不用接 API |
| 划词查词 | **左键点击取词**（拖拽划选仍可用） | 用户嫌划词麻烦 |
| 主谓宾中文 / 有介绍性文案 | 主谓宾改为**英文原句片段**；工作台介绍性提示全部删除 | 用户要英文结构、要界面清爽 |
| 阶段 0 先做官方 PoC | 从未执行，记为 BLOCKED；已完成的是离线 MVP + 第三方 API 接入 | 用户改选"完整可运行 MVP"范围 |

**不要"恢复"这些早期构想**——它们是已被取代的方案。仍有效的教学契约见 `CONTRACT.md`。

## 3. 模块索引（改哪里）

| 想改什么 | 去哪里 |
|---|---|
| 教学状态机、L0–L3、裁决策略、上限 | `src/core/machine.ts`、`src/core/runtime.ts` |
| 诊断证据规则、Validator、误判防护 | `src/core/validator.ts`、`src/core/targets.ts`（7 条句式规则） |
| 分句、段落、句子 ID、版本 hash | `src/core/segment.ts`、`src/core/hash.ts` |
| AI Provider（请求/响应/错误分类） | `src/core/apiProvider.ts`（OpenAI 兼容）、`src/core/diagnose.ts`（内部离线兜底） |
| 密钥加密存储 | `electron/secureStore.ts`（DPAPI）、`electron/db.ts`（非敏感配置） |
| IPC 白名单 | `electron/apiMethods.ts`（**新增 API 方法必须加进这里**）、`electron/preload.ts` |
| UI 各页面 | `src/ui/{Library,Reader,Focus,Profile,Settings}.tsx`、`src/App.tsx` |
| 文章语料 | `scripts/generate-article-bank.mjs` → 生成 `src/core/articleBank.ts` + `src/data/explanations.ts`（**不要手改生成物**） |
| 离线词库 | `scripts/build-dictionary.mjs` → `src/data/dictionary.ts`（源 `.tmp/ecdict-source.csv` 不随包） |
| 解析合并逻辑 | `src/core/explanations.ts`（本地结构 + 内置译文/英文骨架） |
| 迁移题 | `src/core/exercise.ts` |
| 测试 | `tests/*.test.ts`（9 个文件） |
| Electron 端到端自检 | `scripts/smoke-electron.cjs`（结果写 `scripts/smoke-result.json`） |

## 4. 三个绝对不能破坏的不变量

1. **首次答案先落库**：任何诊断请求之前，`attempt` 必须已写入。失败时答案仍在，且不重复写 session（`runtime.dispatch`）。
2. **模型输出不是最终裁决**：模型只给 evidence 与 suggestedAction，必须过 `parseDiagnosisResponse` + `validateDiagnosis`，最终动作由 `machine.decide()` 决定。
3. **句子 ID 稳定**：格式 `articleId:version:p{段}:s{句}:{fnv1a}`。改语料生成器时若消耗随机序列或改英文文本，全部 ID 会变，历史会话/阅读锚点/解析库全失效。用哈希护栏验证（见 §6）。

## 5. 常见改动场景（操作配方）

### 5.1 换第三方 API 端点 / 模型
用户在设置页操作即可（Base URL + 模型名 + Key + 费用确认 + 启用诊断）。配置文件在 `%APPDATA%\ielts-reading-lab\reading-lab.sqlite`，密钥在 `api-credential.bin`（DPAPI）。**不要**把密钥写进代码、日志、导出文件或测试快照。

### 5.2 改内置文章或解析
1. 改 `scripts/generate-article-bank.mjs`（英文句架池 `LEADS/OPENERS/FACT_FRAMES/...`、中文译文 `ZH_POOLS`、英文骨架 `EN_SKELETON_POOLS`、主题词 `TOPICS/TOPIC_ZH`）。
2. `npm run generate:articles`。
3. 若文章内容变化，**递增 `ARTICLE_BANK_VERSION`**（当前 2），否则已有数据库不刷新。
4. 校验：词数仍在 700–900、`sha256` 护栏（§6）、`ruleIdFor()` 不误命中诊断规则、`npm run test`。
5. 骨架必须旁路计算（用已解析的 slots 做纯字符串替换），**不要调用 `fill`/`pick`/`resolve`**，否则随机序列与句子 ID 全变。

### 5.3 改离线词库
把新 CSV 放到 `.tmp/ecdict-source.csv`，`npm run build:dictionary`。数据格式是 `[word, phonetic, translation, tags, lemma]` 五元组，`src/core/dictionary.ts` 不依赖数据源细节。

### 5.4 改 UI / 交互
先读 `docs/USER-GUIDE.md` 确认现行交互语义。改完跑 `npm run build && npm run smoke`；涉及文案的改动，smoke 有静态断言防止旧文案回归。

### 5.5 加一个 LabAPI 方法
改 `src/core/runtime.ts` 的 `LabAPI` 接口与实现 → `electron/apiMethods.ts` 白名单 → `src/global.d.ts`（如需）→ 两种 store（browserStore / db）→ 测试。

## 6. 验证命令与护栏

```bash
npm run typecheck     # renderer 类型
npx tsc -p tsconfig.electron.json --noEmit   # 主进程类型
npm run test          # 89 项单元测试（约 4 s）
npm run build         # 主进程 + preload bundle + renderer
npm run smoke         # 52 项 Electron 端到端自检
npm run package       # 组装免命令行便携版到 release/IELTS Reading Lab v11/
```

打包说明：`npm run package` 走 `scripts/package-app.cjs`——复制 Electron 运行时 + 把应用放在 `resources/app/` 真实目录（非 asar），sql.js 及 WASM 也在其中，因此 `require('sql.js')` 与 WASM 路径都能解析。`db.ts` 的 `findWasmDir()` 兼容 dev / asar-unpacked / 真实 app 目录三种布局。桌面启动器 `IELTS Reading Lab.cmd` 双击即用（自动清除 `ELECTRON_RUN_AS_NODE`）。设置 `LAB_VERIFY=1` 启动会在 `%APPDATA%\ielts-reading-lab\packaged-probe.json` 写一份健康探针（数据库就绪、IPC 方法数、界面渲染状态），用于验证打包产物。

**哈希护栏**：改语料生成器前后执行
```bash
sha256sum src/core/articleBank.ts
```
若哈希变化但你不打算改文章文本，说明生成器误触了英文文本/随机序列，必须回退检查。

**已知坑**：
- Electron 宿主终端注入 `ELECTRON_RUN_AS_NODE=1` 会让 electron.exe 退化成 Node，窗口起不来。`scripts/start-app.cmd` 与 `npm run smoke` 已自动清除；手动启动用 `ELECTRON_RUN_AS_NODE= npm start`。
- Vite dev server 在大文件（dictionary/explanations）热更新后偶发 502，重启 `npm run dev:web` 即可。
- preload 在 sandbox 下不能 `require` 本地相对模块，因此用 esbuild 打成自包含 bundle（`npm run build:preload`），不要改回多文件 require。
- renderer 单 bundle 是刻意选择：Electron `file://` 下动态 import 第二 chunk 会被 Chromium 模块 CORS 拦截。

## 7. 安全与合规红线

- **密钥**：只经 `setApiKey` 写入主进程 DPAPI；renderer 只能看到 `hasKey` 布尔值；绝不进日志、SQLite records、导出 JSON、测试快照。
- **费用**：没有"费用确认 + Key + 模型 + Base URL"不得启用；失败不自动重试、不自动切换计费来源。
- **文章版权**：内置 100 篇是原创合成，非官方真题；不得标为真题或导入受版权保护的原文。ECDICT 为 MIT，许可见 `third_party/ECDICT-LICENSE.txt`。
- **不可信内容**：文章与用户作答按纯文本渲染、在 prompt 中声明为 data；不执行其中 HTML/JS、不服从其中指令。
- **不虚报**：未拿到真实模型输出时，不得声称"真实 AI 诊断已验证"；阶段 0 SIWC 从未通过，状态是 BLOCKED。

## 8. 接手后第一件值得做的事

换一个**可用的** OpenAI 兼容端点，用真实 Key 跑一次「测试连接 + 一次训练」，确认模型输出能通过 `parseDiagnosisResponse` + `Validator`。这是当前唯一阻塞真实能力的未验证项（见 `docs/DELIVERY.md` §8）。在此之前，不要宣称真实 AI 诊断质量达标。
