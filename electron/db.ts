import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
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
} from '../src/core/types'
import type { LabStore } from '../src/core/runtime'
import { DEFAULT_API_CONFIG, DEFAULT_SETTINGS } from '../src/core/runtime'
import { clearStoredApiKey, readApiKey, writeApiKey } from './secureStore'

/**
 * Real SQLite in the Electron main process. sql.js is SQLite compiled to WASM,
 * so no native rebuild step is needed on Windows. The database is exported to
 * userData after every write; events are append-only (UNIQUE kind+id).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const initSqlJs = require('sql.js') as (config?: { locateFile: (f: string) => string }) => Promise<any>

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(kind, id)
);
CREATE INDEX IF NOT EXISTS idx_records_kind ON records(kind);
`

let db: any = null
let dbPath = ''

/** Locate the sql.js WASM in both dev (node_modules) and packaged (asar /
 * asar-unpacked) layouts. In a packaged app __dirname sits inside app.asar,
 * where binary files cannot be read; the unpacked copy is preferred. */
function findWasmDir(): string {
  const base = path.join(__dirname, '..', '..')
  const candidates = [
    path.join(base, 'node_modules', 'sql.js', 'dist'),
    // electron-builder / manual pack: asar-unpacked lives beside app.asar
    path.join(__dirname, '..', '..', '..', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'sql-wasm.wasm'))) return dir
  }
  return candidates[0]
}

export async function openDatabase(): Promise<string> {
  const wasmDir = findWasmDir()
  const SQL = await initSqlJs({ locateFile: (f: string) => path.join(wasmDir, f) })
  dbPath = path.join(app.getPath('userData'), 'reading-lab.sqlite')
  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database()
  db.run(SCHEMA)
  persist()
  return dbPath
}

