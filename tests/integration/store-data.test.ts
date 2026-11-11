import { describe, expect, it } from 'vitest'
import { createBrowserStore, createMemoryStorage } from '../../src/store/browserStore'
import { createArticle, segmentArticle } from '../../src/core/segment'
import { makeRuntime, makeSessionInput, D01 } from '../helpers'

const ARTICLE = createArticle({
  id: 'data-test', title: 'Data integrity',
  originalText: 'The result depends on how the samples were handled. Training budgets are often approved without evidence.',
})

describe('integration: local store data integrity', () => {
  it('persists articles across a store restart without duplication', async () => {
    const storage = createMemoryStorage()
    const s1 = createBrowserStore(storage)
    await s1.putArticle(ARTICLE)
    const s2 = createBrowserStore(storage)
    expect(await s2.listArticles()).toHaveLength(1)
    await s2.putArticle(ARTICLE)
    expect(await createBrowserStore(storage).listArticles()).toHaveLength(1)
  })

  it('exposure marks are append-only and survive a restart', async () => {
    const storage = createMemoryStorage()
    const s1 = createBrowserStore(storage)
    await s1.addExposure('article|sentence')
    await s1.addExposure('article|sentence') // idempotent
    const s2 = createBrowserStore(storage)
    expect(await s2.getExposures()).toEqual(['article|sentence'])
    await s2.addExposure('article|other')
    expect(await s2.getExposures()).toEqual(['article|sentence', 'article|other'])
  })

  it('export contains records but never the API key', async () => {
    const storage = createMemoryStorage()
    const store = createBrowserStore(storage)
    await store.putArticle(ARTICLE)
    await store.setApiKey('sk-super-secret-123')
    const exported = await store.exportAll()
    expect(exported).toContain(ARTICLE.id)
    expect(exported).not.toContain('sk-super-secret-123')
    expect(await store.getApiConfig()).toMatchObject({ hasKey: true })
    // getApiConfig exposes only a boolean, never the key itself.
    expect(JSON.stringify(await store.getApiConfig())).not.toContain('sk-super')
  })

  it('LabAPI.deleteAllData clears records and the stored key together', async () => {
    const { api } = makeRuntime()
    await api.createArticle({ title: ARTICLE.title, originalText: ARTICLE.originalText })
    await api.setApiKey('sk-x')
    await api.setApiConfig({ enabled: true, costConfirmed: true, model: 'm', baseUrl: 'https://x/v1' })
    expect((await api.getApiConfig()).hasKey).toBe(true)
    // Create a session too, so "clears records" is actually verifiable.
    const { session } = await api.startSession(makeSessionInput(D01))
    await api.dispatch(session.id, { type: 'SUBMIT', text: '这取决于员工使用技术有多有效。' })
    expect((await api.getProfile()).sessions.length).toBeGreaterThan(0)
    await api.deleteAllData()
    const profile = await api.getProfile()
    expect(profile.sessions).toHaveLength(0)
    expect(profile.observations).toHaveLength(0)
    expect(profile.marks).toHaveLength(0)
    const cfg = await api.getApiConfig()
    expect(cfg).toMatchObject({ hasKey: false, enabled: false })
  })

  it('article version hash is stable for identical text and changes on edit', () => {
    const a = ARTICLE
    expect(a.versionHash).toBe(createArticle({ id: a.id, originalText: a.originalText }).versionHash)
    const edited = createArticle({ id: a.id, originalText: a.originalText + ' More detail.' })
    expect(edited.versionHash).not.toBe(a.versionHash)
    // Sentence IDs are derived from article version; a text edit orphans old IDs.
    expect(segmentArticle(a)[0].sentences[0].id).not.toBe(segmentArticle(edited)[0].sentences[0].id)
  })
})
