import { describe, expect, it } from 'vitest'
import { buildTransferExercise, evaluateTransfer, makeReviewTask } from '../../src/core/exercise'
import type { DiagnosticTarget, SentenceAnalysis, TargetEvidence } from '../../src/core/types'

const tpl = {
  sentence: 'The result depends on how carefully the samples were handled in the field.',
  meaning: '结果取决于样本在实地被处理得有多仔细。',
  keyPoint: 'depends on how 结构',
  accept: ['取决于.*仔细', '样本处理'],
  conflict: ['与.*无关', '不影响'],
}

function target(over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    id: 's:t:1',
    sentenceId: 's',
    category: '核心主谓',
    weight: 'core',
    originalSpan: 'depends on',
    expectedMeaning: '取决于',
    supportedAlternatives: [],
    possibleMisreadings: [],
    hintLevel1: '',
    hintLevel2: '',
    explanation: '',
    transferTemplate: tpl,
    ...over,
  } as DiagnosticTarget
}

function analysis(targets: DiagnosticTarget[]): SentenceAnalysis {
  return {
    sentenceId: 's',
    skeleton: { subject: '', predicate: '', object: '', note: '' },
    chunks: [],
    phrases: [],
    meaning: '',
    layers: [],
    followUps: [],
    targets,
  }
}

function evidence(status: TargetEvidence['status']): TargetEvidence {
  return {
    targetId: 's:t:1',
    status,
    originalSpan: 'depends on',
    answerQuote: '',
    rationale: '',
    disputed: false,
  } as TargetEvidence
}

const transfer = {
  exerciseId: 'ex-test',
  sentence: tpl.sentence,
  meaning: tpl.meaning,
  keyPoint: tpl.keyPoint,
  category: '核心主谓' as const,
  validationStatus: 'validated' as const,
  accept: tpl.accept,
  conflict: tpl.conflict,
  validationIssues: [],
}

describe('unit: transfer exercise generation', () => {
  it('returns null when no target has a transfer template', () => {
    expect(buildTransferExercise(analysis([target({ transferTemplate: undefined })]), [evidence('correct')], 'other')).toBeNull()
    expect(buildTransferExercise(analysis([]), [], 'other')).toBeNull()
  })

  it('ignores targets without evidence and marks scored statuses as validated', () => {
    expect(buildTransferExercise(analysis([target()]), [], 'other')).toBeNull()
    for (const status of ['correct', 'partial', 'incorrect'] as const) {
      const built = buildTransferExercise(analysis([target()]), [evidence(status)], 'other')
      expect(built?.validationStatus).toBe('validated')
      expect(built?.validationIssues).toEqual([])
      expect(built?.exerciseId).toMatch(/^ex_/)
    }
  })

  it('marks the exercise unscored when reused verbatim or source is disputed', () => {
    const same = buildTransferExercise(analysis([target()]), [evidence('correct')], tpl.sentence.toUpperCase())
    expect(same?.validationStatus).toBe('unscored')
    expect(same?.validationIssues.join()).toContain('不得复用')

    const disputed = buildTransferExercise(analysis([target()]), [evidence('disputed')], 'other')
    expect(disputed).toBeNull() // disputed has no scored evidence -> no reusable target
  })

  it('prefers a core target over a minor one when both are reusable', () => {
    const core = target({ id: 's:t:core', weight: 'core' })
    const minor = target({ id: 's:t:minor', weight: 'minor', transferTemplate: { ...tpl, sentence: tpl.sentence + ' Also, it is useful.' } })
    const built = buildTransferExercise(analysis([minor, core]), [evidence('correct'), { ...evidence('correct'), targetId: 's:t:core' }], 'other')
    expect(built?.sentence).toBe(tpl.sentence)
  })

  it('marks invalid templates unscored rather than dropping them', () => {
    const bad = target({ transferTemplate: { ...tpl, sentence: 'Too short.' } })
    const built = buildTransferExercise(analysis([bad]), [evidence('correct')], 'other')
    expect(built?.validationStatus).toBe('unscored')
    expect(built?.validationIssues.length).toBeGreaterThan(0)
  })
})

describe('unit: transfer grading', () => {
  it('unscored exercises never affect the profile', () => {
    const r = evaluateTransfer({ ...transfer, validationStatus: 'unscored', validationIssues: ['歧义'] }, '取决于仔细')
    expect(r.result).toBe('unscored')
    expect(r.rationale).toContain('不计分')
  })

  it('conflict wins over accept, accept beats partial', () => {
    expect(evaluateTransfer(transfer, '结果与样本处理无关').result).toBe('incorrect')
    expect(evaluateTransfer(transfer, '这取决于样本处理有多仔细').result).toBe('correct')
    expect(evaluateTransfer(transfer, '嗯，大概是那样').result).toBe('partial')
  })

  it('skips malformed regex rules without throwing', () => {
    const broken = { ...transfer, accept: ['([unclosed'], conflict: ['[bad'] }
    expect(() => evaluateTransfer(broken, '任意回答')).not.toThrow()
    expect(evaluateTransfer(broken, '任意回答').result).toBe('partial')
  })
})

describe('unit: delayed review task', () => {
  it('schedules three days out, pending, sourced from transfer', () => {
    const now = new Date('2026-11-11T00:00:00.000Z')
    const task = makeReviewTask(transfer, now)
    expect(task.earliestDue).toBe('2026-11-14T00:00:00.000Z')
    expect(task.status).toBe('pending')
    expect(task.source).toBe('transfer')
    expect(task.skillId).toBe('核心主谓')
    expect(task.sentenceText).toBe(tpl.sentence)
    expect(task.id).toMatch(/^rev_/)
  })
})
