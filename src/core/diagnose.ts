import type {
  AIProvider,
  DiagnosticTarget,
  DiagnosisRequest,
  ProviderCapability,
  RawDiagnosis,
  TargetEvidence,
  TeachingAction,
} from './types'
import { isUnknownAnswer } from './machine'

/** Failure taxonomy from design doc section 6. Never contains credentials. */
export type ErrorKind =
  | 'NOT_VERIFIED'
  | 'PROVIDER_DISABLED'
  | 'IDENTITY_ONLY'
  | 'USER_DECLINED'
  | 'TOKEN_EXPIRED'
  | 'NO_MODELS'
  | 'QUOTA_EXCEEDED'
  | 'NETWORK'
  | 'INVALID_STRUCTURE'
  | 'EVIDENCE_INSUFFICIENT'
  | 'CANCELLED'
  | 'LOCAL_UNREACHABLE'

export class ProviderError extends Error {
  constructor(public errorKind: ErrorKind, message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * Internal offline fallback capability only. The single user-facing provider
 * lives in apiProvider.ts (THIRD_PARTY_CAPABILITY). This object is never shown
 * in the settings UI and never reported as a real model result.
 */
export const PROVIDER_CAPABILITIES: ProviderCapability[] = [
  {
    id: 'mock-rules',
    label: '内部离线兜底（不展示）',
    kind: 'mock',
    status: 'available',
    authentication: '无需认证',
    availableModels: [],
    streaming: false,
    cancellation: true,
    strictStructuredOutput: true,
    maxContext: 1,
    estimatedCost: '¥0（本地运行，不产生任何 API 费用）',
    errorTypes: ['INVALID_STRUCTURE', 'EVIDENCE_INSUFFICIENT', 'CANCELLED'],
    note: '仅在第三方 API 未启用时提供保守诊断，不作为可选模型，也不代表模型诊断质量。',
  },
]

function matchFirst(patterns: string[], text: string): string | null {
  for (const source of patterns) {
    try {
      const m = text.match(new RegExp(source, 'i'))
      if (m && m[0]) return m[0]
    } catch {
      // A malformed rule is skipped rather than allowed to crash training.
    }
  }
  return null
}

function evaluateTarget(target: DiagnosticTarget, answer: string): TargetEvidence {
  const base = { targetId: target.id, originalSpan: target.originalSpan }
  if (target.ambiguous) {
    const quote = answer.trim().slice(0, 12)
    return {
      ...base,
      status: 'disputed',
      answerQuote: quote,
      rationale: `目标「${target.originalSpan}」的指代依赖更长上下文，存在多种合理解读。回答${quote ? `「${quote}」` : '未明确提及'}不足以唯一判定；标记为有争议，不更新长期能力负面记录。`,
      disputed: true,
      suggestedAction: 'PASS',
    }
  }

  const rules = target.rules ?? { accept: [], conflict: [], partial: [] }
  const conflict = matchFirst(rules.conflict, answer)
  if (conflict) {
    return {
      ...base,
      status: 'incorrect',
      answerQuote: conflict,
      rationale: `原文「${target.originalSpan}」表达的是：${target.expectedMeaning}；你的回答中「${conflict}」与之直接冲突，属于明确错误（有回答原文证据）。`,
      suggestedAction: 'RETRY',
    }
  }
  const accept = matchFirst(rules.accept, answer)
  if (accept) {
    return {
      ...base,
      status: 'correct',
      answerQuote: accept,
      rationale: `原文「${target.originalSpan}」；你在回答中说「${accept}」，与参考理解一致。不要求使用语法术语，意译与合理简化均视为正确。`,
      suggestedAction: 'PASS',
    }
  }
  const partial = matchFirst(rules.partial, answer)
  if (partial) {
    return {
      ...base,
      status: 'partial',
      answerQuote: partial,
      rationale: `你在「${partial}」中抓住了主干，但缺少「${target.expectedMeaning.slice(0, 22)}」这一关键细节；该偏差影响对语义范围的判断，但不构成与原意冲突。`,
      suggestedAction: 'CLARIFY',
    }
  }
  return {
    ...base,
    status: 'insufficient',
    answerQuote: '',
    rationale: `回答中未提及「${target.originalSpan}」对应的${target.category}，按规则视为证据不足，不推断为「不会」，也不写入负面能力记录。`,
    suggestedAction: 'CLARIFY',
  }
}

function suggest(evidences: TargetEvidence[], answer: string): { action: TeachingAction; summary: string } {
  const counts = (s: string) => evidences.filter((e) => e.status === s).length
  if (isUnknownAnswer(answer)) {
    return { action: 'EXPLAIN', summary: '你表示暂时不理解；建议直接给出分级帮助，不要求重复翻译。' }
  }
  if (counts('incorrect') > 0) {
    return { action: 'RETRY', summary: '发现与原意直接冲突的表述，建议针对该处重新表达一次。' }
  }
  if (counts('partial') > 0 || counts('insufficient') > 0) {
    return { action: 'CLARIFY', summary: '主干方向已抓住，个别关键点尚未表达，建议一次中性澄清。' }
  }
  if (counts('disputed') > 0) {
    return { action: 'PASS', summary: '核心理解正确；含指代争议项，已单独标记，可随时复核。' }
  }
  return { action: 'PASS', summary: '核心理解正确，无需额外追问。' }
}

/** Default provider: deterministic, offline, evidence-first. */
export class MockRuleProvider implements AIProvider {
  readonly id = 'mock-rules'
  readonly modelId = 'offline-rules-0.1'
  readonly capability = PROVIDER_CAPABILITIES[0]

  async diagnose(req: DiagnosisRequest): Promise<RawDiagnosis> {
    const evidences = req.analysis.targets.map((t) => evaluateTarget(t, req.attemptText))
    const { action, summary } = suggest(evidences, req.attemptText)
    return { evidences, summary, suggestedAction: action }
  }
}

/**
 * The application has exactly one user-facing provider. The host injects the
 * real OpenAI-compatible provider via RuntimeOptions.providerFactory; every
 * other id falls back to the internal offline rules (no network, no credential,
 * no fake success). Legacy provider ids left in old databases therefore
 * degrade safely instead of turning into an unexpected billable request.
 */
export function createProvider(id: string): AIProvider {
  void id
  return new MockRuleProvider()
}

export function providerErrorMessage(kind: ErrorKind): string {
  const map: Record<ErrorKind, string> = {
    NOT_VERIFIED: '该能力尚未验证，未发起任何请求；你的回答已完整保存。',
    PROVIDER_DISABLED: '第三方 API 未启用；回答已保存，请在设置中启用后再试。',
    IDENTITY_ONLY: '当前授权范围不足，未发起推理请求。',
    USER_DECLINED: '你已取消操作，离线功能仍可正常使用。',
    TOKEN_EXPIRED: 'API Key 无效或已过期，请在设置中更新；未自动重试。',
    NO_MODELS: '未发现可用模型，请求已阻止；请检查模型名。',
    QUOTA_EXCEEDED: '服务商额度受限，已停止重试；未自动切换到其他计费来源。',
    NETWORK: '网络中断或超时；回答已保存，可稍后重试，不会重复写 session。',
    INVALID_STRUCTURE: '模型输出结构不合规，Validator 已拒绝写入正式诊断。',
    EVIDENCE_INSUFFICIENT: '模型输出证据不足或证据不实，Validator 已拒绝写入正式诊断。',
    CANCELLED: '请求已取消；session 保留为未完成。',
    LOCAL_UNREACHABLE: '本地模型服务不可达，已回退离线模式，不判定为理解失败。',
  }
  return map[kind]
}
