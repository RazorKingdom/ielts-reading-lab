import type {
  FeedbackLevel,
  SentenceAnalysis,
  TargetEvidence,
  TeachingAction,
  TrainingIntent,
  TrainingSession,
  Attempt,
  Verdict,
} from './types'

/**
 * Teaching policy lives here, in pure functions. The model may *suggest* an
 * action; this module has the final say. Any veto is reported to the UI as a
 * policyNote so the decision stays explainable.
 */
export const POLICY_LIMITS = {
  maxAutoClarify: 1,
  maxReExpression: 1,
  maxTransfer: 1,
  maxAttempts: 2,
} as const

export interface DecideInput {
  evidences: TargetEvidence[]
  attemptSequence: number
  clarifyCount: number
  retryCount: number
  answerRevealed: boolean
  suggestedAction?: TeachingAction
}

export interface Decision {
  action: TeachingAction
  reasonCodes: string[]
  policyNote?: string
}

const UNKNOWN_PATTERNS = /^(不知道|不会|不清楚|不晓得|没看懂|看不懂|不懂|no idea|idk)[。.！!？?\s]*$/i

export function isUnknownAnswer(text: string): boolean {
  const t = text.trim()
  return t.length <= 12 && UNKNOWN_PATTERNS.test(t)
}

/** Decide the next teaching action. Never returns TRANSFER automatically. */
export function decide(input: DecideInput): Decision {
  const { evidences, attemptSequence, clarifyCount, retryCount, answerRevealed, suggestedAction } = input
  const reasonCodes: string[] = []
  let policyNote: string | undefined
  let action: TeachingAction

  const wrong = evidences.filter((e) => e.status === 'incorrect')
  const partial = evidences.filter((e) => e.status === 'partial')
  const insufficient = evidences.filter((e) => e.status === 'insufficient')
  const disputed = evidences.filter((e) => e.status === 'disputed')

  if (wrong.length > 0) {
    reasonCodes.push('explicit-conflict-with-source')
    if (retryCount >= POLICY_LIMITS.maxReExpression || attemptSequence >= POLICY_LIMITS.maxAttempts) {
      action = 'EXPLAIN'
      reasonCodes.push('re-expression-limit-reached')
      if (suggestedAction === 'RETRY' || suggestedAction === 'CLARIFY') {
        policyNote = '模型建议继续追问，但应用策略已达二次表达上限，改为给出完整解析。'
      }
    } else if (answerRevealed) {
      action = 'EXPLAIN'
      reasonCodes.push('answer-already-revealed')
    } else {
      action = 'RETRY'
      reasonCodes.push('local-error-self-correctable')
    }
  } else if (partial.length > 0 || insufficient.length > 0) {
    reasonCodes.push('important-detail-not-expressed')
    if (
      clarifyCount >= POLICY_LIMITS.maxAutoClarify ||
      attemptSequence >= POLICY_LIMITS.maxAttempts ||
      answerRevealed
    ) {
      action = 'PASS'
      reasonCodes.push('auto-clarify-limit-reached')
      if (suggestedAction === 'CLARIFY' || suggestedAction === 'RETRY') {
        policyNote = '模型建议继续澄清，但应用策略上限已到；核心并无明确冲突，因此结束追问。'
      }
    } else {
      action = 'CLARIFY'
      reasonCodes.push('one-neutral-clarification-allowed')
    }
  } else {
    action = 'PASS'
    reasonCodes.push('core-understanding-correct')
    if (answerRevealed) {
      // Still a correct core, but the learner has already seen the answer:
      // never describe this round as an independent assessment.
      reasonCodes.push('answer-already-revealed')
      policyNote = '答案已暴露，本轮判定通过但不计入独立测评。'
    }
    if (suggestedAction && suggestedAction !== 'PASS' && suggestedAction !== 'TRANSFER' && !policyNote) {
      policyNote = '核心理解已正确，应用拒绝模型提出的额外追问。'
    }
  }

  if (disputed.length > 0) reasonCodes.push('disputed-items-excluded-from-ability-update')
  return { action, reasonCodes, policyNote }
}

/** Guard: a submitted answer can never be overwritten; max one re-expression. */
export function canSubmit(session: TrainingSession, attempts: Attempt[]): { ok: boolean; reason?: string } {
  if (session.state === 'COMPLETE') return { ok: false, reason: '本轮已结束，请重新开始训练。' }
  if (attempts.length >= POLICY_LIMITS.maxAttempts) {
    return { ok: false, reason: '已达二次表达上限，应用不再要求重复作答。' }
  }
  if (session.state === 'DIAGNOSE') return { ok: false, reason: '诊断进行中，请稍候。' }
  return { ok: true }
}

export function nextLevelOnIntent(
  intent: TrainingIntent['type'],
  level: FeedbackLevel,
): FeedbackLevel {
  if (intent === 'UNLOCK_LEVEL3') return 3
  if (intent === 'REQUEST_HINT') return Math.min(3, level + 1) as FeedbackLevel
  return level
}

/**
 * Level 1 feedback must not reveal the full reference understanding or a
 * target's complete explanation. Used by both runtime and tests (S03).
 */
export function containsAnswerLeak(content: string, analysis: SentenceAnalysis, level: FeedbackLevel): string[] {
  if (level >= 3) return []
  const leaks: string[] = []
  const haystack = content.replace(/\s+/g, '')
  if (analysis.meaning && analysis.meaning.length > 6 && haystack.includes(analysis.meaning.replace(/\s+/g, ''))) {
    leaks.push('包含完整参考理解')
  }
  for (const t of analysis.targets) {
    if (t.explanation && haystack.includes(t.explanation.slice(0, 24).replace(/\s+/g, ''))) {
      leaks.push(`疑似泄露目标 ${t.id} 的完整解析`)
    }
    if (level <= 1 && t.expectedMeaning && haystack.includes(t.expectedMeaning.slice(0, 16).replace(/\s+/g, ''))) {
      leaks.push(`疑似泄露目标 ${t.id} 的期望含义`)
    }
  }
  return leaks
}

/** Qualitative label only - deliberately no 0-100 mastery score. */
export function observationResult(
  status: Verdict,
  assistedLevel: FeedbackLevel,
  answerRevealed: boolean,
  priorExposure = false,
): 'independent-correct' | 'assisted-correct' | 'partial' | 'incorrect' | 'insufficient' | 'disputed' | 'unscored' {
  if (status === 'disputed') return 'disputed'
  if (status === 'incorrect') return 'incorrect'
  if (status === 'partial') return 'partial'
  if (status === 'insufficient') return 'insufficient'
  // Having seen the direct analysis before training is an assisted condition (S09 / E2E-02).
  if (answerRevealed || priorExposure || assistedLevel > 0) return 'assisted-correct'
  return 'independent-correct'
}
