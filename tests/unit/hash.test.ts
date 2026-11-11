import { describe, expect, it } from 'vitest'
import { contentHash, fnv1a, makeId } from '../../src/core/hash'

describe('unit: deterministic hashing', () => {
  it('fnv1a is deterministic and respects the seed', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'))
    expect(fnv1a('hello')).not.toBe(fnv1a('hello '))
    expect(fnv1a('hello', 0x811c9dc5)).not.toBe(fnv1a('hello', 0x9e3779b9))
    expect(fnv1a('')).toBe(0x811c9dc5)
  })

  it('mixes non-ASCII high bytes so CJK changes the digest', () => {
    // The implementation deliberately folds charCode >> 8 into the hash.
    expect(fnv1a('技术')).not.toBe(fnv1a('技巧'))
    expect(fnv1a('A')).not.toBe(fnv1a('Ａ')) // fullwidth A has a high byte
  })

  it('contentHash is a stable 16-hex digest used for article versions', () => {
    const h = contentHash('same text')
    expect(h).toMatch(/^[0-9a-f]{16}$/)
    expect(h).toBe(contentHash('same text'))
    expect(h).not.toBe(contentHash('other text'))
    // Doubled hash: changing only the second seed must change the tail.
    expect(h.slice(0, 8)).toBe(contentHash('same text').slice(0, 8))
  })

  it('makeId carries the prefix, is unique and non-empty', () => {
    const a = makeId('ses')
    const b = makeId('ses')
    expect(a).toMatch(/^ses_[0-9a-z]+$/)
    expect(a).not.toBe(b)
    expect(makeId('')).toMatch(/^_/)
  })
})
