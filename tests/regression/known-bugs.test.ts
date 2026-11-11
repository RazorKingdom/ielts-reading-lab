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
  // Must be >200 chars: genericTargets only calls leadingSpan() for long
  // sentences (src/core/targets.ts:554/567). A short sentence would make this
  // test pass even if the half-word bug returned.
  const LONG = 'Measurements of canopy cover are missing from the earliest files, which limits what can be said about the start of the series and about how the ranking was subsequently compared across the participating sites.'

  it('generic fallback trims to a word boundary, never mid-word', () => {
    expect(LONG.length).toBeGreaterThan(200) // guard: the input must trigger leadingSpan
    const targets = analyzeSentence('reg:span', LONG).targets
    // The bug produced a 48/60-char fragment ending in "...earliest f".
    // Assert the truncation path is actually exercised (a real prefix).
    const truncated = targets.filter((t) => t.originalSpan !== LONG)
    expect(truncated.length).toBeGreaterThan(0)
    for (const t of truncated) {
      expect(t.originalSpan.length).toBeLessThan(LONG.length)
      expect(LONG.startsWith(t.originalSpan)).toBe(true)
      expect(/\s[a-z]$/.test(t.originalSpan.trimEnd())).toBe(false)
      // A word-boundary cut ends on a letter/digit/punctuation, not a space.
      expect(t.originalSpan.trimEnd()).toMatch(/[A-Za-z0-9),.;:!?"']$/)
      // Specifically: the cut must not split "earliest" into "earliest f".
      expect(t.originalSpan).not.toMatch(/\b[a-z]+ [a-z]$/)
    }
    for (const t of targets) expect(LONG.includes(t.originalSpan)).toBe(true)
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

  it('article version hashes keep their exact wire format (IDs depend on them)', () => {
    // Anchor exact values: `f(x) === f(x)` would pass even for `return 0`.
    expect(contentHash('same')).toBe('cd0c4a3bd6532fdf')
    expect(fnv1a('x')).toBe(4245442695)
    expect(contentHash('other')).not.toBe(contentHash('same'))
    expect(contentHash('same').slice(8)).not.toBe(contentHash('same').slice(0, 8))
  })
})

describe('regression: answer-exposure attribution', () => {
  it('prior direct-analysis exposure downgrades a correct answer to assisted', async () => {
    // Two contrasting sessions: the only difference is directAnalysisSeen.
    // This asserts the full chain startSession -> observationResult, not just
    // that an exposure flag was stored.
    const { api } = makeRuntime()
    await api.markAnalysisViewed('test-article', 'sentence')
    expect(await api.hasAnalysisBeenViewed('test-article', 'sentence')).toBe(true)

    // CORRECT_D01 is the human-labelled fully correct answer; a partial answer
    // would raise the hint level and produce assisted-correct for both groups.
    const CORRECT = '技术提高生产率的程度取决于员工使用技术有多有效。'
    const unaided = await api.startSession(makeSessionInput(D01, { directAnalysisSeen: false }))
    await api.dispatch(unaided.session.id, { type: 'SUBMIT', text: CORRECT })
    const seen = await api.startSession(makeSessionInput(D01, { directAnalysisSeen: true }))
    await api.dispatch(seen.session.id, { type: 'SUBMIT', text: CORRECT })

    const profile = await api.getProfile()
    const results = profile.observations.map((o) => o.result)
    expect(results).toContain('independent-correct')
    expect(results).toContain('assisted-correct')
  })

  it('first answer persists before any diagnosis and is never overwritten', async () => {
    const { api } = makeRuntime()
    const { session } = await api.startSession(makeSessionInput(D01))
    const first = '这取决于员工使用技术有多有效。'
    await api.dispatch(session.id, { type: 'SUBMIT', text: first })
    const s = await api.resumeSession(session.id)
    expect(s?.attempts).toHaveLength(1)
    expect(s?.attempts[0].userText).toBe(first)
    // A second expression is stored as a separate row; attempt #1 is intact.
    const second = await api.dispatch(session.id, { type: 'SUBMIT', text: '再说一次：取决于使用效果。' })
    expect(second.attempts).toHaveLength(2)
    expect(second.attempts[0].userText).toBe(first)
  })
})

describe('regression: cost gate and key isolation', () => {
  it('enabling is refused when ANY of the four prerequisites is missing', async () => {
    // The integration suite only covers "all four present => success". These
    // negative combinations catch a gate that silently drops one condition.
    const full = { enabled: true, costConfirmed: true, model: 'm', baseUrl: 'https://x/v1' }
    for (const missing of ['costConfirmed', 'model', 'baseUrl'] as const) {
      const { api } = makeRuntime()
      await api.setApiKey('sk-test')
      const patch = { ...full, [missing]: missing === 'costConfirmed' ? false : '' }
      expect((await api.setApiConfig(patch)).enabled, `missing ${missing}`).toBe(false)
    }
    // And a key-less config must never enable.
    const { api: noKey } = makeRuntime()
    expect((await noKey.setApiConfig(full)).enabled).toBe(false)
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
