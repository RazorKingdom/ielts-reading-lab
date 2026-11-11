import type {
  AIProvider,
  AppSettings,
  Article,
  Attempt,
  Diagnosis,
  FeedbackEvent,
  MarkedSentence,
  Profile,
  ProviderCapability,
  ApiConnectionResult,
  RawDiagnosis,
  ReadingPosition,
  ThirdPartyConfig,
  ReviewTask,
  SessionSnapshot,
  SkillObservation,
  TeachingDecision,
  TrainingIntent,
  TrainingSession,
  SentenceAnalysis,
  WrongWord,
} from './types'
import { POLICY_VERSION } from './types'
import { makeId } from './hash'
import { analysisWithOffline } from './explanations'
import { createArticle } from './segment'
import { createSampleArticles, ARTICLE_BANK_VERSION } from './samples'
import { createProvider, ProviderError, providerErrorMessage } from './diagnose'
import type { ErrorKind } from './diagnose'
import { THIRD_PARTY_CAPABILITY } from './apiProvider'
import { validateDiagnosis } from './validator'
import { canSubmit, decide, isUnknownAnswer, observationResult, POLICY_LIMITS } from './machine'
import type { Decision } from './machine'
import { buildTransferExercise, evaluateTransfer, makeReviewTask } from './exercise'
import { lookupWord } from './dictionary'

/* ----------------------------- storage port ----------------------------- */

/** Everything the teaching engine persists. Implemented by SQLite (Electron) and localStorage (browser preview). */
export interface LabStore {
  listArticles(): Promise<Article[]>
  getArticle(id: string): Promise<Article | null>
  putArticle(a: Article): Promise<void>
  deleteArticle(id: string): Promise<void>

  getPosition(articleId: string): Promise<ReadingPosition | null>
  putPosition(p: ReadingPosition): Promise<void>

  getSession(id: string): Promise<TrainingSession | null>
  putSession(s: TrainingSession): Promise<void>
  listSessions(): Promise<TrainingSession[]>

  listAttempts(sessionId: string): Promise<Attempt[]>
  addAttempt(a: Attempt): Promise<void>

  listFeedback(sessionId: string): Promise<FeedbackEvent[]>
  addFeedback(f: FeedbackEvent): Promise<void>

  listDecisions(sessionId: string): Promise<TeachingDecision[]>
  addDecision(d: TeachingDecision): Promise<void>

  getDiagnosis(sessionId: string): Promise<Diagnosis | null>
  putDiagnosis(d: Diagnosis): Promise<void>

  listObservations(): Promise<SkillObservation[]>
  addObservation(o: SkillObservation): Promise<void>

  listReviewTasks(): Promise<ReviewTask[]>
  addReviewTask(r: ReviewTask): Promise<void>
  updateReviewTask(id: string, patch: Partial<ReviewTask>): Promise<void>

  listMarks(): Promise<MarkedSentence[]>
  addMark(m: MarkedSentence): Promise<void>
  updateMark(id: string, patch: Partial<MarkedSentence>): Promise<void>

  listWrongWords(): Promise<WrongWord[]>
  addWrongWord(w: WrongWord): Promise<void>
  removeWrongWord(id: string): Promise<void>

  getExposures(): Promise<string[]>
  addExposure(key: string): Promise<void>

  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>

  exportAll(): Promise<string>
  clearAll(): Promise<void>

  /** Non-secret API configuration (safe to export). */
  getApiConfig(): Promise<ThirdPartyConfig>
  setApiConfig(patch: Partial<Omit<ThirdPartyConfig, 'hasKey'>>): Promise<ThirdPartyConfig>
  /** Secret credential. Host-only; never exposed through LabAPI or exports. */
  getApiKey(): Promise<string | null>
  setApiKey(key: string): Promise<void>
  clearApiKey(): Promise<void>
}

/* ------------------------------- public API ------------------------------ */

export interface Bootstrap {
  articles: Article[]
  settings: AppSettings
  providers: ProviderCapability[]
  profile: Profile
  backendKind: 'electron-sqlite' | 'browser-localstorage'
}

export interface StartSessionInput {
  articleId: string
  sentenceId: string
  sentenceText: string
  paragraphNo: number
  articleVersion: string
  contextBefore: string
  contextAfter: string
  directAnalysisSeen: boolean
}

export interface LabAPI {
  bootstrap(): Promise<Bootstrap>
  listProviders(): Promise<ProviderCapability[]>
  createArticle(input: { title?: string; originalText: string }): Promise<Article>
  deleteArticle(id: string): Promise<void>
  getArticle(id: string): Promise<Article | null>
  getReadingPosition(articleId: string): Promise<ReadingPosition | null>
  saveReadingPosition(p: ReadingPosition): Promise<void>

  getAnalysis(input: Omit<StartSessionInput, 'directAnalysisSeen'>): Promise<SentenceAnalysis>
  markAnalysisViewed(articleId: string, sentenceId: string): Promise<void>
  hasAnalysisBeenViewed(articleId: string, sentenceId: string): Promise<boolean>

