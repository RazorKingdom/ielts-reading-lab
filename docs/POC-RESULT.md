# 阶段 0 PoC 结果 — IELTS Reading Lab

**核查 / 执行日期：2026-11-10（Asia/Shanghai）**
**结论：BLOCKED（未通过、未验证）。不是「POC 通过」，也不是「订阅集成完成」。**
**构建版本：v0.1.0 | Windows (win32) | Node 22.22.2 | Electron 33.4.11（内置 Node 20.18.3）| Provider：`mock-rules`（本地规则）| 账号/密钥：无**

> 本文为历史记录：早期设计构想文档已移除，但仍明确保留「真实调用已证实」与「mock 验证」的区分。本文结论 **BLOCKED 不代表当前架构**；当前状态见 [`DELIVERY.md`](./DELIVERY.md)。

## 0. 范围说明（重要）

早期设计构想要求「先做阶段 0 官方认证 PoC，不要跳过」。本次会话中，用户在明确两种范围后选择了 **「完整可运行 MVP + 内置可替换 Mock/规则 Provider」**，即：以离线确定性规则完成教学闭环，**不执行真人 OAuth 授权与真实模型调用**。

因此这是一次**用户明确选择的路线偏离**：阶段 0 的真人授权 E2E 没有被「跳过并假装通过」，而是被如实记录为 **BLOCKED / 未执行**。本交付物不等价于阶段 0 验收通过，也不构成进入阶段 1 真实模型链路的依据。

## 1. 真实性声明（逐项）

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 官方 SIWC OAuth / PKCE 真人授权 | **未执行** | 无账号授权、无回调、无 token、无授权截图 |
| 官方模型列表请求 | **未执行** | 无任何对外 AI HTTP 请求 |
| 官方 Responses API 推理（含结构化诊断） | **未执行** | 同上；无 `response.completed`，无模型 slug 可报告 |
| ChatGPT Plus/Pro 订阅额度消耗 | **无** | 无密钥、无凭据、无计费来源、无费用 |
| 独立计费 API / 非官方代理 / 客户端 token 提取 | **无** | 代码库内不存在相关实现 |
| 本仓库所有「诊断结果」 | **本地规则模拟** | `src/core/diagnose.ts` 的 `MockRuleProvider`，确定性中文关键词规则，非大模型输出 |
| SQLite 持久化 / IPC / preload / React 渲染 | **真实执行** | `npm run smoke`，52/52 通过，见 `scripts/smoke-result.json`（数字为最新版本；本文记录的是当时的 30/30） |
| 单元测试 | **真实执行** | `npm run test`，88/88 通过（对纯逻辑与 Mock 的行为验证；本文记录的是当时的 57/57） |
| 断网 / 取消 / 半段流恢复 | **模拟验证** | `FailingProvider`、`PartialProvider` 注入的单元测试，非真实网络故障 |

**一句话**：本机功能确实跑起来了，模型链路完全没有跑；界面上看到的诊断不是模型给的。

## 2. 官方文档核查（当日）

### 2.1 核查动作与结果

按 README「官方依据与核验提醒」列出的链接逐一抓取：

| 链接 | 本轮结果 |
| --- | --- |
| https://developers.openai.com/siwc/quickstart | **HTTP 403 `Forbidden`**（抓取器返回正文仅 `Forbidden` 与请求 ID `sin1::72npc-...`） |
| https://developers.openai.com/siwc/token-sharing-open-source | **HTTP 403 `Forbidden`**（同上，`sin1::drqwv-...`） |
| https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt | 未能取得正文 |
| https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server | 未能取得正文 |
| https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform | 未核验（不在本轮 PoC 阻塞链上） |
| https://learn.chatgpt.com/cookbook/articles/sign-in-with-chatgpt | `fetch failed`，未能取得正文 |

**因此：本轮无法核验「当天」的官方 eligibility、OAuth scopes、SDK 包名与实例调用方式，也无法逐字引用官方条款。** 本报告不伪造官方原文引用，不把搜索摘要当作官方依据。

### 2.2 上一轮抓取记录（未复核，不作为结论）

