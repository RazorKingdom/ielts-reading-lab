import type {
  DiagnosticTarget,
  SentenceAnalysis,
  TargetEvidence,
  TrainingSession,
} from './types'
import { makeId } from './hash'
import { validateTransferExercise } from './validator'

export interface BuiltExercise {
  exerciseId: string
  sentence: string
  meaning: string
  keyPoint: string
  category: DiagnosticTarget['category']
  validationStatus: 'validated' | 'unscored'
  accept: string[]
  conflict: string[]
  validationIssues: string[]
}

/**
 * Build at most ONE new sentence for a reusable, already-resolved skill.
 * Ambiguous or invalid exercises are explicitly marked `unscored`: they are
 * never counted, and never produce a negative learning record (S14).
 */
export function buildTransferExercise(
  analysis: SentenceAnalysis,
  evidences: TargetEvidence[],
  originalSentence: string,
): BuiltExercise | null {
  const reusable = analysis.targets
    .filter((t) => t.transferTemplate)
    .filter((t) => {
      const e = evidences.find((x) => x.targetId === t.id)
      return e && (e.status === 'correct' || e.status === 'partial' || e.status === 'incorrect')
    })
    .sort((a, b) => (a.weight === 'core' ? -1 : 1) - (b.weight === 'core' ? -1 : 1))
  const target = reusable[0]
  if (!target?.transferTemplate) return null

  const tpl = target.transferTemplate
  const issues = validateTransferExercise({
    sentence: tpl.sentence,
    meaning: tpl.meaning,
    keyPoint: tpl.keyPoint,
  }).issues
  const seenBefore = tpl.sentence.trim().toLowerCase() === originalSentence.trim().toLowerCase()
  if (seenBefore) issues.push('迁移句与原句相同，不得复用已见过的完整句子')
  // A disputed target must not become a scored transfer item.
  const disputed = evidences.find((e) => e.targetId === target.id)?.status === 'disputed'
  if (disputed) issues.push('源目标存在争议，迁移题不计分')

  return {
    exerciseId: makeId('ex'),
    sentence: tpl.sentence,
    meaning: tpl.meaning,
    keyPoint: tpl.keyPoint,
    category: target.category,
    validationStatus: issues.length === 0 ? 'validated' : 'unscored',
    accept: tpl.accept,
    conflict: tpl.conflict,
    validationIssues: issues,
  }
}

/** Grade the immediate transfer attempt. Unscored exercises never affect the profile. */
export function evaluateTransfer(
  transfer: NonNullable<TrainingSession['transfer']>,
  answer: string,
): { result: 'correct' | 'partial' | 'incorrect' | 'unscored'; rationale: string } {
  if (transfer.validationStatus !== 'validated') {
    return {
      result: 'unscored',
      rationale: `该题校验未通过（${transfer.validationIssues?.join('；') || '存在歧义'}），按规则不计分、不写入能力记录。`,
    }
  }
  const hit = (patterns: string[]): string | null => {
    for (const p of patterns ?? []) {
      try {
        const m = answer.match(new RegExp(p, 'i'))
        if (m?.[0]) return m[0]
      } catch {
        /* skip malformed rule */
      }
    }
    return null
  }
  const conflict = hit(transfer.conflict ?? [])
  if (conflict) return { result: 'incorrect', rationale: `回答中「${conflict}」与目标关系冲突（仅为即时表现记录）。` }
  const accept = hit(transfer.accept ?? [])
  if (accept) return { result: 'correct', rationale: `回答中「${accept}」体现了目标关系。` }
  return { result: 'partial', rationale: '回答未充分体现目标关系，也未直接冲突；记为部分表现。' }
}

/** Delayed re-test is stored separately from immediate transfer performance. */
export function makeReviewTask(transfer: NonNullable<TrainingSession['transfer']>, now: Date) {
  const due = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  return {
    id: makeId('rev'),
    skillId: transfer.category,
    sentenceText: transfer.sentence,
    earliestDue: due.toISOString(),
    status: 'pending' as const,
    source: 'transfer' as const,
    createdAt: now.toISOString(),
  }
}
