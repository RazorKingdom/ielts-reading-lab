import { describe, expect, it } from 'vitest'
import { analyzeSentence } from '../src/core/targets'
import {
  canSubmit, containsAnswerLeak, decide, isUnknownAnswer, observationResult, POLICY_LIMITS,
} from '../src/core/machine'
import type { TargetEvidence, TrainingSession } from '../src/core/types'
import { D01 } from './helpers'

const ev = (status: TargetEvidence['status'], id = 't1'): TargetEvidence => ({
  targetId: id,
  status,
  originalSpan: 'depends on',
  answerQuote: status === 'insufficient' || status === 'disputed' ? '' : '取决于',
  rationale: 'test',
})

describe('S08 / policy limits and app-level veto', () => {
  it('RETRY on an explicit conflict, but never re-asks beyond the limit', () => {
    const base = { evidences: [ev('incorrect')], attemptSequence: 1, clarifyCount: 0, retryCount: 0, answerRevealed: false }
    expect(decide(base).action).toBe('RETRY')
    expect(decide({ ...base, retryCount: 1 }).action).toBe('EXPLAIN')
    expect(decide({ ...base, attemptSequence: 2 }).action).toBe('EXPLAIN')
    expect(decide({ ...base, answerRevealed: true }).action).toBe('EXPLAIN')
  })

  it('CLARIFY once for missing detail, then PASS instead of endless questioning', () => {
    const base = { evidences: [ev('partial')], attemptSequence: 1, clarifyCount: 0, retryCount: 0, answerRevealed: false }
    expect(decide(base).action).toBe('CLARIFY')
    const veto = decide({ ...base, clarifyCount: 1, suggestedAction: 'CLARIFY' })
    expect(veto.action).toBe('PASS')
    expect(veto.policyNote).toContain('上限')
  })

  it('S11: PASS on a correct core and refuses extra model suggestions', () => {
    const d = decide({
      evidences: [ev('correct'), ev('insufficient', 't2')],
      attemptSequence: 1, clarifyCount: 1, retryCount: 0, answerRevealed: false,
      suggestedAction: 'RETRY',
    })
    expect(d.action).toBe('PASS')
    expect(d.policyNote).toContain('上限')
  })

  it('S08: a third submission is blocked at the application gate', () => {
    const s = { state: 'RETRY' } as TrainingSession
    expect(canSubmit(s, [{ sequence: 1 }, { sequence: 2 }] as never).ok).toBe(false)
    expect(canSubmit(s, [{ sequence: 1 }] as never).ok).toBe(true)
    expect(POLICY_LIMITS.maxAttempts).toBe(2)
  })

  it('S12: recognises "I dont know" so the app can explain instead of re-asking', () => {
    expect(isUnknownAnswer('不知道。')).toBe(true)
    expect(isUnknownAnswer('我不太确定这句话的主干')).toBe(false)
  })

  it('S03: detects a full reference answer leaking into Level 1', () => {
    const analysis = analyzeSentence('s-leak', D01)
    expect(containsAnswerLeak('大方向抓住了，但还缺少一个细节。', analysis, 1)).toHaveLength(0)
    expect(containsAnswerLeak(analysis.meaning, analysis, 1).length).toBeGreaterThan(0)
    expect(containsAnswerLeak(analysis.meaning, analysis, 3)).toHaveLength(0)
  })

  it('never credits a revealed answer as independent ability', () => {
    expect(observationResult('correct', 0, false)).toBe('independent-correct')
    expect(observationResult('correct', 1, false)).toBe('assisted-correct')
    expect(observationResult('correct', 0, true)).toBe('assisted-correct')
    expect(observationResult('disputed', 0, false)).toBe('disputed')
    expect(observationResult('insufficient', 0, false)).toBe('insufficient')
  })
})
