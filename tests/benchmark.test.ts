import { describe, expect, it } from 'vitest'
import { analyzeSentence } from '../src/core/targets'
import { MockRuleProvider } from '../src/core/diagnose'
import { validateDiagnosis } from '../src/core/validator'
import { decide } from '../src/core/machine'
import { ADVERSARIAL_CASES, BENCHMARK_CASES, SAMPLE_ARTICLE_INPUTS } from '../src/core/samples'
import { createArticle, segmentArticle, allSentences } from '../src/core/segment'

const provider = new MockRuleProvider()

async function run(sentence: string, answer: string, id: string) {
  const analysis = analyzeSentence(id, sentence)
  const raw = await provider.diagnose({
    analysis, attemptText: answer, contextBefore: '', contextAfter: '', level: 0, attemptSequence: 1,
  })
  const validation = validateDiagnosis(raw, analysis, sentence, answer)
  const coreIds = analysis.targets.filter((t) => t.weight === 'core').map((t) => t.id)
  const core = raw.evidences.find((e) => coreIds.includes(e.targetId))
  const decision = decide({
    evidences: raw.evidences,
    attemptSequence: 1, clarifyCount: 0, retryCount: 0, answerRevealed: false,
    suggestedAction: raw.suggestedAction,
  })
  return { analysis, raw, validation, core, decision }
}

describe('D01-D12 human-labelled baseline', () => {
  for (const c of BENCHMARK_CASES) {
    it(`${c.id}: ${c.note}`, async () => {
      const { raw, validation, core, decision } = await run(c.sentence, c.answer, `bench-${c.id}`)
      expect(validation.valid, validation.issues.join('; ')).toBe(true)
      expect(core?.status).toBe(c.expectedCoreStatus)
      expect(decision.action).toBe(c.expectedAction)
      // Evidence authenticity: every quote must be a verbatim substring of the answer.
      for (const e of raw.evidences) {
        if (e.answerQuote) expect(c.answer.includes(e.answerQuote)).toBe(true)
        expect(c.sentence.includes(e.originalSpan)).toBe(true)
      }
    })
  }
})

describe('adversarial cases: reasonable simplification is never an error', () => {
  for (const c of ADVERSARIAL_CASES) {
    it(`${c.id}: ${c.note}`, async () => {
      const { core, validation } = await run(c.sentence, c.answer, `adv-${c.id}`)
      expect(validation.valid).toBe(true)
      expect(core?.status).not.toBe(c.forbiddenCoreStatus)
    })
  }
})

describe('generic fallback spans never cut a word in half', () => {
  it('ends diagnostic spans on a whole word for long sentences', () => {
    const sentence = 'Measurements of canopy cover are missing from the earliest files, which limits what can be said about the start of the series.'
    const analysis = analyzeSentence('generic:span:test', sentence)
    for (const t of analysis.targets) {
      expect(sentence.includes(t.originalSpan), `span must be verbatim: ${t.originalSpan}`).toBe(true)
      // A truncated fragment like "...earliest f" ends mid-word; a valid span
      // must end at a word boundary or at the true end of the sentence.
      const endsWhole = t.originalSpan === sentence || /[A-Za-z0-9)\].,;:!?"']$/.test(t.originalSpan.trimEnd())
      expect(endsWhole, `span ends mid-word: ${t.originalSpan}`).toBe(true)
      expect(/\s[a-z]$/.test(t.originalSpan.trimEnd()), `trailing single letter: ${t.originalSpan}`).toBe(false)
    }
  })
})

describe('diagnosis quality invariants', () => {
  it('accepts a correct answer that names no grammar terminology', async () => {
    // Actually run the diagnosis pipeline instead of inspecting the fixture's
    // strings: the invariant is about the evaluator, not the test data.
    for (const c of BENCHMARK_CASES.filter((x) => ['D09', 'D10'].includes(x.id))) {
      expect(c.answer).not.toMatch(/从句|定语|主语|谓语/)
      const { validation, core, decision } = await run(c.sentence, c.answer, `bench-terms-${c.id}`)
      expect(validation.valid, validation.issues.join('; ')).toBe(true)
      expect(core?.status).toBe('correct')
      expect(decision.action).toBe('PASS')
    }
  })

  it('produces non-empty, verifiable targets for every sample-article sentence', () => {
    for (const sample of SAMPLE_ARTICLE_INPUTS) {
      const article = createArticle({ originalText: sample.text, id: 'sample-check' })
      const sentences = allSentences(segmentArticle(article))
      expect(sentences.length).toBeGreaterThan(3)
      for (const s of sentences) {
        const analysis = analyzeSentence(s.id, s.text)
        expect(analysis.targets.length).toBeGreaterThan(0)
        for (const t of analysis.targets) expect(s.text.includes(t.originalSpan)).toBe(true)
      }
    }
  })

  it('flags a genuinely ambiguous pronoun as disputed rather than incorrect', () => {
    const sentence = 'Teachers receive printed resources and digital ones. How effectively teachers integrate them into their lessons varies widely.'
    return run(sentence, '老师把这些材料用进课堂的效果差别很大。', 'amb-1').then(({ raw }) => {
      expect(raw.evidences.some((e) => e.status === 'disputed')).toBe(true)
      expect(raw.evidences.every((e) => e.status !== 'incorrect')).toBe(true)
    })
  })
})