  findActiveSession(articleId: string, sentenceId: string): Promise<TrainingSession | null>
  startSession(input: StartSessionInput): Promise<SessionSnapshot>
  resumeSession(sessionId: string): Promise<SessionSnapshot | null>
  dispatch(sessionId: string, intent: TrainingIntent): Promise<SessionSnapshot>

  getProfile(): Promise<Profile>
  addMark(input: { articleId: string; sentenceId: string; sentenceText: string; note: string }): Promise<void>
  updateMark(id: string, status: MarkedSentence['status']): Promise<void>
  updateReviewTask(id: string, status: ReviewTask['status']): Promise<void>

  /** Wrong-word notebook (offline dictionary snapshots, no AI involved). */
  listWrongWords(): Promise<WrongWord[]>
  addWrongWord(input: {
    query: string
    sentenceText?: string
    articleId?: string
  }): Promise<{ added: boolean; word: WrongWord | null }>
  removeWrongWord(id: string): Promise<void>

  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getApiConfig(): Promise<ThirdPartyConfig>
  setApiConfig(patch: Partial<Omit<ThirdPartyConfig, 'hasKey'>>): Promise<ThirdPartyConfig>
  /** Writes the key into encrypted host storage. Never returns it. */
  setApiKey(key: string): Promise<ThirdPartyConfig>
  clearApiKey(): Promise<ThirdPartyConfig>
  /** Sends one tiny request to the configured endpoint (user-initiated). */
  testApiConnection(): Promise<ApiConnectionResult>
  exportData(): Promise<string>
  deleteAllData(): Promise<void>
}

export interface RuntimeOptions {
  store: LabStore
  backendKind: Bootstrap['backendKind']
  /** Injected by the host. Electron keeps provider access in the main process only. */
  providerFactory?: (id: string) => AIProvider | Promise<AIProvider>
  clock?: () => Date
}

export const DEFAULT_API_CONFIG: Omit<ThirdPartyConfig, 'hasKey'> = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  enabled: false,
  costConfirmed: false,
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeProviderId: 'mock-rules',
  theme: 'light',
  fontScale: 1,
  personalization: true,
  showModelMeta: true,
  sampleBankVersion: 0,
}

