import { describe, expect, it } from 'vitest'
import {
  clearDictionaryCache,
  dictionarySize,
  extractWordAt,
  lookupWord,
  normalizeQuery,
} from '../src/core/dictionary'

describe('offline word lookup', () => {
  it('loads a bundled dictionary without any network call', () => {
    expect(dictionarySize()).toBeGreaterThan(0)
    clearDictionaryCache()
    expect(dictionarySize()).toBeGreaterThan(0)
  })

  it('finds an exact word case-insensitively and with surrounding punctuation', () => {
    for (const q of ['example', 'Example', '  EXAMPLE  ', '“example”']) {
      const r = lookupWord(q)
      expect(r.found, q).toBe(true)
      expect(r.entry?.word).toBe('example')
      expect(r.entry?.translation).toContain('例子')
    }
  })

  it('normalizes selections into progressively speculative candidates', () => {
    const list = normalizeQuery('Examples,')
    expect(list[0]).toBe('examples,')
    expect(list).toContain('example')
    expect(normalizeQuery('')).toEqual([])
    const irregular = normalizeQuery('better')
    expect(irregular).toContain('good')
  })

  it('resolves a plural form to either its own entry or the recovered lemma', () => {
    const r = lookupWord('examples')
    expect(r.found).toBe(true)
    expect(['example', 'examples']).toContain(r.entry?.word)
    expect(r.entry?.translation.length).toBeGreaterThan(2)
  })

  it('reports an unknown word honestly and offers nearby entries', () => {
    const r = lookupWord('zzzznotaword')
    expect(r.found).toBe(false)
    expect(r.entry).toBeUndefined()
    expect(r.note).toMatch(/未收录/)
    expect(Array.isArray(r.suggestions)).toBe(true)
  })

  it('picks the word at a click offset, including word boundaries', () => {
    const text = 'The technology improves productivity.'
    expect(extractWordAt(text, 5)).toBe('technology')
    expect(extractWordAt(text, 14)).toBe('technology') // on the trailing space
    expect(extractWordAt(text, 15)).toBe('improves')
    expect(extractWordAt(text, 16)).toBe('improves')
    expect(extractWordAt('well-known results', 2)).toBe('well-known')
  })

  it('never leaks a network/AI dependency into the result', () => {
    const r = lookupWord('example')
    expect(JSON.stringify(r)).not.toMatch(/https?:|apiKey|Bearer|fetch/i)
  })
})
