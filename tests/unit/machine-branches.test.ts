import { describe, expect, it } from 'vitest'
import { canSubmit, decide, nextLevelOnIntent } from '../../src/core/machine'
import type { Attempt, TargetEvidence, TrainingSession } from '../../src/core/types'

function ev(status: TargetEvidence['status'], over: Partial<TargetEvidence> = {}): TargetEvidence {
  return { targetId: 't1', status, originalSpan: 'x', answerQuote: '', rationale: '', disputed: false, ...over }
}

function session(over: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 's1', articleId: 'a1', sentenceId: 'a1:s0', articleVersion: 'v1',
    state: 'PREPARE', currentLevel: 0, attempts: [], feedback: [], decisions: [],
    startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as TrainingSession
}

function attempt(): Attempt {
  return {
    id: 'at1', sessionId: 's1', sequence: 1, userText: '回答',
    submittedAt: '2026-01-01T00:00:00.000Z',
    exposureSnapshot: { level: 0, answerRevealed: false, directAnalysisSeen: false },
  }
}

describe('unit: decision reason codes and policy veto', () => {
  it('records explicit conflict and never auto-returns TRANSFER', () => {
    const d = decide({
      evidences: [ev('incorrect', { answerQuote: '错的表述' })],
      attemptSequence: 1, clarifyCount: 0, retryCount: 0,
      answerRevealed: false, suggestedAction: 'TRANSFER',
    })
    expect(d.action).toBe('RETRY')
    expect(d.reasonCodes).toContain('explicit-conflict-with-source')
    expect(d.reasonCodes).toContain('local-error-self-correctable')
    expect(d.reasonCodes).not.toContain('transfer')
    expect(d.action).not.toBe('TRANSFER')
  })

  it('answer already revealed turns a wrong answer into EXPLAIN', () => {
    const d = decide({
      evidences: [ev('incorrect')], attemptSequence: 1, clarifyCount: 0, retryCount: 0,
      answerRevealed: true,
    })
    expect(d.action).toBe('EXPLAIN')
    expect(d.reasonCodes).toContain('answer-already-revealed')
  })

  it('re-expression limit vetoes a model suggestion to keep retrying', () => {
    const d = decide({
      evidences: [ev('incorrect')], attemptSequence: 1, clarifyCount: 0, retryCount: 1,
      answerRevealed: false, suggestedAction: 'RETRY',
    })
    expect(d.action).toBe('EXPLAIN')
    expect(d.reasonCodes).toContain('re-expression-limit-reached')
    expect(d.policyNote).toContain('二次表达上限')
  })

  it('partial + revealed answer ends with PASS, not more clarification', () => {
    const d = decide({
      evidences: [ev('partial')], attemptSequence: 1, clarifyCount: 0, retryCount: 0,
      answerRevealed: true, suggestedAction: 'CLARIFY',
    })
    expect(d.action).toBe('PASS')
    expect(d.reasonCodes).toContain('auto-clarify-limit-reached')
    expect(d.policyNote).toContain('上限已到')
  })

  it('disputed evidence is flagged but never drives the action', () => {
    const d = decide({
      evidences: [ev('correct'), ev('disputed')],
      attemptSequence: 1, clarifyCount: 0, retryCount: 0, answerRevealed: false,
    })
    expect(d.action).toBe('PASS')
    expect(d.reasonCodes).toContain('disputed-items-excluded-from-ability-update')
  })
})

describe('unit: canSubmit guards', () => {
  it('blocks COMPLETE and DIAGNOSE states with distinct reasons', () => {
    expect(canSubmit(session({ state: 'COMPLETE' }), [])).toMatchObject({ ok: false })
    expect(canSubmit(session({ state: 'COMPLETE' }), []).reason).toContain('重新开始')
    expect(canSubmit(session({ state: 'DIAGNOSE' }), []).reason).toContain('诊断进行中')
  })

  it('allows only up to the attempt cap', () => {
    expect(canSubmit(session({ state: 'ATTEMPT' }), [attempt()]).ok).toBe(true)
    expect(canSubmit(session({ state: 'ATTEMPT' }), [attempt(), { ...attempt(), id: 'at2', sequence: 2 }]).ok).toBe(false)
  })
})

describe('unit: nextLevelOnIntent', () => {
  it('UNLOCK_LEVEL3 jumps straight to 3; REQUEST_HINT increments and caps at 3', () => {
    expect(nextLevelOnIntent('UNLOCK_LEVEL3', 0)).toBe(3)
    expect(nextLevelOnIntent('REQUEST_HINT', 0)).toBe(1)
    expect(nextLevelOnIntent('REQUEST_HINT', 2)).toBe(3)
    expect(nextLevelOnIntent('REQUEST_HINT', 3)).toBe(3)
  })

  it('every other intent leaves the level untouched', () => {
    for (const t of ['SUBMIT', 'EXIT', 'DISPUTE', 'ACCEPT_TRANSFER', 'SET_DRAFT'] as const) {
      expect(nextLevelOnIntent(t, 2)).toBe(2)
    }
  })
})