export function createRuntime(options: RuntimeOptions): LabAPI {
  const store = options.store
  const now = options.clock ?? (() => new Date())
  const backendKind = options.backendKind
  const factory: (id: string) => AIProvider | Promise<AIProvider> = options.providerFactory ?? createProvider

  /** Only one user-facing provider; the offline rules are an internal fallback. */
  async function providerCapabilities(): Promise<ProviderCapability[]> {
    const cfg = await store.getApiConfig()
    const ready = cfg.enabled && cfg.costConfirmed && cfg.hasKey && !!cfg.model.trim()
    return [
      {
        ...THIRD_PARTY_CAPABILITY,
        status: ready ? 'available' : 'disabled',
        availableModels: cfg.model.trim() ? [cfg.model.trim()] : [],
      },
    ]
  }

  async function resolveProvider(): Promise<AIProvider> {
    const cfg = await store.getApiConfig()
    if (cfg.enabled && cfg.costConfirmed && cfg.hasKey && !!cfg.model.trim() && !!cfg.baseUrl.trim()) {
      return factory('third-party-api')
    }
    // Internal offline fallback: never shown as a selectable model, never
    // reported as a real model result. Legacy ids are still honoured so
    // injected test providers and failure-path coverage keep working.
    const legacy = (await store.getSettings()).activeProviderId
    return factory(legacy === 'third-party-api' ? 'mock-rules' : legacy)
  }

  // Monotonic timestamps keep append-only ordering unambiguous even when two
  // events happen within the same millisecond (e.g. two sessions on one sentence).
  let lastTime = 0
  const iso = () => {
    const t = Math.max(now().getTime(), lastTime + 1)
    lastTime = t
    return new Date(t).toISOString()
  }
  const exposureKey = (articleId: string, sentenceId: string) => `${articleId}|${sentenceId}`

  async function analysisFor(s: TrainingSession): Promise<SentenceAnalysis> {
    return analysisWithOffline(s.sentenceId, s.sentenceText, s.contextBefore, s.contextAfter)
  }

  async function snapshot(s: TrainingSession, notice?: string, policyNote?: string): Promise<SessionSnapshot> {
    const [attempts, feedback, decisions, diagnosis, analysis] = await Promise.all([
      store.listAttempts(s.id),
      store.listFeedback(s.id),
      store.listDecisions(s.id),
      store.getDiagnosis(s.id),
      analysisFor(s),
    ])
    const availableIntents = await computeIntents(s, attempts, analysis, diagnosis)
    return {
      session: s,
      attempts,
      diagnosis: diagnosis ?? undefined,
      feedback,
      analysis,
      decisions,
      availableIntents,
      notice,
      policyNote,
    }
  }

  async function computeIntents(
    s: TrainingSession,
    attempts: Attempt[],
    analysis: SentenceAnalysis,
    diagnosis: Diagnosis | null,
  ): Promise<TrainingIntent['type'][]> {
    const exposed = s.answerRevealed || s.currentLevel >= 3 || s.directAnalysisSeen
    // Once the full answer has been shown there is no "deeper hint" left.
    // Keeping REQUEST_HINT/UNLOCK_LEVEL3 available would let the user append
    // unlimited duplicate L3 rows and see a nonexistent "L4" button.
    const base: TrainingIntent['type'][] = exposed
      ? ['EXIT', 'DISPUTE']
      : ['EXIT', 'UNLOCK_LEVEL3', 'DISPUTE']
    switch (s.state) {
      case 'PREPARE':
      case 'ATTEMPT':
        return exposed
          ? ['SUBMIT', 'SET_DRAFT', 'EXIT']
          : ['SUBMIT', 'SET_DRAFT', 'UNLOCK_LEVEL3', 'EXIT']
      case 'DIAGNOSE':
        return ['EXIT']
      case 'DIAGNOSE_FAILED':
        // No diagnosis exists to dispute; only recovery actions are valid.
        return ['RETRY_DIAGNOSIS', 'UNLOCK_LEVEL3', 'EXIT']
      case 'CLARIFY':
      case 'RETRY': {
        const hint = exposed ? [] : ['REQUEST_HINT' as TrainingIntent['type']]
        return attempts.length < POLICY_LIMITS.maxAttempts
          ? ['SUBMIT', 'SET_DRAFT', ...hint, ...base]
          : [...hint, ...base]
      }
      case 'PASS': {
        const canTransfer =
          !!diagnosis &&
          analysis.targets.some((t) => t.transferTemplate) &&
          s.transferCount < POLICY_LIMITS.maxTransfer &&
          !s.transfer
        return canTransfer ? ['ACCEPT_TRANSFER', 'SKIP_TRANSFER', ...base] : ['SKIP_TRANSFER', ...base]
      }
      case 'EXPLAIN':
        return ['SKIP_TRANSFER', ...base]
      case 'TRANSFER':
        // Never offer L3 here: level3Content() would reveal the transfer
        // sentence's reference meaning before the learner has answered.
        return ['SUBMIT_TRANSFER', 'SKIP_TRANSFER', 'EXIT', 'DISPUTE']
      case 'COMPLETE':
        return ['EXIT']
      default:
        return base
    }
  }

  function level1Content(action: string, s: TrainingSession, diagnosis: Diagnosis, analysis: SentenceAnalysis): string {
    const wrong = diagnosis.evidences.filter((e) => e.status === 'incorrect')
    const partial = diagnosis.evidences.filter((e) => e.status === 'partial')
    const focus = [...wrong, ...partial]
    const hints = focus
      .map((e) => analysis.targets.find((t) => t.id === e.targetId)?.hintLevel1)
      .filter(Boolean)
      .slice(0, 2)
    if (wrong.length > 0) {
      // Explicit errors may be corrected directly; we still do not reveal the full parse.
      return `你的回答里有一处与原句直接冲突：${wrong
        .map((e) => `「${e.answerQuote}」`)
        .join('、')}。${hints[0] ?? '请回到原文核对这一处关系。'}（本层不展示完整解析。）`
    }
    if (action === 'CLARIFY') {
      return `${diagnosis.summary} ${hints[0] ?? '请补上这一处关键细节。'}（本层只定位问题，不给出完整答案。）`
    }
    return diagnosis.summary
  }

  function level3Content(s: TrainingSession, analysis: SentenceAnalysis): string {
    // Never reveal the transfer sentence's answer while the learner is still
    // supposed to solve it: the transfer reference is shown only AFTER submit.
    const transfer = s.transfer && s.state !== 'TRANSFER'
      ? `\n\n迁移句参考含义：${s.transfer.meaning}`
      : ''
    return [
      `参考理解：${analysis.meaning}`,
      ...analysis.layers.map((l, i) => `${i + 1}. ${l}`),
      ...analysis.targets.map((t) => `· ${t.category}（${t.originalSpan}）：${t.explanation}`),
      analysis.ambiguity ? `· 歧义提示：${analysis.ambiguity}` : '',
    ]
      .filter(Boolean)
      .join('\n') + transfer
  }

  async function addFeedback(
    s: TrainingSession,
    level: 0 | 1 | 2 | 3,
    kind: FeedbackEvent['kind'],
    content: string,
  ): Promise<void> {
    await store.addFeedback({
      id: makeId('fb'),
      sessionId: s.id,
      level,
      kind,
      content,
      exposedAt: iso(),
    })
  }

  /** Append-only observation rows. Later rows reflect later exposure conditions. */
  async function writeObservations(
    s: TrainingSession,
    diagnosis: Diagnosis,
    attempt: Attempt,
  ): Promise<void> {
    const analysis = await analysisFor(s)
    for (const e of diagnosis.evidences) {
      const target = analysis.targets.find((x) => x.id === e.targetId)
      await store.addObservation({
        id: makeId('obs'),
        targetId: e.targetId,
        category: target?.category ?? '核心主谓',
        sentenceId: s.sentenceId,
        sessionId: s.id,
        attemptId: attempt.id,
        assistedLevel: s.currentLevel,
        answerRevealed: s.answerRevealed,
        result: observationResult(e.status, s.currentLevel, s.answerRevealed, s.directAnalysisSeen),
        evidenceCount: e.answerQuote ? 1 : 0,
        timestamp: iso(),
      })
    }
  }

  async function runDiagnosis(s: TrainingSession, attempt: Attempt): Promise<SessionSnapshot> {
    const analysis = await analysisFor(s)
    const provider = await resolveProvider()
    let raw: RawDiagnosis | null = null
    try {
      // Only a COMPLETE response is allowed to become a diagnosis. A rejected /
      // partial stream never reaches the validator as a scored result (S10).
      raw = await provider.diagnose({
        analysis,
        sentenceText: s.sentenceText,
        attemptText: attempt.userText,
        contextBefore: s.contextBefore,
        contextAfter: s.contextAfter,
        level: s.currentLevel,
        attemptSequence: attempt.sequence,
      })
    } catch (err) {
      const kind = err instanceof ProviderError ? err.errorKind : 'NETWORK'
      s.state = 'DIAGNOSE_FAILED'
      s.lastError = kind
      s.lastErrorNote = providerErrorMessage(kind)
      await store.putSession(s)
      return snapshot(
        s,
        `${s.lastErrorNote}（错误类别：${kind}；你的第 ${attempt.sequence} 次回答已完整保存，可点「重试诊断」，不会重复写 session。）`,
      )
    }

    const validation = validateDiagnosis(raw, analysis, s.sentenceText, attempt.userText)
    if (!validation.valid) {
      s.state = 'DIAGNOSE_FAILED'
      s.lastError = raw?.evidences?.length ? 'EVIDENCE_INSUFFICIENT' : 'INVALID_STRUCTURE'
      s.lastErrorNote = providerErrorMessage(s.lastError as ErrorKind)
      await store.putSession(s)
      return snapshot(
        s,
        `Validator 拒绝将本次输出写入正式诊断：${validation.issues.slice(0, 3).join('；')}。你的回答已保存，可重试诊断。`,
      )
    }

    const diagnosis: Diagnosis = {
      ...(raw as RawDiagnosis),
      id: makeId('dg'),
      providerId: provider.id,
      modelId: provider.modelId,
      sessionId: s.id,
      sentenceId: s.sentenceId,
      attemptId: attempt.id,
      createdAt: iso(),
      validation,
      policyVersion: POLICY_VERSION,
    }
    await store.putDiagnosis(diagnosis)

    // The model suggests; the application state machine decides.
    // "I don't know" is resolved BEFORE decide() so the persisted decision
    // matches the resulting EXPLAIN state (previously the record said CLARIFY
    // while the UI showed a full L3 explanation).
    const unknown = isUnknownAnswer(attempt.userText)
    const decisionOutcome: Decision = unknown
      ? {
        action: 'EXPLAIN',
        reasonCodes: ['unknown-answer-direct-explanation'],
        policyNote: '你表示暂时不理解，应用跳过追问，直接给出完整解析。',
      }
      : decide({
        evidences: diagnosis.evidences,
        attemptSequence: attempt.sequence,
        clarifyCount: s.clarifyCount,
        retryCount: s.retryCount,
        answerRevealed: s.answerRevealed,
        suggestedAction: diagnosis.suggestedAction,
      })
    await store.addDecision({
      id: makeId('dec'),
      sessionId: s.id,
      action: decisionOutcome.action,
      reasonCodes: decisionOutcome.reasonCodes,
      policyNote: decisionOutcome.policyNote,
      evidenceIds: diagnosis.evidences.map((e) => e.targetId),
      policyVersion: POLICY_VERSION,
      createdAt: iso(),
    })

    const action = decisionOutcome.action
    let notice: string | undefined
    if (unknown) {
      // S12: never force a meaningless re-translation from "I don't know".
      s.currentLevel = 3
      s.answerRevealed = true
      s.state = 'EXPLAIN'
      await addFeedback(s, 3, 'full', `你表示暂时不理解，直接给出完整解析：\n${level3Content(s, analysis)}`)
      notice = '已进入完整解析；本句不再计为独立测评。'
    } else if (action === 'PASS') {
      s.state = 'PASS'
      const exposed = s.answerRevealed || s.directAnalysisSeen || s.currentLevel > 0
      // Feedback level must reflect what the learner actually saw; a green
      // "Level 0" row next to "答案已暴露" was contradictory (E3).
      await addFeedback(
        s,
        s.currentLevel,
        'pass',
        exposed
          ? `${diagnosis.summary} 核心理解正确；本轮已看过答案，按「提示后」归因，不计独立测评。`
          : `${diagnosis.summary} 本层不展示解析，以保持独立测评条件。`,
      )
      notice = exposed
        ? '核心理解正确，但本轮已看过答案，不计独立测评；可继续做迁移题或结束本轮。'
        : '核心理解正确，本句判定通过；不展示解析以保持独立测评，可继续做迁移题或结束本轮。'
    } else if (action === 'CLARIFY') {
      s.state = 'CLARIFY'
      s.clarifyCount += 1
      s.currentLevel = 1
      await addFeedback(s, 1, 'diagnosis', level1Content(action, s, diagnosis, analysis))
      notice = 'Level 1：只定位问题，未泄露完整答案。你可以直接修正，也可以继续请求提示。'
    } else if (action === 'RETRY') {
      s.state = 'RETRY'
      s.retryCount += 1
      s.currentLevel = 1
      await addFeedback(s, 1, 'correction', level1Content(action, s, diagnosis, analysis))
      notice = 'Level 1：指出明确冲突处，请重新用自己的话表达一次（最多一次二次表达）。'
    } else {
      s.state = 'EXPLAIN'
      s.currentLevel = 3
      s.answerRevealed = true
      await addFeedback(s, 3, 'full', level3Content(s, analysis))
      notice = '已给出完整解析；本句随后不能标为独立正确。'
    }

    await store.putSession(s)
    await writeObservations(s, diagnosis, attempt)
    return snapshot(s, notice, decisionOutcome.policyNote)
  }

  /* ------------------------------ API impl ------------------------------ */

  async function getProfile(): Promise<Profile> {
    const [observations, reviewTasks, marks, sessions] = await Promise.all([
      store.listObservations(),
      store.listReviewTasks(),
      store.listMarks(),
      store.listSessions(),
    ])
    // append-only: for each (session,target) keep the LATEST row as the effective exposure state.
    const latest = new Map<string, SkillObservation>()
    for (const o of observations) latest.set(`${o.sessionId}|${o.targetId}`, o)
    const effective = [...latest.values()]
    const count = (r: SkillObservation['result']) => effective.filter((o) => o.result === r).length
    const transferAttempts = sessions.filter((s) => s.transferAttempt).map((s) => s.transferAttempt!)
    return {
      observations,
      reviewTasks,
      marks,
      sessions,
      stats: {
        totalSessions: sessions.length,
        independentCorrect: count('independent-correct'),
        assistedCorrect: count('assisted-correct'),
        partial: count('partial'),
        incorrect: count('incorrect'),
        disputed: count('disputed'),
        evidenceCount: observations.reduce((sum, o) => sum + o.evidenceCount, 0),
        pendingReviews: reviewTasks.filter((r) => r.status === 'pending').length,
        transferCorrect: transferAttempts.filter((t) => t.result === 'correct').length,
        transferUnscored: transferAttempts.filter((t) => t.result === 'unscored').length,
      },
    }
  }

  return {
    async bootstrap() {
      let articles = await store.listArticles()
      let settings = await store.getSettings()
      // Version bump: refresh the CONTENT of built-in articles that are still
      // present (e.g. longer passages), keep their original createdAt so the
      // library order is stable, and never resurrect a deleted one. The very
      // first seeding adds the full bank.
      if (settings.sampleBankVersion !== ARTICLE_BANK_VERSION) {
        const firstSeed = !settings.sampleBankVersion
        const byId = new Map(articles.map((a) => [a.id, a]))
        for (const a of createSampleArticles(iso())) {
          const prev = byId.get(a.id)
          if (prev) await store.putArticle({ ...a, createdAt: prev.createdAt })
          else if (firstSeed) await store.putArticle(a)
        }
        settings = await store.setSettings({ sampleBankVersion: ARTICLE_BANK_VERSION })
        articles = await store.listArticles()
      }
      const [profile, providers] = await Promise.all([getProfile(), providerCapabilities()])
      return { articles, settings, providers, profile, backendKind }
    },

    async listProviders() {
      return providerCapabilities()
    },

    async createArticle(input) {
      const a = createArticle({ ...input, now: iso() })
      await store.putArticle(a)
      return a
    },

    async deleteArticle(id) {
      await store.deleteArticle(id)
    },

    async getArticle(id) {
      return store.getArticle(id)
    },

    async getReadingPosition(articleId) {
      return store.getPosition(articleId)
    },

    async saveReadingPosition(p) {
      await store.putPosition(p)
    },

    async getAnalysis(input) {
      return analysisWithOffline(input.sentenceId, input.sentenceText, input.contextBefore, input.contextAfter)
    },

    async markAnalysisViewed(articleId, sentenceId) {
      await store.addExposure(exposureKey(articleId, sentenceId))
    },

    async hasAnalysisBeenViewed(articleId, sentenceId) {
      return (await store.getExposures()).includes(exposureKey(articleId, sentenceId))
    },

    async findActiveSession(articleId, sentenceId) {
      const sessions = await store.listSessions()
      return (
        sessions
          .filter(
            (s) =>
              s.articleId === articleId &&
              s.sentenceId === sentenceId &&
              s.state !== 'COMPLETE' &&
              s.state !== 'DIAGNOSE',
          )
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
      )
    },

    async startSession(input) {
      const provider = await resolveProvider()
      const s: TrainingSession = {
        id: makeId('ses'),
        sentenceId: input.sentenceId,
        sentenceText: input.sentenceText,
        articleId: input.articleId,
        articleVersion: input.articleVersion,
        paragraphNo: input.paragraphNo,
        contextBefore: input.contextBefore,
        contextAfter: input.contextAfter,
        state: 'PREPARE',
        providerId: provider.id,
        modelId: provider.modelId,
        startedAt: iso(),
        currentLevel: input.directAnalysisSeen ? 3 : 0,
        // Prior direct analysis IS answer exposure. Keeping this false made the
        // UI show a green "L0 独立" badge next to an orange "已看解析" badge.
        answerRevealed: input.directAnalysisSeen,
        directAnalysisSeen: input.directAnalysisSeen,
        clarifyCount: 0,
        retryCount: 0,
        transferCount: 0,
        draft: '',
        disputed: false,
        policyVersion: POLICY_VERSION,
      }
      await store.putSession(s)
      const notice = input.directAnalysisSeen
        ? '你此前已查看该句的直接解析：本轮已标记为「答案已暴露」条件，不会计入无提示独立测评。'
        : undefined
      return snapshot(s, notice)
    },

    async resumeSession(sessionId) {
      const s = await store.getSession(sessionId)
      return s ? snapshot(s, '已恢复上次训练现场：草稿、阶段与阅读锚点均保留。') : null
    },

    async dispatch(sessionId, intent) {
      const s = await store.getSession(sessionId)
      if (!s) throw new Error('训练会话不存在')
      const attempts = await store.listAttempts(sessionId)
      const analysis = await analysisFor(s)
      let notice: string | undefined
      let policyNote: string | undefined

      switch (intent.type) {
        case 'SET_DRAFT': {
          s.draft = intent.text
          await store.putSession(s)
          break
        }

        case 'EXIT': {
          // Exit never destroys state; the session remains resumable (S07 / R05).
          await store.putSession(s)
          notice = '已返回阅读；本轮现场（草稿、阶段、提示等级）已保存，可随时继续。'
          break
        }

        case 'SUBMIT': {
          const text = intent.text.trim()
          if (!text) {
            notice = '请先写下你的理解；空内容不会创建作答记录。'
            break
          }
          const gate = canSubmit(s, attempts)
          if (!gate.ok) {
            notice = gate.reason
            break
          }
          // CRITICAL (S02): persist Attempt #1 BEFORE any model request.
          const attempt: Attempt = {
            id: makeId('att'),
            sessionId: s.id,
            sequence: attempts.length + 1,
            userText: text,
            submittedAt: iso(),
            exposureSnapshot: {
              level: s.currentLevel,
              answerRevealed: s.answerRevealed,
              directAnalysisSeen: s.directAnalysisSeen,
            },
          }
          await store.addAttempt(attempt)
          s.draft = ''
          s.state = 'DIAGNOSE'
          await store.putSession(s)
          return runDiagnosis(s, attempt)
        }

        case 'RETRY_DIAGNOSIS': {
          if (s.state !== 'DIAGNOSE_FAILED') {
            notice = '当前不处于可重试状态。'
            break
          }
          const last = attempts[attempts.length - 1]
          if (!last) {
            notice = '没有可重试的作答记录。'
            break
          }
          s.state = 'DIAGNOSE'
          await store.putSession(s)
          return runDiagnosis(s, last)
        }

        case 'REQUEST_HINT': {
          // Idempotent guard: once L3 is revealed, a further hint must not
          // append another full-analysis row (defence even when the intent
          // whitelist is bypassed, e.g. over IPC).
          if (s.answerRevealed || s.currentLevel >= 3) {
            notice = '已展示完整解析（Level 3），没有更深的提示了。'
            break
          }
          const next = Math.min(3, s.currentLevel + 1) as 0 | 1 | 2 | 3
          s.currentLevel = next
          if (next >= 3) {
            s.answerRevealed = true
            await addFeedback(s, 3, 'full', level3Content(s, analysis))
            notice = 'Level 3 完整解析已解锁；本句不再计为独立正确。'
          } else {
            const hints = analysis.targets
              .map((t) => t.hintLevel2)
              .filter(Boolean)
              .slice(0, 2)
            await addFeedback(s, next, 'hint', `Level ${next} 局部线索：${hints.join(' ')}`)
            notice = `已记录 Level ${next} 提示及暴露时间。`
          }
          await store.putSession(s)
          break
        }

        case 'UNLOCK_LEVEL3': {
          // Idempotent: revealing the answer twice must not append duplicate
          // L3 rows or rewrite the profile again.
          if (s.answerRevealed || s.currentLevel >= 3) {
            notice = '完整解析已展示过，本句不再计为独立正确。'
            break
          }
          s.currentLevel = 3
          s.answerRevealed = true
          await addFeedback(s, 3, 'full', level3Content(s, analysis))
          // Append-only correction: getProfile() keeps the LATEST row per
          // (session,target). Only downgrade rows that were previously counted
          // as "independent-correct". Rewriting incorrect/insufficient into
          // assisted-correct would erase real mistakes from the profile.
          const diagnosis = await store.getDiagnosis(s.id)
          const last = attempts[attempts.length - 1]
          const prior = new Map<string, SkillObservation>()
          for (const o of await store.listObservations()) {
            if (o.sessionId === s.id) prior.set(o.targetId, o)
          }
          for (const t of analysis.targets) {
            if (prior.get(t.id)?.result !== 'independent-correct') continue
            await store.addObservation({
              id: makeId('obs'),
              targetId: t.id,
              category: t.category,
              sentenceId: s.sentenceId,
              sessionId: s.id,
              attemptId: last?.id ?? 'no-attempt',
              assistedLevel: 3,
              answerRevealed: true,
              result: 'assisted-correct',
              evidenceCount: diagnosis?.evidences.find((e) => e.targetId === t.id)?.answerQuote ? 1 : 0,
              timestamp: iso(),
            })
          }
          await store.putSession(s)
          notice = '已标记 Answer Revealed：原句随后不能标为独立正确，学习档案按「提示后」归因。'
          break
        }

        case 'ACCEPT_TRANSFER': {
          if (s.transferCount >= POLICY_LIMITS.maxTransfer || s.transfer) {
            notice = '默认最多一道迁移题，应用不再生成更多题目。'
            policyNote = '应用拒绝了超出策略上限的迁移请求。'
            break
          }
          const diagnosis = await store.getDiagnosis(s.id)
          const ex = diagnosis
            ? buildTransferExercise(analysis, diagnosis.evidences, s.sentenceText)
            : null
          if (!ex) {
            notice = '这句没有已解决且可复用的技能点，跳过迁移，返回阅读即可。'
            break
          }
          s.transfer = {
            exerciseId: ex.exerciseId,
            sentence: ex.sentence,
            meaning: ex.meaning,
            keyPoint: ex.keyPoint,
            category: ex.category,
            validationStatus: ex.validationStatus,
            accept: ex.accept,
            conflict: ex.conflict,
            validationIssues: ex.validationIssues,
          }
          s.transferCount += 1
          s.state = 'TRANSFER'
          await addFeedback(
            s,
            s.currentLevel,
            'notice',
            `迁移句（先看懂再作答，暂不显示参考含义）：\n${ex.sentence}${
              ex.validationStatus === 'unscored'
                ? `\n\n注意：该题校验未通过（${ex.validationIssues.join('；')}），按规则不计分、不写入能力记录。`
                : ''
            }`,
          )
          await store.putSession(s)
          break
        }

        case 'SUBMIT_TRANSFER': {
          if (!s.transfer) {
            notice = '当前没有迁移题。'
            break
          }
          const text = intent.text.trim()
          if (!text) {
            notice = '请先写下对新句的理解。'
            break
          }
          const evaluated = evaluateTransfer(s.transfer, text)
          // If the learner already saw the answer (L3 / prior analysis), the
          // transfer cannot be scored as an independent correct result.
          const exposed = s.answerRevealed || s.currentLevel >= 3 || s.directAnalysisSeen
          const result = exposed
            ? { ...evaluated, result: 'unscored' as const, rationale: '本轮已看过解析，迁移表现不计分。' }
            : evaluated
          s.transferAttempt = { text, submittedAt: iso(), ...result }
          // A viewed-answer transfer must not create a "correct" review task.
          if (!exposed) await store.addReviewTask(makeReviewTask(s.transfer, now()))
          await addFeedback(
            s,
            3,
            'full',
            `即时迁移表现：${result.result}。${result.rationale}\n参考含义：${s.transfer.meaning}\n目标知识点：${s.transfer.keyPoint}\n\n${exposed ? '本轮已看过解析，未排入延迟复测。' : '延迟复测已单独排入队列（约 3 天后），与即时表现分开存储。'}`,
          )
          s.state = 'COMPLETE'
          s.endedAt = iso()
          await store.putSession(s)
          notice = result.result === 'unscored' ? '该题不计分，未生成负面学习记录。' : '即时表现已保存，延迟复测已排期。'
          break
        }

        case 'SKIP_TRANSFER': {
          s.state = 'COMPLETE'
          s.endedAt = iso()
          await store.putSession(s)
          notice = '本轮结束，可返回阅读。'
          break
        }

        case 'DISPUTE': {
          // Never let the user dispute a diagnosis that was never produced.
          if (!await store.getDiagnosis(s.id)) {
            notice = '本次还没有生成诊断，无法标记为争议。'
            break
          }
          s.disputed = true
          await addFeedback(
            s,
            s.currentLevel,
            'notice',
            `你质疑了本次诊断：${intent.note.trim() || '（未填写理由）'}。原诊断与证据保持不变，仅追加争议标记供复核；争议项不计入长期能力负面记录。`,
          )
          await store.putSession(s)
          notice = '已标记为有争议（disputed / review），旧记录未被静默修改。'
          break
        }
      }

      await store.putSession(s)
      return snapshot(s, notice, policyNote)
    },

    async getProfile() {
      return getProfile()
    },

    async addMark(input) {
      const createdAt = iso()
      await store.addMark({
        id: makeId('mk'),
        articleId: input.articleId,
        sentenceId: input.sentenceId,
        sentenceText: input.sentenceText,
        note: input.note,
        createdAt,
        status: 'pending',
      })
      await store.addReviewTask({
        id: makeId('rev'),
        skillId: input.sentenceId,
        sentenceText: input.sentenceText,
        earliestDue: new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
        source: 'review-later',
        createdAt,
      })
    },

    async updateMark(id, status) {
      await store.updateMark(id, { status })
    },

    async updateReviewTask(id, status) {
      await store.updateReviewTask(id, { status })
    },

    /** The notebook stores a snapshot so a meaning is always available offline. */
    async listWrongWords() {
      const list = await store.listWrongWords()
      return list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    },

    async addWrongWord(input) {
      const query = input.query.trim().slice(0, 80)
      if (!query) return { added: false, word: null }
      const result = lookupWord(query)
      // Inflected forms deduplicate onto their lemma: "ran" and "run" are one entry.
      const lemma = (result.entry?.word ?? query).trim()
      const key = lemma.toLowerCase()
      const existing = (await store.listWrongWords()).find((w) => w.word.toLowerCase() === key)
      if (existing) return { added: false, word: existing }

      const word: WrongWord = {
        id: makeId('ww'),
        word: lemma,
        query,
        translation: result.entry?.translation ?? result.note ?? '离线词库未收录该词。',
        tags: result.entry?.tags ?? [],
        found: result.found,
        createdAt: iso(),
        ...(result.entry?.phonetic ? { phonetic: result.entry.phonetic } : {}),
        ...(result.entry?.base ? { base: result.entry.base } : {}),
        ...(result.note ? { note: result.note } : {}),
        ...(input.sentenceText ? { sentenceText: input.sentenceText.slice(0, 300) } : {}),
        ...(input.articleId ? { articleId: input.articleId } : {}),
      }
      await store.addWrongWord(word)
      return { added: true, word }
    },

    async removeWrongWord(id) {
      await store.removeWrongWord(id)
    },

    async setSettings(patch) {
      const next = await store.setSettings(patch)
      return next
    },

    async getApiConfig() {
      return store.getApiConfig()
    },

    async setApiConfig(patch) {
      const next = await store.setApiConfig(patch)
      // Enforce the billing gate even when the UI is bypassed over IPC:
      // enabling requires explicit cost confirmation, a key, a model and a URL.
      if (next.enabled && (!next.costConfirmed || !next.hasKey || !next.model.trim() || !next.baseUrl.trim())) {
        return store.setApiConfig({ enabled: false })
      }
      return next
    },

    async setApiKey(key) {
      const trimmed = key.trim()
      if (!trimmed) throw new Error('API Key 不能为空。')
      await store.setApiKey(trimmed)
      return store.getApiConfig()
    },

    async clearApiKey() {
      await store.clearApiKey()
      await store.setApiConfig({ enabled: false, lastTest: undefined })
      return store.getApiConfig()
    },

    async testApiConnection() {
      const cfg = await store.getApiConfig()
      if (!cfg.hasKey) return { ok: false, message: '请先填写并保存 API Key。' }
      if (!cfg.model.trim() || !cfg.baseUrl.trim()) {
        return { ok: false, message: '请先填写 Base URL 与模型名。' }
      }
      // A connection test is a real (billable) request. Never send one without
      // the same explicit cost confirmation that gates diagnosis itself.
      if (!cfg.costConfirmed) {
        return { ok: false, message: '请先在设置里勾选费用确认，再测试连接（测试会发出真实请求）。' }
      }
      try {
        const provider = await factory('third-party-api')
        if (!provider.testConnection) return { ok: false, message: '当前 Provider 不支持连接测试。' }
        const result = await provider.testConnection()
        await store.setApiConfig({ lastTest: { ok: result.ok, at: iso(), message: result.message } })
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知错误'
        await store.setApiConfig({ lastTest: { ok: false, at: iso(), message } })
        return { ok: false, message, errorKind: 'NETWORK' }
      }
    },

    async exportData() {
      return store.exportAll()
    },

    async deleteAllData() {
      await store.clearAll()
    },
  }
}
