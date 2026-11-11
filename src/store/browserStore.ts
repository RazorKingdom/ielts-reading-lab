import type {
  AppSettings,
  Article,
  Attempt,
  Diagnosis,
  FeedbackEvent,
  MarkedSentence,
  ReadingPosition,
  ReviewTask,
  SkillObservation,
  TeachingDecision,
  ThirdPartyConfig,
  TrainingSession,
  WrongWord,
} from '../core/types'
import type { LabStore } from '../core/runtime'
import { DEFAULT_API_CONFIG, DEFAULT_SETTINGS } from '../core/runtime'

const STORAGE_KEY = 'ielts-reading-lab:v1'

interface DbShape {
  articles: Article[]
  positions: Record<string, ReadingPosition>
  sessions: TrainingSession[]
  attempts: Attempt[]
  feedback: FeedbackEvent[]
  decisions: TeachingDecision[]
  diagnoses: Diagnosis[]
  observations: SkillObservation[]
  reviewTasks: ReviewTask[]
  marks: MarkedSentence[]
  wrongWords: WrongWord[]
  exposures: string[]
  settings: AppSettings
  /** Non-secret API settings only. The key is NEVER written to this object. */
  apiConfig: Omit<ThirdPartyConfig, 'hasKey'>
}

function emptyDb(): DbShape {
  return {
    articles: [],
    positions: {},
    sessions: [],
    attempts: [],
    feedback: [],
    decisions: [],
    diagnoses: [],
    observations: [],
    reviewTasks: [],
    marks: [],
    wrongWords: [],
    exposures: [],
    settings: { ...DEFAULT_SETTINGS },
    apiConfig: { ...DEFAULT_API_CONFIG },
  }
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Browser-preview backend. Structurally identical to the SQLite backend, but
 * intentionally labelled as a preview fallback (no filesystem, no credentials).
 */
export function createBrowserStore(storage?: KeyValueStorage): LabStore {
  const kv: KeyValueStorage =
    storage ??
    (typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : createMemoryStorage())

  function read(): DbShape {
    const raw = kv.getItem(STORAGE_KEY)
    if (!raw) return emptyDb()
    try {
      const parsed = JSON.parse(raw) as DbShape
      return {
        ...emptyDb(),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
        apiConfig: { ...DEFAULT_API_CONFIG, ...parsed.apiConfig },
      }
    } catch {
      return emptyDb()
    }
  }

  function write(db: DbShape): void {
    kv.setItem(STORAGE_KEY, JSON.stringify(db))
  }

  /**
   * Browser-preview credential: kept in memory only for this page session.
   * It is never written to localStorage, exported, or shared with the desktop
   * build. The real app encrypts it in the Electron main process instead.
   */
  let inMemoryKey: string | null = null

  async function mutate<T>(fn: (db: DbShape) => T): Promise<T> {
    const db = read()
    const result = fn(db)
    write(db)
    return result
  }

  const replace = <T extends { id: string }>(list: T[], item: T): T[] => {
    const i = list.findIndex((x) => x.id === item.id)
    if (i >= 0) list[i] = clone(item)
    else list.push(clone(item))
    return list
  }

  return {
    async listArticles() {
      return clone(read().articles).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async getArticle(id) {
      const a = read().articles.find((x) => x.id === id)
      return a ? clone(a) : null
    },
    async putArticle(a) {
      await mutate((db) => void replace(db.articles, a))
    },
    async deleteArticle(id) {
      await mutate((db) => {
        db.articles = db.articles.filter((x) => x.id !== id)
        delete db.positions[id]
      })
    },

    async getPosition(articleId) {
      const p = read().positions[articleId]
      return p ? clone(p) : null
    },
    async putPosition(p) {
      await mutate((db) => void (db.positions[p.articleId] = clone(p)))
    },

    async getSession(id) {
      const s = read().sessions.find((x) => x.id === id)
      return s ? clone(s) : null
    },
    async putSession(s) {
      await mutate((db) => void replace(db.sessions, s))
    },
    async listSessions() {
      return clone(read().sessions)
    },

    async listAttempts(sessionId) {
      return clone(read().attempts.filter((a) => a.sessionId === sessionId).sort((a, b) => a.sequence - b.sequence))
    },
    async addAttempt(a) {
      await mutate((db) => void db.attempts.push(clone(a)))
    },

    async listFeedback(sessionId) {
      return clone(read().feedback.filter((f) => f.sessionId === sessionId))
    },
    async addFeedback(f) {
      await mutate((db) => void db.feedback.push(clone(f)))
    },

    async listDecisions(sessionId) {
      return clone(read().decisions.filter((d) => d.sessionId === sessionId))
    },
    async addDecision(d) {
      await mutate((db) => void db.decisions.push(clone(d)))
    },

    async getDiagnosis(sessionId) {
      const list = read().diagnoses.filter((d) => d.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const d = list[list.length - 1]
      return d ? clone(d) : null
    },
    async putDiagnosis(d) {
      await mutate((db) => void db.diagnoses.push(clone(d)))
    },

    async listObservations() {
      return clone(read().observations)
    },
    async addObservation(o) {
      await mutate((db) => void db.observations.push(clone(o)))
    },

    async listReviewTasks() {
      return clone(read().reviewTasks)
    },
    async addReviewTask(r) {
      await mutate((db) => void db.reviewTasks.push(clone(r)))
    },
    async updateReviewTask(id, patch) {
      await mutate((db) => {
        const r = db.reviewTasks.find((x) => x.id === id)
        if (r) Object.assign(r, clone(patch))
      })
    },

    async listMarks() {
      return clone(read().marks)
    },
    async addMark(m) {
      await mutate((db) => void db.marks.push(clone(m)))
    },
    async updateMark(id, patch) {
      await mutate((db) => {
        const m = db.marks.find((x) => x.id === id)
        if (m) Object.assign(m, clone(patch))
      })
    },

    async listWrongWords() {
      return clone(read().wrongWords)
    },
    async addWrongWord(w) {
      await mutate((db) => void db.wrongWords.push(clone(w)))
    },
    async removeWrongWord(id) {
      await mutate((db) => {
        db.wrongWords = db.wrongWords.filter((x) => x.id !== id)
      })
    },

    async getExposures() {
      return clone(read().exposures)
    },
    async addExposure(key) {
      await mutate((db) => {
        if (!db.exposures.includes(key)) db.exposures.push(key)
      })
    },

    async getSettings() {
      return clone(read().settings)
    },
    async setSettings(patch) {
      return mutate((db) => {
        db.settings = { ...db.settings, ...patch }
        return clone(db.settings)
      })
    },

    async getApiConfig(): Promise<ThirdPartyConfig> {
      return { ...DEFAULT_API_CONFIG, ...read().apiConfig, hasKey: Boolean(inMemoryKey) }
    },
    async setApiConfig(patch): Promise<ThirdPartyConfig> {
      return mutate((db) => {
        db.apiConfig = { ...db.apiConfig, ...patch }
        return { ...DEFAULT_API_CONFIG, ...db.apiConfig, hasKey: Boolean(inMemoryKey) }
      })
    },
    async getApiKey() {
      return inMemoryKey
    },
    async setApiKey(key) {
      inMemoryKey = key
    },
    async clearApiKey() {
      inMemoryKey = null
    },

    async exportAll() {
      // apiConfig is included; inMemoryKey is deliberately not part of DbShape.
      return JSON.stringify(read(), null, 2)
    },
    async clearAll() {
      kv.removeItem(STORAGE_KEY)
      inMemoryKey = null
    },
  }
}