本次会话较早时曾成功抓取 `quickstart` 与 `token-sharing-open-source` 两个页面，得到概要：SIWC 处于 limited trial；identity 与 ChatGPT plan usage 是两套授权；plan usage 需要额外 Responses API scopes，面向 OSS / 本地应用并需要 `ext_agent_host_id`；官方明确不保证可用。**该结果本轮无法复现（页面 403），故仅作历史记录，不作为验收依据。**

### 2.3 公开二手信息（仅供后续核查线索，不是官方依据）

本轮通过公开搜索得到的第三方解读要点（`https://apidog.com/blog/sign-in-with-chatgpt`、`https://apifox.com/apiskills/sign-in-with-chatgpt`、`https://lobehub.com/de/mcp/zhiqiang73-cpu-manus-codex-bridge` 等）：

- identity 默认 scopes 为 `openid profile email`，只得到 ID token；**不**代表可使用 ChatGPT 套餐。
- plan usage 是单独授权，需 `offline_access`、`resource.invoke`、`chatgpt.tokens.use.direct`，resource 为 `https://api.openai.com/v1`。
- 开源 / 本机应用走自助注册：`client_id=dynamic_agent_client`、持久 `ext_agent_host_id`、PKCE S256、只接受 `127.0.0.1` loopback 回调；商业/托管应用为 limited trial 并需意向表单。
- 套餐请求要求 `store: false` 与 `stream: true`；只有 `response.completed` 算成功；受每应用每周上限、Plus 五小时窗口约束；**无自动降级到开发者计费 API**。

以上均为二手解读，且可能随官方政策变化，**本轮不能据此确认本项目在支持范围内**。因此在代码中没有编写任何真实 SDK 调用，也没有从旧示例抄写包名或实例方法。

## 3. 阶段 0 逐项对照

| B 节要求 | 状态 | 说明 |
| --- | --- | --- |
| B.1 查阅当天官方文档并记录精确链接 | **部分受阻** | 链接见 2.1；两个主页面 403，无法取得正文 |
| B.2 验证支持范围、identity 与 plan usage 区别、确认 SDK 包名与调用方式 | **未完成** | 官方页面不可访问，拒绝凭二手信息下结论或写 SDK 代码 |
| B.3 最小 PoC 页面（连接 / 授权状态 / 模型列表 / 提交英文与中文理解 / 诊断与原始错误） | **未按最小页面实现** | 按用户选择改为完整 MVP；等价交互存在于设置页与训练页，但「连接 ChatGPT」不发起真实流程，且明确标 UNVERIFIED |
| B.4 真人授权后模型列表 → 小型推理 → 结构化诊断，并覆盖取消/无模型/用量/网络失败 | **未执行** | 无真人授权。失败路径仅以注入式 Provider 模拟（A08/S10/A01/A04/A12 测试） |
| B.5 最小 Provider 接口 + stub；结果带 provider/model/status/started/completed/errorKind/rawResponseRef（不含 token）；输出含英文依据、中文回答证据、状态、原因、下一动作 | **已完成（mock 范围）** | `AIProvider` / `ProviderCapability` / `MockRuleProvider` / `ProviderError`；`Diagnosis` 带 providerId、modelId、createdAt、validation、policyVersion；`TargetEvidence` 含 originalSpan、answerQuote、rationale、status、suggestedAction。未使用真实网络响应，故无 rawResponseRef |
| B.6 不依赖真实账号的 mock 自动测试 | **已完成** | 57 项单元测试 + 30 项 Electron 自检 |
| B.7 形成 `docs/POC-RESULT.md` | **已完成** | 本文件 |

**PoC 验收对照**：应用启动 ✅（Electron 自检）；模拟流程完整 ✅；官方授权成功 ❌（未执行）；合法请求完成 ❌（未执行）；一条句法诊断结果通过 Schema + 证据基础校验 ✅（**但输入来自本地规则，不是模型**）；断网/取消可恢复 ✅（模拟）；无未经许可的费用 ✅。

## 4. 授权条件与需要用户本人完成的动作

