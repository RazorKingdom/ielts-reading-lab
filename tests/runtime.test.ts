import { describe, expect, it } from 'vitest'
import type { AIProvider, RawDiagnosis } from '../src/core/types'
import { createProvider, PROVIDER_CAPABILITIES, ProviderError } from '../src/core/diagnose'
import { analyzeSentence } from '../src/core/targets'
import { containsAnswerLeak } from '../src/core/machine'
import { MockRuleProvider } from '../src/core/diagnose'
import { buildTransferExercise, evaluateTransfer } from '../src/core/exercise'
import { makeRuntime, makeSessionInput, D01, D06 } from './helpers'

const CORRECT_D01 = '技术提高生产率的程度取决于员工使用技术有多有效。'
const PARTIAL_D01 = '技术提高生产率取决于员工怎么使用技术。'
const WRONG_D01 = '技术提高了生产率，所以员工更有效地用它。'

class FailingProvider implements AIProvider {
  readonly id = 'failing'
  readonly modelId = 'failing-stub'
  readonly capability = PROVIDER_CAPABILITIES[0]
  async diagnose(): Promise<RawDiagnosis> {
    throw new ProviderError('NETWORK', 'simulated network drop')
  }
}

class PartialProvider implements AIProvider {
  readonly id = 'partial'
  readonly modelId = 'partial-stub'
  readonly capability = PROVIDER_CAPABILITIES[0]
  async diagnose(): Promise<RawDiagnosis> {
    // Simulates a truncated stream: never a complete diagnosis.
    return { evidences: [], summary: '', suggestedAction: 'PASS' }
  }
}

const factory = (id: string): AIProvider => {
  if (id === 'failing') return new FailingProvider()
  if (id === 'partial') return new PartialProvider()
  return createProvider(id)
}

describe('S01 / S02 / S03 - first answer and feedback protection', () => {
  it('starts at Level 0 with no explanation leaked and persists the answer before diagnosis', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const s = await api.startSession(makeSessionInput(D01))
    expect(s.session.state).toBe('PREPARE')
    expect(s.session.currentLevel).toBe(0)
    expect(s.attempts).toHaveLength(0)
    expect(s.feedback).toHaveLength(0)

    const partial = await api.dispatch(s.session.id, { type: 'SUBMIT', text: PARTIAL_D01 })
    expect(partial.attempts).toHaveLength(1)
    expect(partial.attempts[0].userText).toBe(PARTIAL_D01)
    expect(partial.attempts[0].exposureSnapshot.level).toBe(0)
    expect(partial.diagnosis?.validation.valid).toBe(true)
    expect(partial.session.state).toBe('CLARIFY')
    expect(partial.session.currentLevel).toBe(1)

    const l1 = partial.feedback.find((f) => f.kind === 'diagnosis')!
    expect(l1.level).toBe(1)
    expect(containsAnswerLeak(l1.content, partial.analysis, 1)).toHaveLength(0)
  })
})

describe('S04 / S05 - hint log and append-only second attempt', () => {
  it('records Level 2 exposure with a timestamp and never overwrites attempt #1', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const s = await api.startSession(makeSessionInput(D01))
    await api.dispatch(s.session.id, { type: 'SUBMIT', text: PARTIAL_D01 })
    const hint = await api.dispatch(s.session.id, { type: 'REQUEST_HINT' })
    expect(hint.session.currentLevel).toBe(2)
    const l2 = hint.feedback.find((f) => f.level === 2)
    expect(l2?.exposedAt).toBeTruthy()
    expect(l2?.content.length).toBeGreaterThan(4)

    const second = await api.dispatch(s.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    expect(second.attempts).toHaveLength(2)
    expect(second.attempts[0].userText).toBe(PARTIAL_D01)
    expect(second.attempts[1].userText).toBe(CORRECT_D01)
    expect(second.attempts[1].exposureSnapshot.level).toBe(2)
    expect(second.session.state).toBe('PASS')

    const blocked = await api.dispatch(s.session.id, { type: 'SUBMIT', text: '还想再答一次' })
    expect(blocked.attempts).toHaveLength(2)
    expect(blocked.notice).toContain('上限')
  })
})

