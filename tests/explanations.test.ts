import { describe, expect, it } from 'vitest'
import { ARTICLE_BANK } from '../src/core/articleBank'
import { allSentences, createArticle, segmentArticle } from '../src/core/segment'
import { analysisWithOffline, offlineExplanationCount } from '../src/core/explanations'
import { analyzeSentence } from '../src/core/targets'

describe('bundled offline explanations for all 100 passages', () => {
  it('ships one full Chinese reading per sentence', () => {
    expect(offlineExplanationCount()).toBeGreaterThan(3500)
    let checked = 0
    ARTICLE_BANK.forEach((article, index) => {
      const built = createArticle({ originalText: article.text, id: `sample-${index + 1}` })
      for (const sentence of allSentences(segmentArticle(built))) {
        const analysis = analysisWithOffline(sentence.id, sentence.text)
        expect(analysis.source, `${sentence.id}: ${sentence.text}`).toBe('bundled')
        expect(analysis.meaning.length).toBeGreaterThan(8)
        expect(analysis.meaning).not.toContain('离线规则未给出权威参考译文')
        expect(analysis.layers.length).toBeGreaterThanOrEqual(3)
        expect(analysis.followUps.length).toBeGreaterThanOrEqual(2)
        // Every built-in sentence must carry a real Chinese SVO skeleton —
        // the placeholder predicate was the original user-visible bug.
        expect(analysis.skeleton.subject, `subject ${sentence.id}`).not.toBe('')
        expect(analysis.skeleton.predicate, `predicate ${sentence.id}`).not.toBe('')
        expect(analysis.skeleton.predicate, `predicate ${sentence.id}`).not.toContain('离线规则未标注谓语')
        expect(/[A-Za-z]/.test(analysis.skeleton.predicate), `english predicate ${sentence.id}`).toBe(true)
        expect(/[一-龥]/.test(analysis.skeleton.predicate), `no Chinese in predicate ${sentence.id}`).toBe(false)
        checked++
      }
    })
    expect(checked).toBe(offlineExplanationCount())
  })

  it('supplies a real skeleton for the 97 composed passages, not just the focus ones', () => {
    const built = createArticle({ originalText: ARTICLE_BANK[50].text, id: 'sample-51' })
    const sentence = allSentences(segmentArticle(built))[0]
    const analysis = analysisWithOffline(sentence.id, sentence.text)
    expect(analysis.source).toBe('bundled')
    expect(analysis.skeleton.predicate).not.toContain('离线')
    expect(analysis.skeleton.note).toContain('English clause skeleton')
  })

  it('uses English fragments taken from the original sentence', () => {
    let matched = 0
    let checked = 0
    ARTICLE_BANK.forEach((article, index) => {
      const built = createArticle({ originalText: article.text, id: `sample-${index + 1}` })
      for (const sentence of allSentences(segmentArticle(built))) {
        const a = analysisWithOffline(sentence.id, sentence.text)
        const source = sentence.text.toLowerCase()
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
        // The predicate is a contiguous fragment of the source clause in every
        // composed frame; allow the leading "that" to be dropped from objects.
        if (norm(source).includes(norm(a.skeleton.predicate))) matched++
        checked++
      }
    })
    expect(checked).toBe(offlineExplanationCount())
    expect(matched / checked).toBeGreaterThan(0.9)
  })

  it('never changes diagnostic targets or spans', () => {
    const built = createArticle({ originalText: ARTICLE_BANK[3].text, id: 'sample-4' })
    const sentence = allSentences(segmentArticle(built))[0]
    const base = analyzeSentence(sentence.id, sentence.text)
    const enriched = analysisWithOffline(sentence.id, sentence.text)
    expect(enriched.targets).toEqual(base.targets)
    expect(enriched.chunks).toEqual(base.chunks)
    expect(enriched.phrases).toEqual(base.phrases)
    expect(enriched.targets[0].originalSpan).toBeTruthy()
  })

  it('falls back to the local conservative analysis for imported sentences', () => {
    const custom = analysisWithOffline('imported:s1', 'This sentence was pasted in by the learner.')
    expect(custom.source).toBe('local')
    expect(custom.targets.length).toBeGreaterThan(0)
    expect(custom.meaning).toContain('离线规则未给出权威参考译文')
    expect(custom.skeleton.predicate).toContain('离线规则未标注谓语')
  })

  it('keeps the labelled focus sentences under their hardcoded rules', () => {
    const first = createArticle({ originalText: ARTICLE_BANK[0].text, id: 'sample-1' })
    const sentence = allSentences(segmentArticle(first))[1]
    const analysis = analysisWithOffline(sentence.id, sentence.text)
    expect(analysis.source).toBe('bundled')
    expect(analysis.meaning).toContain('技术能在多大程度上提高生产率')
  })
})
