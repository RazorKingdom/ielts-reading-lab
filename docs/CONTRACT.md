# 教学契约与验收标准 — IELTS Reading Lab

> 现行文档，2026-11-10。早期设计构想文档已移除，但其中**仍然有效**的教学规则与验收原则统一保留在这里。本文描述"软件应该怎样判断与反馈"，与代码的事实来源以 `src/core/{types,targets,machine,validator,runtime}.ts` 为准；测试证据见 `tests/benchmark.test.ts`。

## 1. 产品原则（不可违背）

- 沉浸阅读是默认状态，训练是可选进入的精读模式；**打开解析不等于技能不足**。
- 用户用**自己的中文自然表达**理解，不需要写语法术语；缺少术语不得判为不懂。
- 诊断依据原句与用户作答，**合理简化、意译、非标准但正确的表达都不是错误**。
- 先提示再揭示完整答案；用户可随时停止、随时解锁完整解析。
- 训练结果必须注明**提示暴露条件**；所有判断可追溯、可质疑。
- 首次答案在任何诊断请求之前落库，且不可覆盖；失败不丢答案。

## 2. 诊断目标与证据规则

### 2.1 可验证目标（`DiagnosticTarget`）

原文需解析出：核心主谓、修饰与从句功能、意群、指代、语义程度与否定范围、逻辑关系、词组语境义。每个目标带：原文区间（`originalSpan`）、参考理解（`expectedMeaning`）、可接受同义表述、可能误解、提示层级、权重（core/important/minor）。

### 2.2 逐项判定（`Verdict`）

| 判定 | 条件 | 硬约束 |
|---|---|---|
| `correct` | 用户表述有明确支持 | 不要求语法术语、不要求逐词对应 |
| `incorrect` | 用户陈述与原文**明确冲突** | **必须**引用用户回答中的逐字证据（`answerQuote`） |
| `partial` | 抓住关键但有重要细节偏差 | 必须指出该偏差是否影响整句意义 |
| `insufficient` | 用户未提及该项 | **不得视为不会**，`answerQuote` 为空 |
| `disputed` | 多种合理解读或解析本身有歧义 | 不写入长期能力负面记录 |

Validator 强制：`targetId` 必须来自本次分析、`originalSpan` 必须是原句逐字子串、`answerQuote` 必须是作答逐字子串、判错必须有证据。任何不满足即拒绝整个诊断。

## 3. 反馈分级与答案保护

| 级别 | 内容 | 对归因的影响 |
|---|---|---|
| L0 | 仅原句 + 自由输入 | 无提示，可计独立正确 |
| L1 | 指出已理解与问题范围 | 已暴露，不计独立 |
| L2 | 局部线索 / 对比句 | 已暴露，不计独立 |
| L3 | 完整主干、逐层结构、参考理解 | **禁用"原句独立正确"归因** |

- 用户可随时请求更深入提示或直接解锁 L3；解锁后原句不再计为独立测评。
- 明确错误可以直接纠正，不为防剧透而制造无意义猜谜。
- 每次暴露（打开解析、解锁 L3、二次作答）都写 append-only 曝光记录；统计以**最新曝光条件**为准，旧行保留可追溯。
- 关键：右键打开「直接解析」即写入曝光标记（`articleId|sentenceId`），训练时带 `directAnalysisSeen`。

## 4. 教学决策与上限

`TeachingAction` 只能取：`PASS` / `CLARIFY` / `RETRY` / `EXPLAIN` / `TRANSFER`。

- **PASS**：核心目标正确。
- **CLARIFY**：关键歧义，需要澄清。
- **RETRY**：重要局部错误且用户可能自行修正。
- **EXPLAIN**：大范围不理解，或二次表达仍失败。
- **TRANSFER**：已解决可复用技能且用户愿意，给一条同技能迁移句。

强制上限：**自动澄清 ≤ 1**、**原句二次表达 ≤ 1**、**默认迁移 ≤ 1**；用户随时停止。模型只给 `evidences` 与 `suggestedAction`，**最终动作由 `machine.decide()` 裁决**并解释原因。上限策略写在应用侧，不交给模型。

## 5. 学习上下文与数据模型原则