function persist(): void {
  if (!db || !dbPath) return
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

function queryRows(sql: string, params: unknown[] = []): { kind: string; id: string; payload: string }[] {
  if (!db) return []
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: { kind: string; id: string; payload: string }[] = []
  while (stmt.step()) {
    const r = stmt.get()
    rows.push({ kind: String(r[0]), id: String(r[1]), payload: String(r[2]) })
  }
  stmt.free()
  return rows
}

function all<T>(kind: string): T[] {
  return queryRows('SELECT kind, id, payload FROM records WHERE kind = ? ORDER BY seq', [kind]).map((r) =>
    JSON.parse(r.payload) as T,
  )
}

function one<T>(kind: string, id: string): T | null {
  const rows = queryRows('SELECT kind, id, payload FROM records WHERE kind = ? AND id = ? LIMIT 1', [kind, id])
  return rows.length ? (JSON.parse(rows[0].payload) as T) : null
}

function put(kind: string, id: string, payload: unknown, replaceExisting = false): void {
  if (!db) return
  const sql = replaceExisting
    ? 'INSERT OR REPLACE INTO records (kind, id, payload) VALUES (?, ?, ?)'
    : 'INSERT OR IGNORE INTO records (kind, id, payload) VALUES (?, ?, ?)'
  db.run(sql, [kind, id, JSON.stringify(payload)])
  persist()
}

function remove(kind: string, id: string): void {
  if (!db) return
  db.run('DELETE FROM records WHERE kind = ? AND id = ?', [kind, id])
  persist()
}

function bySession<T extends { sessionId: string }>(kind: string, sessionId: string): T[] {
  return all<T>(kind).filter((x) => x.sessionId === sessionId)
}

class SqliteStore implements LabStore {
  async listArticles(): Promise<Article[]> {
    return all<Article>('article').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async getArticle(id: string): Promise<Article | null> {
    return one<Article>('article', id)
  }
  async putArticle(a: Article): Promise<void> {
    put('article', a.id, a, true)
  }
  async deleteArticle(id: string): Promise<void> {
    remove('article', id)
    remove('position', id)
  }

  async getPosition(articleId: string): Promise<ReadingPosition | null> {
    return one<ReadingPosition>('position', articleId)
  }
  async putPosition(p: ReadingPosition): Promise<void> {
    put('position', p.articleId, p, true)
  }

  async getSession(id: string): Promise<TrainingSession | null> {
    return one<TrainingSession>('session', id)
  }
  async putSession(s: TrainingSession): Promise<void> {
    put('session', s.id, s, true)
  }
  async listSessions(): Promise<TrainingSession[]> {
    return all<TrainingSession>('session')
  }

  async listAttempts(sessionId: string): Promise<Attempt[]> {
    return bySession<Attempt>('attempt', sessionId).sort((a, b) => a.sequence - b.sequence)
  }
  async addAttempt(a: Attempt): Promise<void> {
    put('attempt', a.id, a)
  }

  async listFeedback(sessionId: string): Promise<FeedbackEvent[]> {
    return bySession<FeedbackEvent>('feedback', sessionId)
  }
  async addFeedback(f: FeedbackEvent): Promise<void> {
    put('feedback', f.id, f)
  }

  async listDecisions(sessionId: string): Promise<TeachingDecision[]> {
    return bySession<TeachingDecision>('decision', sessionId)
  }
  async addDecision(d: TeachingDecision): Promise<void> {
    put('decision', d.id, d)
  }

  async getDiagnosis(sessionId: string): Promise<Diagnosis | null> {
    const list = bySession<Diagnosis>('diagnosis', sessionId).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )
    return list[list.length - 1] ?? null
  }
  async putDiagnosis(d: Diagnosis): Promise<void> {
    put('diagnosis', d.id, d)
  }

  async listObservations(): Promise<SkillObservation[]> {
    return all<SkillObservation>('observation')
  }
  async addObservation(o: SkillObservation): Promise<void> {
    put('observation', o.id, o)
  }

  async listReviewTasks(): Promise<ReviewTask[]> {
    return all<ReviewTask>('review')
  }
  async addReviewTask(r: ReviewTask): Promise<void> {
    put('review', r.id, r)
  }
  async updateReviewTask(id: string, patch: Partial<ReviewTask>): Promise<void> {
    const r = one<ReviewTask>('review', id)
    if (r) put('review', id, { ...r, ...patch }, true)
  }

  async listMarks(): Promise<MarkedSentence[]> {
    return all<MarkedSentence>('mark')
  }
  async addMark(m: MarkedSentence): Promise<void> {
    put('mark', m.id, m)
  }
  async updateMark(id: string, patch: Partial<MarkedSentence>): Promise<void> {
    const m = one<MarkedSentence>('mark', id)
    if (m) put('mark', id, { ...m, ...patch }, true)
  }

  async getExposures(): Promise<string[]> {
    return all<{ key: string }>('exposure').map((x) => x.key)
  }
  async addExposure(key: string): Promise<void> {
    put('exposure', key, { key })
  }

  async getSettings(): Promise<AppSettings> {
    return one<AppSettings>('settings', 'app') ?? { ...DEFAULT_SETTINGS }
  }
  async setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await this.getSettings()), ...patch }
    put('settings', 'app', next, true)
    return next
  }

  async getApiConfig(): Promise<ThirdPartyConfig> {
    const stored = one<Omit<ThirdPartyConfig, 'hasKey'>>('api-config', 'app') ?? { ...DEFAULT_API_CONFIG }
    return { ...DEFAULT_API_CONFIG, ...stored, hasKey: Boolean(readApiKey()) }
  }
  async setApiConfig(patch: Partial<Omit<ThirdPartyConfig, 'hasKey'>>): Promise<ThirdPartyConfig> {
    const merged = { ...DEFAULT_API_CONFIG, ...(await this.getApiConfig()), ...patch }
    // Persist only non-secret fields. The key lives in the encrypted file.
    const stored = {
      baseUrl: merged.baseUrl,
      model: merged.model,
      enabled: merged.enabled,
      costConfirmed: merged.costConfirmed,
      ...(merged.lastTest ? { lastTest: merged.lastTest } : {}),
    }
    put('api-config', 'app', stored, true)
    return this.getApiConfig()
  }
  async getApiKey(): Promise<string | null> {
    return readApiKey()
  }
  async setApiKey(key: string): Promise<void> {
    writeApiKey(key)
  }
  async clearApiKey(): Promise<void> {
    clearStoredApiKey()
  }

  async exportAll(): Promise<string> {
    const rows = queryRows('SELECT kind, id, payload FROM records ORDER BY seq')
    // rows contain api-config (no secret); the encrypted credential file is
    // deliberately excluded from every export.
    return JSON.stringify(
      { format: 'ielts-reading-lab-export', version: 1, exportedAt: new Date().toISOString(), rows },
      null,
      2,
    )
  }
  async clearAll(): Promise<void> {
    if (!db) return
    db.run('DELETE FROM records')
    persist()
    clearStoredApiKey()
  }
}

export function createSqliteStore(): LabStore {
  return new SqliteStore()
}