1. 用户本人在**官方浏览器界面**完成 OAuth 授权；本项目不读取浏览器 Cookie、不提取其他客户端 token、不使用非官方代理。
2. 需要满足官方当日 eligibility（可能涉及 Plus/Pro 账号、开源且本机运行、非商业托管）；**本轮无法确认**。
3. 授权后需按顺序实测：模型列表 → 一条非敏感推理 → 一条结构化句法诊断；记录 provider/model slug、status、started/completed、errorKind、脱敏响应引用，且不得把凭据写进日志或版本库。
4. 若用户只授予 identity，应用必须显示「plan usage 不可用」，不得视为套餐可用（A02）。
5. 切换到独立计费 API 需要用户**主动开启并确认费用**；当前版本未实现该路径，也不会自动切换（A12）。

## 5. 日志脱敏与凭据处理

- 当前版本**没有任何 token / API Key 落盘**：无授权、无凭据存储实现、无环境变量密钥。
- 主进程 IPC 错误处理只记录 `err.message` 与方法名，不记录 token、用户作答或文章内容（`electron/main.ts`）。
- 外来英语文章作为不可信纯文本渲染，不执行 HTML/JS（R08 单元测试覆盖）。
- `scripts/smoke-result.json` 只含检查名、布尔结果与本机路径，不含授权信息或学习者答案原文。
- 接入真实 Provider 时必须补充：OS 凭据存储（Windows DPAPI/凭据管理器）、主进程独占凭据、日志二次脱敏复核、`rawResponseRef` 指向脱敏存储。

## 6. 能否进入阶段 1 的建议

- **按早期设计构想的严格门槛：不建议宣布进入阶段 1。** 阶段 0 未通过，官方文档当日条款未核验，无真人授权、无模型列表、无真实推理、无真实诊断证据。
- 本次已交付的是**「离线功能 MVP（Provider 模拟）」**：阅读器、教学状态机、Validator、SQLite、学习档案均可真实运行，可用于界面与教学策略评审，但**不能作为模型质量或订阅集成的验收证据**。
- 若 SIWC 不可用，按 B.7 允许交付 mock PoC + 明确受阻原因；**不得擅自购买 API、不得改用非官方反代、不得虚报认证通过**。

### 下一步最小任务（不扩大范围）

1. 在可访问 `developers.openai.com` 的网络环境下重新核查 2.1 全部链接，记录核查日期、精确引用与当前 SDK 包名 / 实例调用方式。
2. 用户本人完成真人授权，按第 4 节跑一次最小 PoC 并留存脱敏证据；补齐 A02/A03/A05/A06/A07/A13/A14 的真实链路用例。
3. 若仍受阻，保持 mock PoC 并更新本文件的受阻原因；不改动其他模块。

---

**报告结论栏**：POC 通过 ❌ / **功能 MVP（离线、mock）通过 ✅** / 真实订阅集成 **待验证（BLOCKED）**。

---

## 附录：2026-11-10 后续范围变更说明

本文件是**阶段 0 当时的历史核查记录**，结论针对当时的架构，保留不改写以保证可审计。此后用户明确要求「设置里其他 Provider 全部去掉，只留独立第三方 API，并接入真实调用」，应用已按此改造：

- 官方 SIWC / 本地模型 / Codex 等 Provider 卡片、注册表条目与相关界面文案已移除；本文件中「当前版本没有任何真实 SDK 调用」等描述**只对改造前的版本成立**。
- 当前版本新增 `src/core/apiProvider.ts`（OpenAI 兼容 `/chat/completions`）与 `electron/secureStore.ts`（safeStorage 加密凭据），**具备真实调用能力**。
- 但**仍未用真实 API Key 做过端到端实测**：没有用户提供的密钥，也不代替用户产生费用。自动化验证使用注入式 fake provider；真实链路需用户本人填 Key、点「测试连接」并跑一次训练。
- 因此：本文件的「阶段 0 SIWC POC 未通过」结论依然有效，且该路线不再计划执行；当前架构的真实模型验证状态另见 `docs/DELIVERY.md` §5。**不得把本文件的 BLOCKED 误读为「当前应用不能接真实 API」，也不得把代码就绪误读为「已实测通过」。**
