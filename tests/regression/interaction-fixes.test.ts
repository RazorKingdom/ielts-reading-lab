/**
 * Regression sentinels for the P0/P1 interaction bugs fixed in the 2026-11-11
 * review. Each test names the original symptom so a future change cannot
 * silently reintroduce it.
 */
import { describe, expect, it } from 'vitest'
import { makeRuntime, makeSessionInput, D01 } from '../helpers'
import { decide } from '../../src/core/machine'
import { ProviderError, providerErrorMessage } from '../../src/core/diagnose'
import type { AIProvider, ProviderCapability, RawDiagnosis, TargetEvidence } from '../../src/core/types'

function ev(status: TargetEvidence['status']): TargetEvidence {
  return { targetId: 't', status, originalSpan: 'x', answerQuote: 'q', rationale: 'r', disputed: false }
}

class FailingProvider implements AIProvider {
  readonly id = 'third-party-api'
  readonly modelId = 'stub'
  readonly capability = { id: 'third-party-api' } as ProviderCapability
  async diagnose(): Promise<RawDiagnosis> {
    throw new ProviderError('QUOTA_EXCEEDED', 'simulated quota exhaustion')
  }
}

describe('regression: actionable error guidance is persisted', () => {
  it('a failed diagnosis stores lastErrorNote that survives resume', async () => {
    const { api, restart } = makeRuntime({ providerFactory: () => new FailingProvider() } as never)
    await api.setApiKey('sk-test')
    await api.setApiConfig({ enabled: true, costConfirmed: true, model: 'm', baseUrl: 'https://x/v1' })
    const { session } = await api.startSession(makeSessionInput(D01))
    const failed = await api.dispatch(session.id, { type: 'SUBMIT', text: '这取决于员工使用技术有多有效。' })
    expect(failed.session.state).toBe('DIAGNOSE_FAILED')
    expect(failed.session.lastError).toBe('QUOTA_EXCEEDED')
    expect(failed.session.lastErrorNote).toBe(providerErrorMessage('QUOTA_EXCEEDED'))
    // Resume with a fresh runtime instance: the note is in the store, not a
    // transient notice.
    const resumed = await restart().resumeSession(session.id)
    expect(resumed?.session.lastErrorNote).toBe(providerErrorMessage('QUOTA_EXCEEDED'))
  })
})

describe('regression: no disputing a diagnosis that never existed', () => {
  it('PREPARE state does not offer DISPUTE', async () => {
    const { api } = makeRuntime()
    const { session } = await api.startSession(makeSessionInput(D01))
    const snap = await api.resumeSession(session.id)
    expect(snap?.availableIntents).not.toContain('DISPUTE')
  })

  it('a direct DISPUTE without a diagnosis is refused', async () => {
    const { api } = makeRuntime()
    const { session } = await api.startSession(makeSessionInput(D01))
    const r = await api.dispatch(session.id, { type: 'DISPUTE', note: '质疑' })
    expect(r.notice).toContain('无法标记为争议')
    expect((await api.resumeSession(session.id))?.session.disputed).toBe(false)
  })
})

describe('regression: policy notes and PASS notices', () => {
  it('decide exposes a persistable policyNote on veto', () => {
    const d = decide({
      evidences: [ev('incorrect')],
      attemptSequence: 1, clarifyCount: 0, retryCount: 1,
      answerRevealed: false, suggestedAction: 'RETRY',
    })
    expect(d.policyNote).toBeTruthy()
    expect(d.action).toBe('EXPLAIN')
  })

  it('a correct answer yields PASS with a visible user notice', async () => {
    const d = decide({
      evidences: [ev('correct')],
      attemptSequence: 1, clarifyCount: 0, retryCount: 0,
      answerRevealed: false,
    })
    expect(d.action).toBe('PASS')
    // The notice is produced by runtime.ts, not by decide(): assert it through
    // the real pipeline so a removed notice is caught.
    const { api } = makeRuntime()
    const { session } = await api.startSession(makeSessionInput(D01))
    const snap = await api.dispatch(session.id, { type: 'SUBMIT', text: '技术提高生产率的程度取决于员工使用技术有多有效。' })
    expect(snap.session.state).toBe('PASS')
    expect(snap.notice).toContain('判定通过')
  })

  it('testApiConnection blocks every missing prerequisite before any request', async () => {
    // Distinguishes the three guards; the plain costConfirmed case lives in
    // tests/integration/dispatch-branches.test.ts (avoid duplicate sentinels).
    const { api } = makeRuntime()
    let r = await api.testApiConnection()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('API Key')

    await api.setApiKey('sk-test')
    r = await api.testApiConnection()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Base URL')

    await api.setApiConfig({ model: 'm', baseUrl: 'https://example.com/v1', costConfirmed: true })
    r = await api.testApiConnection()
    // All guards passed, but the default provider has no testConnection: must
    // fail gracefully instead of throwing (and must not send any request).
    expect(r.ok).toBe(false)
    expect(r.message).toContain('不支持连接测试')
  })
})