describe('S06 / S09 - answer exposure attribution', () => {
  it('unlocking Level 3 marks Answer Revealed and removes independent credit', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const s = await api.startSession(makeSessionInput(D01))
    await api.dispatch(s.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    const revealed = await api.dispatch(s.session.id, { type: 'UNLOCK_LEVEL3' })
    expect(revealed.session.answerRevealed).toBe(true)
    expect(revealed.session.currentLevel).toBe(3)

    const profile = await api.getProfile()
    const latest = new Map<string, (typeof profile.observations)[number]>()
    for (const o of profile.observations) latest.set(`${o.sessionId}|${o.targetId}`, o)
    const effective = [...latest.values()].filter((o) => o.sessionId === s.session.id)
    expect(effective.length).toBeGreaterThan(0)
    expect(effective.every((o) => o.result !== 'independent-correct')).toBe(true)
    expect(profile.stats.assistedCorrect).toBeGreaterThan(0)
  })

  it('records prior direct-analysis exposure and never credits it as independent (E2E-02)', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const input = makeSessionInput(D01)
    await api.markAnalysisViewed(input.articleId, input.sentenceId)
    expect(await api.hasAnalysisBeenViewed(input.articleId, input.sentenceId)).toBe(true)

    const s = await api.startSession({ ...input, directAnalysisSeen: true })
    expect(s.notice).toContain('答案已暴露')
    const r = await api.dispatch(s.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    expect(r.attempts[0].exposureSnapshot.directAnalysisSeen).toBe(true)
    expect(r.session.state).toBe('PASS')
    const profile = await api.getProfile()
    expect(profile.observations.some((o) => o.sessionId === s.session.id && o.result === 'assisted-correct')).toBe(true)
  })
})

describe('S07 / R05 - exit and restart restoration', () => {
  it('keeps draft, session state and the reading anchor across a simulated restart', async () => {
    const h = makeRuntime()
    await h.api.bootstrap()
    const input = makeSessionInput(D01)
    const s = await h.api.startSession(input)
    await h.api.dispatch(s.session.id, { type: 'SET_DRAFT', text: '草稿：这句好像在讲使用效率…' })
    await h.api.saveReadingPosition({
      articleId: input.articleId, sentenceId: input.sentenceId,
      anchorOffset: 42, viewportRatio: 0.2, updatedAt: new Date().toISOString(),
    })
    const exited = await h.api.dispatch(s.session.id, { type: 'EXIT' })
    expect(exited.session.state).toBe('PREPARE')

    const restarted = h.restart()
    const resumed = await restarted.resumeSession(s.session.id)
    expect(resumed?.session.draft).toBe('草稿：这句好像在讲使用效率…')
    expect(resumed?.session.state).toBe('PREPARE')
    const pos = await restarted.getReadingPosition(input.articleId)
    expect(pos?.sentenceId).toBe(input.sentenceId)
    expect(pos?.viewportRatio).toBe(0.2)
  })
})

