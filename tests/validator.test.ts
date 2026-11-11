import { describe, expect, it } from 'vitest'
import { analyzeSentence } from '../src/core/targets'
import { validateDiagnosis, validateTransferExercise } from '../src/core/validator'
import type { RawDiagnosis } from '../src/core/types'
import { D01 } from './helpers'

const analysis = analyzeSentence('s-validator', D01)
const answer = '技术提高生产率的程度取决于员工使用技术有多有效。'

function good(): RawDiagnosis {
  return {
    evidences: analysis.targets.map((t) => ({
      targetId: t.id,
      status: 'correct' as const,
      originalSpan: t.originalSpan,
      answerQuote: '程度取决于',
      rationale: '原文片段与回答证据一致。',
    })),
    summary: '核心理解正确',
    suggestedAction: 'PASS',
  }
}

describe('A09 / A10 / evidence validation', () => {
  it('accepts a fully evidenced diagnosis', () => {
    const r = validateDiagnosis(good(), analysis, D01, answer)
    expect(r.valid).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('rejects an explicit error with no verbatim learner evidence', () => {
    const raw = good()
    raw.evidences[0] = { ...raw.evidences[0], status: 'incorrect', answerQuote: '' }
    const r = validateDiagnosis(raw, analysis, D01, answer)
    expect(r.valid).toBe(false)
    expect(r.issues.join(' ')).toContain('明确错误')
  })

  it('rejects a fabricated quote that does not occur in the answer', () => {
    const raw = good()
    raw.evidences[0] = { ...raw.evidences[0], answerQuote: '这句话完全是捏造的引用' }
    expect(validateDiagnosis(raw, analysis, D01, answer).valid).toBe(false)
  })

  it('rejects a source span that does not occur in the English sentence', () => {
    const raw = good()
    raw.evidences[0] = { ...raw.evidences[0], originalSpan: 'a phrase that never appears' }
    expect(validateDiagnosis(raw, analysis, D01, answer).valid).toBe(false)
  })

  it('rejects unknown targets, duplicate targets, missing targets and empty output', () => {
    const raw = good()
    raw.evidences[0] = { ...raw.evidences[0], targetId: 'not-a-target' }
    expect(validateDiagnosis(raw, analysis, D01, answer).valid).toBe(false)
    expect(validateDiagnosis({ ...good(), evidences: [] }, analysis, D01, answer).valid).toBe(false)
    expect(validateDiagnosis(null, analysis, D01, answer).valid).toBe(false)
    const missing = good()
    missing.evidences.pop()
    expect(validateDiagnosis(missing, analysis, D01, answer).issues.join(' ')).toContain('未被评估')
  })

  it('allows an empty quote for insufficient / disputed, but not for correct', () => {
    const raw = good()
    raw.evidences[0] = { ...raw.evidences[0], status: 'insufficient', answerQuote: '' }
    expect(validateDiagnosis(raw, analysis, D01, answer).valid).toBe(true)
    const raw2 = good()
    raw2.evidences[0] = { ...raw2.evidences[0], status: 'correct', answerQuote: '' }
    expect(validateDiagnosis(raw2, analysis, D01, answer).valid).toBe(false)
  })

  it('S14: marks ambiguous or underspecified transfer exercises unscorable', () => {
    expect(validateTransferExercise({
      sentence: 'The degree to which a policy reduces emissions depends on how consistently households adopt it.',
      meaning: '政策减排的程度取决于家庭执行的持续程度。',
      keyPoint: '程度名词 + depends on 结构',
    }).valid).toBe(true)
    expect(validateTransferExercise({ sentence: 'Too short.', meaning: '', keyPoint: '' }).valid).toBe(false)
    expect(validateTransferExercise({
      sentence: 'Is the policy effective in reducing emissions or not?',
      meaning: '政策是否有效减少排放？',
      keyPoint: '是否结构',
    }).valid).toBe(false)
  })
})