- 沉浸阅读优先不中断；精读才进入诊断。
- 不以"打开翻译/解析"判定能力不足。
- 核心实体：`Article`（带 `versionHash`）、`Sentence`（稳定 ID）、`TrainingSession`、`Attempt`（带 `exposureSnapshot`）、`DiagnosticTarget`、`Evidence`、`FeedbackEvent`、`TeachingDecision`、`SkillObservation`、`ReviewTask`、`MarkedSentence`。
- 历史采用 append-only 事件语义；允许修正诊断但保留审核轨迹。跨文章复测不复用已见过的完整句。

## 6. 人工基准样例（D01–D12）

以下为**原创 IELTS 风格句，不是官方真题**。完整数据与断言在 `src/core/samples.ts` 的 `BENCHMARK_CASES`、`tests/benchmark.test.ts`。每个样例校验三件事：Validator 通过、核心目标判定符合预期、教学动作符合预期，并验证每条引用的逐字真实性。

| ID | 句子 | 学生回答摘要 | 预期核心判定 / 动作 | 判定要点 |
|---|---|---|---|---|
| D01 | The extent to which technology improves productivity depends on how effectively employees use it. | 技术提高生产率的程度取决于员工使用技术有多有效。 | correct / PASS | 关键正确 |
| D02 | 同 D01 | 技术提高生产率取决于员工怎么使用技术。 | partial / CLARIFY | 大意对、程度细节缺失；不得判语法错误 |
| D03 | 同 D01 | 技术提高了生产率，所以员工更有效地用它。 | incorrect / RETRY | 依赖方向倒置为因果 |
| D04 | Although resources are widely available, understanding depends on critical evaluation. | 虽然资源丰富，理解仍取决于批判性评价。 | correct / PASS | 让步关系正确 |
| D05 | 同 D04 | 资源丰富，因此理解自然更好。 | incorrect / RETRY | 让步误读为因果 |
| D06 | Success depends less on speed than on accuracy. | 成功同等取决于速度与准确性。 | incorrect / RETRY | 比较关系错误 |
| D07 | 同 D06 | 成功相比速度更取决于准确性。 | correct / PASS | 比较关系正确 |
| D08 | The system was designed to reduce costs. | 系统已经降低了成本。 | incorrect / RETRY | 目的误作结果 |
| D09 | The information students encounter is not always reliable. | 学生接触的信息未必可靠。 | correct / PASS | 未称"定语从句"也应判对 |
| D10 | The decision depends on whether the evidence is sufficient. | 这取决于证据是否充足。 | correct / PASS | 不强制分析 whether 类型 |
| D11 | The policy, introduced last year, has not yet produced measurable results. | 去年出台的政策尚未产生可测量结果。 | correct / PASS | 否定与时间正确 |
| D12 | 同 D11 | 政策去年已产生可测量结果。 | incorrect / RETRY | 否定/时间误读 |

另有 **9 条对抗样本**（`ADVERSARIAL_CASES`），专门验证同义中文、非标准但正确的翻译、代词歧义、参考答案本身不充分等情形**不得被判错**。

## 7. 验收原则

1. 从文章导入到学习记录的闭环可重复完成；API 失败、取消、重启均不丢首次答案。
2. 每条用例记录执行日期、环境、模型/规则版本、实际输出、是否通过、缺陷链接。
3. 自动化只覆盖数据层与渲染启动；**R03/R04/R06/R07 交互用例与 E2E 黄金路径仍需真人 GUI 验收**，自动化不得单方面宣告发布阻断项关闭。
4. **不得虚报**：未拿到真实模型输出时，不声称"真实 AI 诊断已验证"；阶段 0 的 SIWC 授权从未通过（见 `POC-RESULT.md`，结论 BLOCKED）。

## 8. 当前覆盖与缺口

| 项 | 现状 |
|---|---|
| 自动测试 | 89 项单测（9 文件）+ 51 项 Electron 自检，全通过 |
| 人工基准 | D01–D12 + 9 对抗样本，验证规则自洽 |
| 规模缺口 | 原计划的 30 句 × 3 回答 ≈ 90 条基准**未达成**；双人标注、真实模型误判率/证据准确率评测**未做** |
| 手工验收 | R03/R04/R06/R07 交互截图、E2E 黄金路径真人跑通**缺失** |

约束：现有基准只验证本地规则的自洽性，**不能外推为模型诊断质量**。详见 `DELIVERY.md` §4/§6/§8。
