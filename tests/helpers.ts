import { createRuntime } from '../src/core/runtime'
import type { LabAPI, RuntimeOptions, StartSessionInput } from '../src/core/runtime'
import { createBrowserStore, createMemoryStorage } from '../src/store/browserStore'
import type { KeyValueStorage } from '../src/store/browserStore'
import { createArticle, segmentArticle } from '../src/core/segment'

export interface Harness {
  api: LabAPI
  storage: KeyValueStorage
  /** Simulates a restart: same storage, brand-new runtime instance. */
  restart: () => LabAPI
}

export function makeRuntime(extra: Partial<Omit<RuntimeOptions, 'store' | 'backendKind'>> = {}): Harness {
  const storage = createMemoryStorage()
  const build = () => createRuntime({
    store: createBrowserStore(storage),
    backendKind: 'browser-localstorage',
    ...extra,
  })
  return { api: build(), storage, restart: build }
}

export function makeSessionInput(sentenceText: string, overrides: Partial<StartSessionInput> = {}): StartSessionInput {
  const article = createArticle({
    id: 'test-article',
    originalText: sentenceText,
    now: '2026-01-01T00:00:00.000Z',
    title: 'Test',
  })
  const s = segmentArticle(article)[0].sentences[0]
  return {
    articleId: article.id,
    sentenceId: s.id,
    sentenceText: s.text,
    paragraphNo: s.paragraphNo,
    articleVersion: article.versionHash,
    contextBefore: '',
    contextAfter: '',
    directAnalysisSeen: false,
    ...overrides,
  }
}

export const D01 = 'The extent to which technology improves productivity depends on how effectively employees use it.'
export const D04 = 'Although resources are widely available, understanding depends on critical evaluation.'
export const D06 = 'Success depends less on speed than on accuracy.'
export const D08 = 'The system was designed to reduce costs.'
export const D11 = 'The policy, introduced last year, has not yet produced measurable results.'