describe('A08 / S10 / R09 - failure paths never lose the answer', () => {
  it('network failure keeps the attempt, blocks a scored diagnosis and allows idempotent retry', async () => {
    const h = makeRuntime({ providerFactory: factory })
    await h.api.bootstrap()
    await h.api.setSettings({ activeProviderId: 'failing' })
    const s = await h.api.startSession(makeSessionInput(D01))
    const failed = await h.api.dispatch(s.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    expect(failed.session.state).toBe('DIAGNOSE_FAILED')
    expect(failed.session.lastError).toBe('NETWORK')
    expect(failed.attempts).toHaveLength(1)
    expect(failed.diagnosis).toBeUndefined()
    expect(failed.notice).toContain('已完整保存')

    await h.api.setSettings({ activeProviderId: 'mock-rules' })
    const retried = await h.api.dispatch(s.session.id, { type: 'RETRY_DIAGNOSIS' })
    expect(retried.diagnosis?.validation.valid).toBe(true)
    expect(retried.attempts).toHaveLength(1) // no duplicate attempt / session
  })

  it('S10: a truncated stream never becomes a formal diagnosis', async () => {
    const h = makeRuntime({ providerFactory: factory })
    await h.api.bootstrap()
    await h.api.setSettings({ activeProviderId: 'partial' })
    const s = await h.api.startSession(makeSessionInput(D01))
    const r = await h.api.dispatch(s.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    expect(r.session.state).toBe('DIAGNOSE_FAILED')
    expect(r.diagnosis).toBeUndefined()
    expect(r.attempts).toHaveLength(1)
  })

  it('A01/A04/A12: no external request or charge before the user enables the API', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const cfg = await api.getApiConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.hasKey).toBe(false)
    const s = await api.startSession(makeSessionInput(D01))
    const r = await api.dispatch(s.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    expect(r.session.state).not.toBe('DIAGNOSE_FAILED')
    expect(r.attempts).toHaveLength(1)
    expect(r.diagnosis?.providerId).not.toBe('third-party-api')
    expect(await api.getProfile().then((p) => p.stats.totalSessions)).toBe(1)
  })
})

describe('S12 / S13 / S14 - unknown, dispute and ambiguous exercises', () => {
  it('S12: "I dont know" leads to an explanation, not a forced re-translation', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const s = await api.startSession(makeSessionInput(D01))
    const r = await api.dispatch(s.session.id, { type: 'SUBMIT', text: '不知道。' })
    expect(r.session.state).toBe('EXPLAIN')
    expect(r.session.currentLevel).toBe(3)
    expect(r.feedback.some((f) => f.kind === 'full')).toBe(true)
  })

  it('S13: a dispute appends a review marker without silently rewriting evidence', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const s = await api.startSession(makeSessionInput(D01))
    const first = await api.dispatch(s.session.id, { type: 'SUBMIT', text: WRONG_D01 })
    const after = await api.dispatch(s.session.id, { type: 'DISPUTE', note: '我认为这里只是表述简化' })
    expect(after.session.disputed).toBe(true)
    expect(after.diagnosis?.evidences).toEqual(first.diagnosis?.evidences)
    expect(after.feedback.some((f) => f.content.includes('争议'))).toBe(true)
  })

  it('S14: an ambiguous exercise is unscored and produces no negative record', async () => {
    const analysis = analyzeSentence('ex-1', D06)
    const raw = await new MockRuleProvider().diagnose({
      analysis, attemptText: '成功相比速度更取决于准确性。',
      contextBefore: '', contextAfter: '', level: 0, attemptSequence: 1,
    })
    const ex = buildTransferExercise(analysis, raw.evidences, D06)
    expect(ex).not.toBeNull()
    expect(ex!.validationStatus).toBe('validated')
    expect(ex!.sentence).not.toBe(D06)

    const ambiguous = { ...ex!, validationStatus: 'unscored' as const, validationIssues: ['存在多解'] }
    expect(evaluateTransfer(ambiguous, '随便写点什么').result).toBe('unscored')
    expect(evaluateTransfer(ex!, '准确性比速度更关键，结论质量也类似。').result).not.toBe('incorrect')
  })
})

describe('E2E-01 golden path and R02 session history', () => {
  it('wrong -> Level 1 -> self-correction -> transfer -> delayed re-test', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const input = makeSessionInput(D01)
    const s = await api.startSession(input)

    let snap = await api.dispatch(s.session.id, { type: 'SUBMIT', text: WRONG_D01 })
    expect(snap.session.state).toBe('RETRY')
    expect(snap.session.currentLevel).toBe(1)
    expect(snap.decisions[0].action).toBe('RETRY')
    expect(snap.diagnosis?.evidences.find((e) => e.status === 'incorrect')?.answerQuote).toBeTruthy()

    snap = await api.dispatch(s.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    expect(snap.session.state).toBe('PASS')
    expect(snap.attempts).toHaveLength(2)
    expect(snap.availableIntents).toContain('ACCEPT_TRANSFER')

    snap = await api.dispatch(s.session.id, { type: 'ACCEPT_TRANSFER' })
    expect(snap.session.state).toBe('TRANSFER')
    expect(snap.session.transfer?.validationStatus).toBe('validated')

    snap = await api.dispatch(s.session.id, {
      type: 'SUBMIT_TRANSFER',
      text: '政策能在多大程度上减少排放，取决于家庭执行的持续程度。',
    })
    expect(snap.session.state).toBe('COMPLETE')
    expect(snap.session.transferAttempt?.result).toBe('correct')
    const profile = await api.getProfile()
    expect(profile.reviewTasks.some((r) => r.source === 'transfer' && r.status === 'pending')).toBe(true)
    expect(profile.stats.transferCorrect).toBe(1)
    expect(profile.sessions[0].articleVersion).toBe(input.articleVersion)
  })

  it('R02: training the same sentence twice does not overwrite the earlier session', async () => {
    const { api } = makeRuntime()
    await api.bootstrap()
    const input = makeSessionInput(D01)
    const s1 = await api.startSession(input)
    await api.dispatch(s1.session.id, { type: 'SUBMIT', text: CORRECT_D01 })
    const s2 = await api.startSession(input)
    expect(s2.session.id).not.toBe(s1.session.id)
    const profile = await api.getProfile()
    expect(profile.sessions).toHaveLength(2)
    expect(profile.sessions.find((s) => s.id === s1.session.id)?.state).toBe('PASS')
    expect((await api.findActiveSession(input.articleId, input.sentenceId))?.id).toBe(s2.session.id)
  })
})
