import { describe, expect, it } from 'vitest'
import { makeRuntime } from '../helpers'

const SENTENCE = 'The extent to which technology improves productivity depends on how effectively employees use it.'

describe('regression: wrong-word notebook', () => {
  it('stores a real dictionary snapshot plus the source sentence', async () => {
    const { api } = makeRuntime()
    const r = await api.addWrongWord({
      query: 'extent',
      sentenceText: SENTENCE,
      articleId: 'a1',
    })
    expect(r.added).toBe(true)
    expect(r.word).toMatchObject({
      word: 'extent',
      query: 'extent',
      found: true,
      sentenceText: SENTENCE,
      articleId: 'a1',
    })
    // The meaning must be genuine dictionary data, not a placeholder.
    expect(r.word?.translation).toContain('范围')
    expect(r.word?.translation.length).toBeGreaterThan(4)

    const list = await api.listWrongWords()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(r.word?.id)
  })

  it('deduplicates inflected forms onto their lemma', async () => {
    const { api } = makeRuntime()
    const first = await api.addWrongWord({ query: 'ran' })
    expect(first.word?.word).toBe('run')
    expect(first.word?.base).toBe('run')

    const again = await api.addWrongWord({ query: 'run' })
    expect(again.added).toBe(false)
    expect(again.word?.id).toBe(first.word?.id)

    const upper = await api.addWrongWord({ query: 'RUN' })
    expect(upper.added).toBe(false)
    expect(await api.listWrongWords()).toHaveLength(1)
  })

  it('persists across restart, supports removal, and is cleared by deleteAllData', async () => {
    const h = makeRuntime()
    const a = await h.api.addWrongWord({ query: 'productivity' })
    const b = await h.api.addWrongWord({ query: 'extent' })

    const restarted = h.restart()
    expect((await restarted.listWrongWords()).map((w) => w.word).sort()).toEqual(['extent', 'productivity'])

    await restarted.removeWrongWord(a.word!.id)
    expect((await restarted.listWrongWords()).map((w) => w.word)).toEqual(['extent'])

    // A second runtime over the same storage sees the same surviving row.
    expect(await h.restart().listWrongWords()).toHaveLength(1)

    await restarted.deleteAllData()
    expect(await restarted.listWrongWords()).toEqual([])
    expect(b.word?.id).toBeDefined()
  })

  it('an unlisted word is still saved with an honest fallback meaning', async () => {
    const { api } = makeRuntime()
    const r = await api.addWrongWord({ query: 'zzzqqqxx' })
    expect(r.word).toMatchObject({ word: 'zzzqqqxx', found: false, tags: [] })
    expect(r.word?.translation).toContain('未收录')
  })

  it('empty input never creates a row', async () => {
    const { api } = makeRuntime()
    expect(await api.addWrongWord({ query: '   ' })).toEqual({ added: false, word: null })
    expect(await api.listWrongWords()).toEqual([])
  })

  it('wrong words are included in export and never in the learning profile', async () => {
    const { api } = makeRuntime()
    await api.addWrongWord({ query: 'extent' })
    const dump = await api.exportData()
    expect(dump).toContain('extent')
    const profile = await api.getProfile()
    expect(profile.observations).toHaveLength(0)
    expect(profile.marks).toHaveLength(0)
  })
})
