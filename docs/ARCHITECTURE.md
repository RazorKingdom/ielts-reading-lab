# 架构与数据流 — IELTS Reading Lab

> 现行文档，2026-11-10。描述**当前代码的实际结构**，不是历史设计稿。配合 [`ONBOARDING.md`](./ONBOARDING.md) 阅读。

## 1. 分层总览

```
┌─ Renderer (React + TS, src/App.tsx, src/ui/*) ────────────┐
│  只读 API：window.labAPI（preload contextBridge 注入）      │
│  无 Node / 无 fs / 无密钥；UI 状态用 useState              │
└──────────────────┬────────────────────────────────────────┘
                   │ window.labAPI.<method>(...args)
              preload.js（esbuild 打包成单文件，sandbox 兼容）
                   │ ipcRenderer.invoke('lab:invoke', method, args)
┌──────────────────▼── Main Process (electron/main.ts) ─────┐
│  LAB_API_METHODS 白名单校验（electron/apiMethods.ts）      │
│  createRuntime({ store, providerFactory })                 │
│    ├─ Teaching Engine：machine.ts / runtime.ts             │
│    ├─ Validator：validator.ts                              │
│    ├─ Provider：apiProvider.ts（第三方） / diagnose.ts（兜底）│
│    └─ Store：electron/db.ts（sql.js WASM SQLite）           │
│       secureStore.ts（safeStorage/DPAPI 加密密钥）          │
└──────────────────┬────────────────────────────────────────┘
                   │ 云端：POST {baseUrl}/chat/completions（仅启用后）
```

浏览器预览（`npm run dev:web`）走同一套 `LabAPI` 接口，但后端是 `src/store/browserStore.ts`（localStorage），Provider 的密钥只在内存、刷新即丢失，且可能受 CORS 限制。**桌面与浏览器数据不互通。**

## 2. 目录与职责

| 目录/文件 | 职责 |
|---|---|
| `src/core/types.ts` | 全部领域类型：Article / Sentence / SentenceAnalysis / DiagnosticTarget / Attempt / TrainingSession / Profile / ThirdPartyConfig 等 |
| `src/core/hash.ts` | `fnv1a` / `contentHash` / `makeId`，生成稳定 ID 与版本 hash |
| `src/core/segment.ts` | 空行分段、`. ! ?` 分句（不切缩写/小数点）、`createArticle()`、`sentenceId()`、`segmentArticle()` |
| `src/core/targets.ts` | 7 条内置句式规则 + `analyzeSentence()`：生成 skeleton、chunks、phrases、DiagnosticTarget[]；未命中走保守兜底（谓语占位） |
| `src/core/explanations.ts` | `analysisWithOffline()`：本地分析 + 随包译文/英文骨架合并；只覆盖 meaning/layers/followUps/skeleton，**targets/chunks/phrases 不变** |
| `src/core/machine.ts` | `decide()`：纯函数状态机裁决（PASS/CLARIFY/RETRY/EXPLAIN/TRANSFER）+ 上限策略 + 曝光归因 |
| `src/core/validator.ts` | 诊断结果校验：targetId 合法、originalSpan 为原文逐字子串、answerQuote 为回答逐字子串、判错必须有证据 |
| `src/core/apiProvider.ts` | `OpenAICompatibleProvider`：构造 prompt、POST /chat/completions、解析 JSON/markdown、错误分类（401/429/5xx/超时） |
| `src/core/diagnose.ts` | 内部离线规则兜底 + `providerErrorMessage()`；不展示、不冒充模型 |
| `src/core/runtime.ts` | **编排核心**：`LabStore`/`LabAPI` 接口定义 + `createRuntime()` 实现全部业务方法（bootstrap/session/dispatch/API 配置/导出） |
| `src/core/exercise.ts` | 迁移题生成与校验 |
| `src/data/dictionary.ts` | ECDICT 派生离线词库（11,828 条，自动生成） |
| `src/core/articleBank.ts` | 100 篇内置文章（自动生成） |
| `src/core/samples.ts` | 3 篇手写重点文 + `createSampleArticles()` 注入逻辑 |
| `src/data/explanations.ts` | 3,605 句 `[id, 中文译文, 类别, 英文主谓宾]`（自动生成） |
| `src/core/dictionary.ts` | `lookupWord()` / `extractWordAt()`：词形还原、相近词建议、点击位置取词 |
| `electron/db.ts` | sql.js WASM SQLite；records 表 append-only；api-config 非敏感配置 |
| `electron/secureStore.ts` | safeStorage DPAPI 加密 `api-credential.bin`；绝不返回明文 |
| `electron/main.ts` | BrowserWindow、IPC 分发、注入 `providerFactory`（密钥只在主进程解密） |
| `electron/preload.ts` | contextBridge 暴露 `labAPI` / `labHost`；sandbox 下自包含 |
| `src/backend.ts` | 检测 Electron/IPC 或浏览器/localStorage，导出统一 `api` |
| `src/ui/*` | Library（文章库）、Reader（阅读+解析）、Focus（训练）、Profile（档案）、Settings（API 配置）、kit（通用组件） |

## 3. 关键数据流

