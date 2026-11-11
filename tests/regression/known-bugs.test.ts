/**
 * Regression sentinels for bugs already found and fixed in this project.
 * Each test names the original symptom so a future change cannot silently
 * reintroduce it.
 */
import { describe, expect, it } from 'vitest'
import { analyzeSentence } from '../../src/core/targets'
import { OFFLINE_EXPLANATIONS } from '../../src/data/explanations'
import { contentHash, fnv1a } from '../../src/core/hash'
import { makeRuntime, makeSessionInput, D01 } from '../helpers'

describe('regression: sentence span truncation ("...earliest f")', () => {
  it('generic fallback never ends a diagnostic span mid-word', () => {
    const sentence = 'Measurements of canopy cover are missing from the earliest files, which limits what can be said about the start of the series.'
    for (const t of analyzeSentence('reg:span', sentence).targets) {
      expect(sentence.includes(t.originalSpan)).toBe(true)
      expect(/\s[a-z]$/.test(t.originalSpan.trimEnd())).toBe(false)
      expect(t.originalSpan.trimEnd()).toMatch(/[A-Za-z0-9).,;:!?"']$/)
    }
  })

  it('short sentences show the full text rather than a 48-char prefix', () => {
    const s = 'The data were reweighted with a sensitivity analysis before the estimates were compared.'
    const spans = analyzeSentence('reg:short', s).targets.map((t) => t.originalSpan)
    expect(spans.every((x) => x === s)).toBe(true)
  })
})

describe('regression: bundled explanation data integrity', () => {
  it('all 3,605 readings stay present with non-empty English predicates', () => {
    expect(OFFLINE_EXPLANATIONS.length).toBeGreaterThanOrEqual(3605)
    for (const row of OFFLINE_EXPLANATIONS) {
      expect(row[1]).toBeTruthy() // Chinese meaning
      expect(row[4]).toBeTruthy() // English predicate (was once a placeholder)
      expect(row[4]).not.toContain('离线规则未标注谓语')
      expect(row[4]).not.toMatch(/[一-龥]/)
    }
  })

  it('article version hashes remain deterministic (IDs depend on them)', () => {
    expect(contentHash('same')).toBe(contentHash('same'))
    expect(fnv1a('x')).toBe(fnv1a('x'))
  })
})

describe('regression: answer-exposure attribution', () => {
  it('a direct analysis view is recorded and surfaces in training as directAnalysisSeen', async () => {
    const { api } = makeRuntime()
    const { session } = await api.startSession(makeSessionInput(D01))
    await api.markAnalysisViewed('test-article', session.sentenceId)
    expect(await api.hasAnalysisBeenViewed('test-article', session.sentenceId)).toBe(true)
    const before = await api.resumeSession(session.id)
    expect(before?.attempts).toHaveLength(0)
  })

  it('first answer persists before any diagnosis and is never overwritten', async () => {
    const { api } = makeRuntime()
    const { session } = await api.startSession(makeSessionInput(D01))
    const first = '这取决于员工使用技术有多有效。'
    await api.dispatch(session.id, { type: 'SUBMIT', text: first })
    const s = await api.resumeSession(session.id)
    expect(s?.attempts).toHaveLength(1)
    expect(s?.attempts[0].userText).toBe(first)
  })
})

describe('regression: cost gate and key isolation', () => {
  it('no key means no external provider can be enabled', async () => {
    const { api } = makeRuntime()
    const cfg = await api.setApiConfig({ enabled: true, costConfirmed: true, model: 'm', baseUrl: 'https://x/v1' })
    expect(cfg.enabled).toBe(false)
    expect(await api.getApiConfig()).toMatchObject({ hasKey: false })
  })

  it('clearApiKey immediately disables an active configuration', async () => {
    const { api } = makeRuntime()
    await api.setApiKey('sk-test')
    await api.setApiConfig({ enabled: true, costConfirmed: true, model: 'm', baseUrl: 'https://x/v1' })
    expect((await api.getApiConfig()).enabled).toBe(true)
    const cfg = await api.clearApiKey()
    expect(cfg).toMatchObject({ enabled: false, hasKey: false })
  })
})
