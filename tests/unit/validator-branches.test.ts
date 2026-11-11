import { describe, expect, it } from 'vitest'
import { validateDiagnosis } from '../../src/core/validator'
import { analyzeSentence } from '../../src/core/targets'
import type { DiagnosticTarget, RawDiagnosis, SentenceAnalysis, TargetEvidence } from '../../src/core/types'

const SENTENCE = 'The result depends on how carefully the team handled the samples.'
const FULL_ANALYSIS = analyzeSentence('unit:v', SENTENCE)
// Use a single-target analysis so each case isolates one validator branch;
// a second, unevaluated target would add an unrelated "未被评估" issue.
const TARGET: DiagnosticTarget = FULL_ANALYSIS.targets[0]
const ANALYSIS: SentenceAnalysis = { ...FULL_ANALYSIS, targets: [TARGET] }

function analysisWith(targets: DiagnosticTarget[]): SentenceAnalysis {
  return { ...ANALYSIS, targets }
}

function raw(over: Partial<RawDiagnosis> = {}): RawDiagnosis {
  return {
    summary: '整体理解正确。',
    suggestedAction: 'PASS',
    evidences: [{
      targetId: TARGET.id,
      status: 'correct',
      originalSpan: TARGET.originalSpan,
      answerQuote: '取决于',
      rationale: '用户提到了决定关系。',
      disputed: false,
    }],
    ...over,
  } as RawDiagnosis
}

function ev(over: Partial<TargetEvidence> = {}): TargetEvidence {
  return { targetId: TARGET.id, status: 'correct', originalSpan: TARGET.originalSpan, answerQuote: '取决于', rationale: '理由', disputed: false, ...over }
}

const ANSWER = '这取决于团队处理样本有多仔细。'

describe('unit: validator structural guards', () => {
  it('rejects null and empty evidence arrays immediately', () => {
    expect(validateDiagnosis(null, ANALYSIS, SENTENCE, ANSWER).issues).toContain('诊断结果为空')
    expect(validateDiagnosis(raw({ evidences: [] }), ANALYSIS, SENTENCE, ANSWER).issues[0]).toContain('缺少逐项目标判断')
  })

  it('flags missing summary and illegal suggested action', () => {
    const r = validateDiagnosis(raw({ summary: '  ', suggestedAction: 'FLY' } as never), ANALYSIS, SENTENCE, ANSWER)
    expect(r.issues.some((i) => i.includes('缺少诊断摘要'))).toBe(true)
    expect(r.issues.some((i) => i.includes('建议动作不合法'))).toBe(true)
  })

  it('handles non-object evidence and duplicate targets', () => {
    const r = validateDiagnosis(raw({ evidences: [null, ev(), ev()] } as never), ANALYSIS, SENTENCE, ANSWER)
    expect(r.issues.some((i) => i.includes('不是对象'))).toBe(true)
    expect(r.issues.some((i) => i.includes('重复目标'))).toBe(true)
  })

  it('rejects illegal status and missing rationale', () => {
    const r = validateDiagnosis(
      raw({ evidences: [ev({ status: 'maybe' as never, rationale: '' })] }),
      ANALYSIS, SENTENCE, ANSWER,
    )
    expect(r.issues.some((i) => i.includes('状态不合法'))).toBe(true)
    expect(r.issues.some((i) => i.includes('缺少判断理由'))).toBe(true)
  })
})

describe('unit: validator evidence authenticity', () => {
  it('rejects missing span, forged span, and span not matching the target', () => {
    expect(validateDiagnosis(raw({ evidences: [ev({ originalSpan: '' })] }), ANALYSIS, SENTENCE, ANSWER).issues)
      .toEqual(expect.arrayContaining([expect.stringContaining('缺少原文片段')]))
    expect(validateDiagnosis(raw({ evidences: [ev({ originalSpan: 'not in sentence' })] }), ANALYSIS, SENTENCE, ANSWER).issues)
      .toEqual(expect.arrayContaining([expect.stringContaining('证据不实')]))
    // A real substring of the sentence but unrelated to this target.
    const foreign = analysisWith([
      TARGET,
      { ...TARGET, id: TARGET.id + ':2', originalSpan: 'the team' } as DiagnosticTarget,
    ])
    const r = validateDiagnosis(
      raw({ evidences: [ev(), ev({ targetId: TARGET.id + ':2', originalSpan: 'samples' })] }),
      foreign, SENTENCE, ANSWER,
    )
    expect(r.issues.some((i) => i.includes('与目标区间不对应'))).toBe(true)
  })

  it('rejects a fabricated answer quote but accepts a verbatim one', () => {
    expect(validateDiagnosis(raw({ evidences: [ev({ answerQuote: '用户从没说过这句' })] }), ANALYSIS, SENTENCE, ANSWER).issues)
      .toEqual(expect.arrayContaining([expect.stringContaining('并不存在于作答中')]))
    expect(validateDiagnosis(raw(), ANALYSIS, SENTENCE, ANSWER).valid).toBe(true)
  })

  it('blocks an incorrect verdict without a quote twice (specific + global guard)', () => {
    const r = validateDiagnosis(
      raw({ evidences: [ev({ status: 'incorrect', answerQuote: '' })] }),
      ANALYSIS, SENTENCE, ANSWER,
    )
    expect(r.valid).toBe(false)
    expect(r.issues.filter((i) => i.includes('明确错误') && i.includes('证据')).length).toBeGreaterThanOrEqual(2)
  })

  it('allows empty quotes only for insufficient / disputed; disputed needs the flag', () => {
    expect(validateDiagnosis(raw({ evidences: [ev({ status: 'insufficient', answerQuote: '' })] }), ANALYSIS, SENTENCE, ANSWER).valid).toBe(true)
    expect(validateDiagnosis(raw({ evidences: [ev({ status: 'disputed', answerQuote: '', disputed: false })] }), ANALYSIS, SENTENCE, ANSWER).issues)
      .toEqual(expect.arrayContaining([expect.stringContaining('未标记 disputed')]))
    expect(validateDiagnosis(raw({ evidences: [ev({ status: 'disputed', answerQuote: '', disputed: true })] }), ANALYSIS, SENTENCE, ANSWER).valid).toBe(true)
  })

  it('requires every target to be evaluated', () => {
    const r = validateDiagnosis(raw(), FULL_ANALYSIS, SENTENCE, ANSWER)
    expect(r.issues.some((i) => i.includes('未被评估'))).toBe(true)
  })
})