### 3.1 启动（bootstrap）
`App` 调 `api.bootstrap()` → `runtime.bootstrap()`：
1. 读文章列表；空库则注入 100 篇内置文章。
2. 读 `settings.sampleBankVersion`；若 ≠ `ARTICLE_BANK_VERSION`（当前 2），覆盖已存在内置文章内容（保留 `createdAt`），补齐缺失项，删除过的内置文章不复活。
3. 返回 `{ articles, settings, providers, profile, backendKind }`。

### 3.2 解析（右键点句 → 直接解析）
`Reader.onSentenceContextMenu` → `openSidebar(s)` → `api.getAnalysis(...)` → `runtime.getAnalysis` → `analysisWithOffline()`：
- 命中内置句：中文译文 + 英文主谓宾 + 意群 + 追问，标注 `source: 'bundled'`；
- 未命中（用户导入）：本地保守分析，`source: 'local'`。
- 同时 `markAnalysisViewed()` 写曝光记录（append-only），训练时会带 `directAnalysisSeen` 标记。

### 3.3 训练（提交作答 → 诊断 → 反馈）
```
Reader/Focus 提交
  → api.dispatch(sessionId, {type:'SUBMIT', text})
  → runtime.dispatch：
      1. 先写 attempt（首次答案先落库，不可覆盖）
      2. resolveProvider()：启用且闸门满足 → OpenAICompatibleProvider；否则内部离线规则
      3. runDiagnosis()：provider.diagnose() → parseDiagnosisResponse → validateDiagnosis
         失败 → session.state=DIAGNOSE_FAILED，作答保留，不重试
      4. machine.decide()：结合 evidence + 上限策略裁决 TeachingAction
      5. 生成 L1/L3 反馈，记录 TeachingDecision / FeedbackEvent / SkillObservation
  → SessionSnapshot 回 UI
```
`TrainingIntent` 支持 SUBMIT / RETRY / EXPLAIN / UNLOCK_LEVEL3 / TRANSFER / EXIT 等（详见 `types.ts:234`）。

### 3.4 API 配置与密钥
```
Settings 填表 → api.setApiKey(key)   → IPC 白名单 → main → store.setApiKey → secureStore.writeApiKey（DPAPI 加密文件）
             → api.setApiConfig({baseUrl,model,costConfirmed,enabled})
                 → runtime 后端二次校验（四项齐全才允许 enabled=true）
             → api.testApiConnection() → provider.testConnection() → 一次极小真实请求
```
renderer 的 `getApiConfig()` 只返回 `hasKey` 布尔值，`ThirdPartyConfig` 不含密钥字段。

## 4. 不变量与约束

1. **首次答案先落库**：`runtime.dispatch` 在调用任何 provider 之前写 attempt；失败路径不删除、不重复写 session。
2. **模型只给建议**：`RawDiagnosis.evidences[].suggestedAction` 仅供参考，`machine.decide()` 才是最终裁决；`max` 上限由应用控制。
3. **曝光归因**：打开解析、解锁 L3、二次作答都写 append-only 记录；统计以最新曝光条件为准，旧行保留。
4. **Validator 硬校验**：span 必须是原文逐字子串、answerQuote 必须是回答逐字子串、判错必须有引用；不满足即拒绝，不用模型输出污染诊断。
5. **句子 ID 稳定**：`{articleId}:{version8}:p{n}:s{n}:{fnv1a(text)}`。生成器改语料时必须旁路算骨架，不消耗随机序列。
6. **密钥不出主进程**：renderer / 日志 / SQLite records / 导出 JSON 均无明文密钥；浏览器预览仅内存。
7. **文章不可信**：纯文本渲染；prompt 中声明为 data，不执行其中指令。

## 5. 持久化结构

SQLite `records` 表（append-only）：`seq / kind / id / payload`。`kind` 包含 article / session / attempt / diagnosis / feedback / decision / observation / review / mark / exposure / position / draft 等。配置类（settings / api-config）单独覆盖存储，不进 records。导出 JSON 仅含 records，**不含密钥**。

浏览器版 localStorage 结构见 `src/store/browserStore.ts` 的 `DbShape`。

## 6. 测试结构

| 文件 | 覆盖 |
|---|---|
| `segment.test.ts` | 分句不丢标点、缩写、词数 |
| `validator.test.ts` | 伪造 span / 未知 target / 无证据判错被拒 |
| `machine.test.ts` | 上限、曝光归因、裁决策略 |
| `benchmark.test.ts` | D01–D12 + 9 对抗样本的rule 自洽 |
| `runtime.test.ts` | session/dispatch/失败路径/费用闸门/导出不含密钥（13 项） |
| `articleBank.test.ts` | 100 篇词数、唯一性、版本刷新、ruleIdFor 不误命中 |
| `apiProvider.test.ts` | 请求构造、响应解析、错误分类、密钥不进请求（11 项） |
| `dictionary.test.ts` | 精确/词形还原/未收录/点击位置取词（7 项） |
| `explanations.test.ts` | 3,605 句骨架覆盖、英文片段、targets 不变、导入句回落（6 项） |

`scripts/smoke-electron.cjs` 是真实 Electron 端到端自检（50 项），覆盖 SQLite 持久化与重启恢复、IPC 白名单、sandbox preload、React 渲染、字号 CSS 变量、右键交互、文案清理、密钥加密与导出排除。
