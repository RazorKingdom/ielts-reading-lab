/**
 * Regression sentinels for the six confirmed guidance-logic bugs found in the
 * 2026-11-11 review. Each test reproduces the original symptom with the REAL
 * runtime (no mocked store), so reintroducing the bug fails the suite.
 */
import { describe, expect, it } from 'vitest'
import { makeRuntime, makeSessionInput, D01 } from '../helpers'

const CORRECT = '技术提高生产率的程度取决于员工使用技术有多有效。'
const WRONG = '技术提高了生产率，所以员工更有效地用它。'

async function started(seen = false) {
  const h = makeRuntime()
  const { session } = await h.api.startSession(makeSessionInput(D01, { directAnalysisSeen: seen }))
  return { ...h, id: session.id }
}

describe('regression: hint levels stop at L3', () => {
  it('L3 is idempotent: no L4 button, no duplicate full-analysis rows', async () => {
    const { api, id } = await started()
    await api.dispatch(id, { type: 'SUBMIT', text: WRONG })
    let snap = await api.dispatch(id, { type: 'REQUEST_HINT' }) // L2
    snap = await api.dispatch(id, { type: 'REQUEST_HINT' }) // L3
    expect(snap.session.currentLevel).toBe(3)
    expect(snap.session.answerRevealed).toBe(true)
    expect(snap.availableIntents).not.toContain('REQUEST_HINT')
    expect(snap.availableIntents).not.toContain('UNLOCK_LEVEL3')

    // Even a direct dispatch (bypassing the intent list) must not append again.
    snap = await api.dispatch(id, { type: 'REQUEST_HINT' })
    expect(snap.session.currentLevel).toBe(3)
    const resumed = await api.resumeSession(id)
    expect(resumed?.feedback.filter((f) => f.kind === 'full')).toHaveLength(1)
  })
})

describe('regression: exposure and teaching decisions agree', () => {
  it('a correct answer after seeing L3 does not claim independent assessment', async () => {
    const { api, id } = await started()
    await api.dispatch(id, { type: 'UNLOCK_LEVEL3' })
    const snap = await api.dispatch(id, { type: 'SUBMIT', text: CORRECT })
    expect(snap.session.state).toBe('PASS')
    expect(snap.notice).not.toContain('保持独立测评')
    expect(snap.notice).toContain('不计独立测评')
    const pass = snap.feedback.filter((f) => f.kind === 'pass').at(-1)
    expect(pass?.level).toBe(3) // was hardcoded to 0
    expect(snap.decisions.at(-1)?.reasonCodes).toContain('answer-already-revealed')
  })

  it('「不知道」 persists an EXPLAIN decision, not CLARIFY', async () => {
    const { api, id } = await started()
    const snap = await api.dispatch(id, { type: 'SUBMIT', text: '不知道。' })
    expect(snap.session.state).toBe('EXPLAIN')
    expect(snap.session.currentLevel).toBe(3)
    expect(snap.decisions.at(-1)?.action).toBe('EXPLAIN')
    expect(snap.decisions.at(-1)?.reasonCodes).toContain('unknown-answer-direct-explanation')
  })
})

describe('regression: profile attribution is not rewritten', () => {
  it('UNLOCK_LEVEL3 never turns an incorrect observation into assisted-correct', async () => {
    const { api, id } = await started()
    await api.dispatch(id, { type: 'SUBMIT', text: WRONG })
    const before = await api.getProfile()
    const incorrect = before.observations.filter((o) => o.result === 'incorrect')
    expect(incorrect.length).toBeGreaterThan(0)

    const snap = await api.dispatch(id, { type: 'UNLOCK_LEVEL3' })
    const after = await api.getProfile()
    // The original incorrect row must still be the effective one.
    const latest = new Map<string, typeof after.observations[number]>()
    for (const o of after.observations) latest.set(`${o.sessionId}|${o.targetId}`, o)
    for (const o of incorrect) {
      expect(latest.get(`${o.sessionId}|${o.targetId}`)?.result).toBe('incorrect')
    }
    expect(after.stats.incorrect).toBe(before.stats.incorrect)

    // A second unlock must be idempotent.
    const again = await api.dispatch(id, { type: 'UNLOCK_LEVEL3' })
    expect(again.notice).toContain('已展示过')
    expect((await api.resumeSession(id))?.feedback.filter((f) => f.kind === 'full')).toHaveLength(1)
  })
})

describe('regression: transfer answer is not leaked or scored after exposure', () => {
  it('TRANSFER offers no L3 unlock and level3Content never reveals the answer', async () => {
    const { api, id } = await started()
    await api.dispatch(id, { type: 'SUBMIT', text: CORRECT })
    const snap = await api.dispatch(id, { type: 'ACCEPT_TRANSFER' })
    expect(snap.session.state).toBe('TRANSFER')
    expect(snap.availableIntents).not.toContain('UNLOCK_LEVEL3')

    const transfer = (await api.resumeSession(id))?.session.transfer
    expect(transfer?.meaning).toBeTruthy()
    // Defence in depth: even a forced unlock must not leak the meaning.
    const forced = await api.dispatch(id, { type: 'UNLOCK_LEVEL3' })
    const fullText = forced.feedback.filter((f) => f.kind === 'full').map((f) => f.content).join('\n')
    expect(fullText).not.toContain(transfer!.meaning.slice(0, 12))
  })

  it('a transfer answered after exposure is unscored and creates no review task', async () => {
    const { api, id } = await started()
    await api.dispatch(id, { type: 'SUBMIT', text: CORRECT })
    await api.dispatch(id, { type: 'ACCEPT_TRANSFER' })
    await api.dispatch(id, { type: 'UNLOCK_LEVEL3' }) // force exposure
    const before = (await api.getProfile()).reviewTasks.length
    const snap = await api.dispatch(id, { type: 'SUBMIT_TRANSFER', text: '政策减少排放取决于家庭执行得多持续。' })
    expect(snap.session.transferAttempt?.result).toBe('unscored')
    expect(snap.session.state).toBe('COMPLETE')
    expect((await api.getProfile()).reviewTasks.length).toBe(before)
  })
})

describe('regression: prior direct analysis is treated as exposure', () => {
  it('directAnalysisSeen starts revealed, not a green "L0 独立"', async () => {
    const h = makeRuntime()
    const { session } = await h.api.startSession(makeSessionInput(D01, { directAnalysisSeen: true }))
    expect(session.answerRevealed).toBe(true)
    expect(session.currentLevel).toBe(3)
    const snap = await h.api.resumeSession(session.id)
    expect(snap?.availableIntents).not.toContain('UNLOCK_LEVEL3')
  })
})
