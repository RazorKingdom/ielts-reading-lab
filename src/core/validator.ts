import type { RawDiagnosis, SentenceAnalysis, ValidationResult, Verdict, TeachingAction } from './types'

const VERDICTS: Verdict[] = ['correct', 'incorrect', 'partial', 'insufficient', 'disputed']
const ACTIONS: TeachingAction[] = ['PASS', 'CLARIFY', 'RETRY', 'EXPLAIN', 'TRANSFER']

/**
 * Application-side validation of ANY provider output. A structurally valid but
 * evidentially false diagnosis must never become an official learning record.
 */
export function validateDiagnosis(
  raw: RawDiagnosis | null | undefined,
  analysis: SentenceAnalysis,
  sentenceText: string,
  attemptText: string,
): ValidationResult {
  const issues: string[] = []
  if (!raw) return { valid: false, issues: ['诊断结果为空'] }
  if (!Array.isArray(raw.evidences) || raw.evidences.length === 0) {
    return { valid: false, issues: ['诊断结果缺少逐项目标判断'] }
  }
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) issues.push('缺少诊断摘要')
  if (!ACTIONS.includes(raw.suggestedAction)) issues.push(`建议动作不合法：${String(raw.suggestedAction)}`)

  const targetById = new Map(analysis.targets.map((t) => [t.id, t]))
  const seen = new Set<string>()

  for (const [i, e] of raw.evidences.entries()) {
    const label = `evidence[${i}]`
    if (!e || typeof e !== 'object') {
      issues.push(`${label} 不是对象`)
      continue
    }
    if (!targetById.has(e.targetId)) {
      issues.push(`${label} 引用了不存在的诊断目标 ${e.targetId}`)
      continue
    }
    if (seen.has(e.targetId)) issues.push(`${label} 重复目标 ${e.targetId}`)
    seen.add(e.targetId)

    if (!VERDICTS.includes(e.status)) issues.push(`${label} 状态不合法：${String(e.status)}`)
    if (typeof e.rationale !== 'string' || !e.rationale.trim()) issues.push(`${label} 缺少判断理由`)

    if (typeof e.originalSpan !== 'string' || !e.originalSpan.trim()) {
      issues.push(`${label} 缺少原文片段`)
    } else if (!sentenceText.includes(e.originalSpan)) {
      issues.push(`${label} 原文片段并未出现在原句中（证据不实）`)
    } else {
      const t = targetById.get(e.targetId)!
      if (!t.originalSpan.includes(e.originalSpan) && !e.originalSpan.includes(t.originalSpan)) {
        issues.push(`${label} 原文片段与目标区间不对应`)
      }
    }

    const quote = typeof e.answerQuote === 'string' ? e.answerQuote : ''
    if (quote && !attemptText.includes(quote)) {
      issues.push(`${label} 引用的用户回答证据并不存在于作答中（证据不实）`)
    }
    if (e.status === 'incorrect' && !quote) {
      issues.push(`${label} 判定「明确错误」却没有引用用户回答证据，已阻止自动记录`)
    }
    if (e.status !== 'insufficient' && e.status !== 'disputed' && !quote) {
      issues.push(`${label} 非「证据不足」判断必须附用户回答证据`)
    }
    if (e.status === 'disputed' && e.disputed === false) {
      issues.push(`${label} 争议项未标记 disputed`)
    }
  }

  for (const t of analysis.targets) {
    if (!seen.has(t.id)) issues.push(`目标 ${t.id} 未被评估`)
  }

  // An explicit conflict must never be recorded without a verbatim quote.
  if (raw.evidences.some((e) => e?.status === 'incorrect' && !e.answerQuote)) {
    issues.push('存在无证据的「明确错误」判定')
  }

  return { valid: issues.length === 0, issues }
}

/** Guard used when a generated transfer exercise looks ambiguous (S14). */
export function validateTransferExercise(ex: {
  sentence: string
  meaning: string
  keyPoint: string
}): ValidationResult {
  const issues: string[] = []
  if (!ex.sentence || ex.sentence.split(/\s+/).length < 7) issues.push('迁移句过短，不具备独立评测价值')
  if (!ex.meaning || ex.meaning.length < 8) issues.push('缺少参考含义')
  if (!ex.keyPoint || ex.keyPoint.length < 6) issues.push('缺少目标知识点')
  if (/\b(them|it|they|these|those)\b/i.test(ex.sentence) && !/\b(the|a|an)\s+\w+/i.test(ex.sentence)) {
    issues.push('迁移句含无明确先行词的代词，可能存在多解')
  }
  if (/[?？]/.test(ex.sentence)) issues.push('迁移句含疑问句，答案不唯一')
  return { valid: issues.length === 0, issues }
}
