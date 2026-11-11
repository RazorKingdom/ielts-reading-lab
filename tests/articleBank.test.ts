import { describe, expect, it } from 'vitest'
import { ARTICLE_BANK, ARTICLE_BANK_SIZE, ARTICLE_BANK_VERSION } from '../src/core/articleBank'
import { allSentences, createArticle, segmentArticle } from '../src/core/segment'
import { ruleIdFor } from '../src/core/targets'
import { makeRuntime } from './helpers'

describe('built-in article bank (100 original passages)', () => {
  it('has 100 unique titles and clear non-official provenance', () => {
    expect(ARTICLE_BANK_SIZE).toBe(100)
    expect(ARTICLE_BANK).toHaveLength(100)
    expect(new Set(ARTICLE_BANK.map((a) => a.title)).size).toBe(100)
    for (const a of ARTICLE_BANK) {
      expect(a.sourceNote).toContain('非官方真题')
      expect(a.text.length).toBeGreaterThan(200)
      // No passage may contain markup: articles are untrusted plain text.
      expect(a.text).not.toMatch(/<[a-z!\/]/i)
    }
  })

  it('every passage is 700-900 words, like an IELTS reading text', () => {
    for (const a of ARTICLE_BANK) {
      const words = a.text.trim().split(/\s+/).length
      expect(words, `${a.title}: ${words} words`).toBeGreaterThanOrEqual(700)
      expect(words, `${a.title}: ${words} words`).toBeLessThanOrEqual(900)
    }
  })

  it('splits every passage without losing punctuation or characters', () => {
    for (const a of ARTICLE_BANK) {
      const article = createArticle({ originalText: a.text, id: `check-${a.title}` })
      const paragraphs = segmentArticle(article)
      expect(allSentences(paragraphs).length).toBeGreaterThan(3)
      for (const p of paragraphs) {
        const rebuilt = p.sentences.map((s) => p.text.slice(s.startOffset, s.endOffset)).join('')
        expect(rebuilt.replace(/\s+/g, '')).toBe(p.text.replace(/\s+/g, ''))
      }
    }
  })

  it('keeps the 97 composed passages on the conservative generic path', () => {
    // A hardcoded rule (e.g. the D01 reference translation) must never be
    // applied to an unrelated sentence, otherwise the app would show a
    // confident but wrong "reference meaning".
    for (const a of ARTICLE_BANK.slice(3)) {
      const article = createArticle({ originalText: a.text, id: `rule-${a.title}` })
      for (const s of allSentences(segmentArticle(article))) {
        expect(ruleIdFor(s.text), `${a.title}: ${s.text}`).toBe('generic')
      }
    }
  })
})

describe('article bank top-up on an existing database', () => {
  it('seeds once, never duplicates on later boots, and respects deletions', async () => {
    const { api, restart } = makeRuntime()
    const first = await api.bootstrap()
    expect(first.articles).toHaveLength(100)
    expect(first.settings.sampleBankVersion).toBe(ARTICLE_BANK_VERSION)

    const second = await api.bootstrap()
    expect(second.articles).toHaveLength(100)

    await api.deleteArticle('sample-50')
    const afterRestart = await restart().bootstrap()
    expect(afterRestart.articles).toHaveLength(99)
    expect(afterRestart.articles.some((a) => a.id === 'sample-50')).toBe(false)
  })

  it('refreshes stale built-in content on a version bump without resurrecting deletions', async () => {
    const { api, storage } = makeRuntime()
    await api.bootstrap()
    const key = 'ielts-reading-lab:v1'
    const db = JSON.parse(storage.getItem(key) as string)
    db.settings.sampleBankVersion = 1
    const stale = db.articles.find((a: { id: string }) => a.id === 'sample-50')
    stale.originalText = 'A very short old passage.'
    storage.setItem(key, JSON.stringify(db))

    const refreshed = await api.bootstrap()
    const long = refreshed.articles.find((a) => a.id === 'sample-50')!
    expect(long.originalText.length).toBeGreaterThan(2000)
    expect(refreshed.settings.sampleBankVersion).toBe(ARTICLE_BANK_VERSION)

    await api.deleteArticle('sample-60')
    await api.setSettings({ sampleBankVersion: 1 })
    const after = await api.bootstrap()
    expect(after.articles.some((a) => a.id === 'sample-60')).toBe(false)
  })

  it('does not overwrite user-imported articles during top-up', async () => {
    const { api } = makeRuntime()
    const mine = await api.createArticle({ title: 'My own text', originalText: 'This is a long enough passage of my own writing that should survive a bank top-up without being replaced or removed. It has several sentences.' })
    const boot = await api.bootstrap()
    const kept = boot.articles.find((a) => a.id === mine.id)
    expect(kept?.title).toBe('My own text')
    expect(boot.articles).toHaveLength(101)
  })
})
