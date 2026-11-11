import { describe, expect, it } from 'vitest'
import { contentHash } from '../src/core/hash'
import { createArticle, segmentArticle, splitParagraphs, splitSentences } from '../src/core/segment'

describe('R01 / article segmentation', () => {
  it('keeps every punctuation mark when splitting sentences', () => {
    const text = 'Dr. Smith said it clearly. Success depends less on speed than on accuracy! Is that true? Yes.'
    const parts = splitSentences(text)
    expect(parts.length).toBe(4)
    const punctuation = (s: string) => (s.match(/[.!?]/g) ?? []).length
    expect(parts.reduce((n, p) => n + punctuation(p.text), 0)).toBe(punctuation(text))
    expect(parts[0].text).toContain('Dr. Smith')
    expect(parts[1].text.endsWith('!')).toBe(true)
    expect(parts[2].text.endsWith('?')).toBe(true)
  })

  it('does not split on decimal points or abbreviations', () => {
    const parts = splitSentences('The figure rose by 3.5 per cent. The system was designed to reduce costs.')
    expect(parts.length).toBe(2)
    expect(parts[0].text).toContain('3.5')
  })

  it('preserves paragraphs from pasted plain text', () => {
    const input = 'First paragraph, sentence one. Sentence two.\n\nSecond paragraph has one line.\n\nThird.'
    const ps = splitParagraphs(input)
    expect(ps).toHaveLength(3)
    expect(ps[0]).toContain('Sentence two.')
    expect(ps[2]).toBe('Third.')
  })

  it('produces stable ids and a version hash bound to the exact original text', () => {
    const a = createArticle({ originalText: 'Hello world. Another one.', id: 'a1', now: '2026-01-01T00:00:00.000Z' })
    const b = createArticle({ originalText: 'Hello world. Another one.', id: 'a1', now: '2026-01-01T00:00:00.000Z' })
    expect(a.versionHash).toBe(b.versionHash)
    expect(segmentArticle(a)[0].sentences[0].id).toBe(segmentArticle(b)[0].sentences[0].id)
    const edited = createArticle({ originalText: 'Hello world. Another one!', id: 'a1', now: '2026-01-01T00:00:00.000Z' })
    expect(edited.versionHash).not.toBe(a.versionHash)
    expect(contentHash('x')).toHaveLength(16)
  })

  it('R08: treats HTML-like article content as inert text, never as markup', () => {
    const raw = '<script>alert(1)</script> The system was designed to reduce costs.'
    const a = createArticle({ originalText: raw, id: 'unsafe' })
    const sentences = segmentArticle(a)[0].sentences
    expect(sentences.map((s) => s.text).join(' ')).toContain('<script>')
    expect(a.originalText).toBe(raw)
    // React escapes text nodes; the store never stores executable HTML nodes.
    expect(a.versionHash).toBe(contentHash(raw))
  })
})
