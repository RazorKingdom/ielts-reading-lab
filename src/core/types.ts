/**
 * Shared domain types for IELTS Reading Lab.
 * Pure data definitions only - no DOM, no Node APIs, no side effects.
 * This file is compiled both into the renderer (Vite) and the Electron main
 * process (tsconfig.electron.json), so it must stay environment agnostic.
 */

export type Verdict = 'correct' | 'incorrect' | 'partial' | 'insufficient' | 'disputed'
export type TeachingAction = 'PASS' | 'CLARIFY' | 'RETRY' | 'EXPLAIN' | 'TRANSFER'
export type FeedbackLevel = 0 | 1 | 2 | 3
export type TargetWeight = 'core' | 'important' | 'minor'
export type SourceType = 'paste' | 'sample'

export type SessionState =
  | 'PREPARE'
  | 'ATTEMPT'
  | 'DIAGNOSE'
  | 'CLARIFY'
  | 'RETRY'
  | 'EXPLAIN'
  | 'PASS'
  | 'TRANSFER'
  | 'COMPLETE'
  | 'DIAGNOSE_FAILED'

export interface Sentence {
  id: string
  articleId: string
  articleVersion: string
  paragraphNo: number
  indexInParagraph: number
  startOffset: number
  endOffset: number
  text: string
}

export interface Paragraph {
  no: number
  text: string
  sentences: Sentence[]
}

export interface Article {
  id: string
  sourceType: SourceType
  title: string
  originalText: string
  versionHash: string
  createdAt: string
  sourceNote: string
}

export interface ReadingPosition {
  articleId: string
  sentenceId: string
  anchorOffset: number
  viewportRatio: number
  updatedAt: string
}

export type TargetCategory =
  | '核心主谓'
  | '修饰与从句功能'
  | '意群'
  | '指代'
  | '语义程度与否定范围'
  | '逻辑关系'
  | '词组语境义'

/** Rule hints used only by the offline Mock provider. Real providers never see `rules`. */
export interface TargetRules {
  /** Regex sources (Chinese) signalling an acceptable understanding. */
  accept: string[]
  /** Regex sources signalling a direct conflict with the source meaning. */
  conflict: string[]
  /** Regex sources signalling a broadly right answer missing an important detail. */
  partial: string[]
}

export interface DiagnosticTarget {
  id: string
  sentenceId: string
  category: TargetCategory
  originalSpan: string
  expectedMeaning: string
  supportedAlternatives: string[]
  possibleMisreadings: string[]
  weight: TargetWeight
  hintLevel1: string
  hintLevel2: string
  explanation: string
  rules?: TargetRules
  transferTemplate?: TransferTemplate
  /** Marks genuine ambiguity - triggers `disputed` instead of a hard verdict. */
  ambiguous?: boolean
}

export interface TransferTemplate {
  sentence: string
  meaning: string
  keyPoint: string
  accept: string[]
  conflict: string[]
}

export interface SentenceAnalysis {
  sentenceId: string
  skeleton: { subject: string; predicate: string; object: string; note: string }
  chunks: { text: string; role: string; meaning: string }[]
  phrases: { text: string; meaning: string }[]
  meaning: string
  layers: string[]
  followUps: string[]
  targets: DiagnosticTarget[]
  ambiguity?: string
  /** 'bundled' when a full offline reference reading is available. */
  source?: 'bundled' | 'local'
}

export interface TargetEvidence {
  targetId: string
  status: Verdict
  originalSpan: string
  /** Verbatim quote from the learner's answer. Empty is only legal for `insufficient`. */
  answerQuote: string
  rationale: string
  disputed?: boolean
  suggestedAction?: TeachingAction
}

export interface RawDiagnosis {
  evidences: TargetEvidence[]
  summary: string
  suggestedAction: TeachingAction
}

export interface ValidationResult {
  valid: boolean
  issues: string[]
}

export interface Diagnosis extends RawDiagnosis {
  id: string
  providerId: string
  modelId: string
  sessionId: string
  sentenceId: string
  attemptId: string
  createdAt: string
  validation: ValidationResult
  policyVersion: string
}

export interface ExposureSnapshot {
  level: FeedbackLevel
  answerRevealed: boolean
  directAnalysisSeen: boolean
}

export interface Attempt {
  id: string
  sessionId: string
  sequence: number
  userText: string
  submittedAt: string
  exposureSnapshot: ExposureSnapshot
}

export interface FeedbackEvent {
  id: string
  sessionId: string
  level: FeedbackLevel
  kind: 'diagnosis' | 'hint' | 'full' | 'correction' | 'notice' | 'pass'
  content: string
  exposedAt: string
}

export interface TeachingDecision {
  id: string
  sessionId: string
  action: TeachingAction
  reasonCodes: string[]
  /** Persisted policy-veto explanation so it survives resume/restart. */
  policyNote?: string
  evidenceIds: string[]
  policyVersion: string
  createdAt: string
}

export interface TransferResult {
  text: string
  submittedAt: string
  result: 'correct' | 'partial' | 'incorrect' | 'unscored'
  rationale: string
}

export interface TrainingSession {
  id: string
  sentenceId: string
  sentenceText: string
  articleId: string
  articleVersion: string
  paragraphNo: number
  contextBefore: string
  contextAfter: string
  state: SessionState
  providerId: string
  modelId: string
  startedAt: string
  endedAt?: string
  currentLevel: FeedbackLevel
  answerRevealed: boolean
  directAnalysisSeen: boolean
  clarifyCount: number
  retryCount: number
  transferCount: number
  draft: string
  disputed: boolean
  policyVersion: string
  transfer?: {
    exerciseId: string
    sentence: string
    meaning: string
    keyPoint: string
    category: TargetCategory
    validationStatus: 'validated' | 'unscored'
    /** Internal matching rules for the offline exercise evaluator. */
    accept?: string[]
    conflict?: string[]
    validationIssues?: string[]
  }
  transferAttempt?: TransferResult
  lastError?: string
  /** Human-readable, actionable guidance for lastError; survives resume. */
  lastErrorNote?: string
}

export type TrainingIntent =
  | { type: 'SET_DRAFT'; text: string }
  | { type: 'SUBMIT'; text: string }
  | { type: 'REQUEST_HINT' }
  | { type: 'UNLOCK_LEVEL3' }
  | { type: 'ACCEPT_TRANSFER' }
  | { type: 'SKIP_TRANSFER' }
  | { type: 'SUBMIT_TRANSFER'; text: string }
  | { type: 'DISPUTE'; note: string }
  | { type: 'RETRY_DIAGNOSIS' }
  | { type: 'EXIT' }

export interface SessionSnapshot {
  session: TrainingSession
  attempts: Attempt[]
  diagnosis?: Diagnosis
  feedback: FeedbackEvent[]
  analysis: SentenceAnalysis
  decisions: TeachingDecision[]
  availableIntents: TrainingIntent['type'][]
  notice?: string
  /** True when the app (not the model) vetoed a suggested decision. */
  policyNote?: string
}

export type ObservationResult =
  | 'independent-correct'
  | 'assisted-correct'
  | 'partial'
  | 'incorrect'
  | 'insufficient'
  | 'disputed'
  | 'unscored'

export interface SkillObservation {
  id: string
  targetId: string
  category: TargetCategory
  sentenceId: string
  sessionId: string
  attemptId: string
  assistedLevel: FeedbackLevel
  answerRevealed: boolean
  result: ObservationResult
  evidenceCount: number
  timestamp: string
}

export interface ReviewTask {
  id: string
  skillId: string
  sentenceText: string
  earliestDue: string
  status: 'pending' | 'done' | 'skipped'
  source: 'transfer' | 'review-later'
  createdAt: string
}

export interface MarkedSentence {
  id: string
  sentenceId: string
  articleId: string
  sentenceText: string
  note: string
  createdAt: string
  status: 'pending' | 'done'
}

/**
 * A word the reader flagged from the left-click dictionary card.
 * The lookup snapshot is stored with it so the notebook still shows a meaning
 * offline and stays reproducible even if the bundled dictionary changes.
 */
export interface WrongWord {
  id: string
  /** Normalised lemma (lowercased) used for deduplication and display. */
  word: string
  /** The exact surface text the reader clicked or selected. */
  query: string
  phonetic?: string
  translation: string
  tags: string[]
  /** Lemma when the query was an inflected form. */
  base?: string
  /** False when the offline dictionary had no entry for this word. */
  found: boolean
  note?: string
  /** Sentence the word was picked from, shown as context in the notebook. */
  sentenceText?: string
  articleId?: string
  createdAt: string
}

export interface ProfileStats {
  totalSessions: number
  independentCorrect: number
  assistedCorrect: number
  partial: number
  incorrect: number
  disputed: number
  evidenceCount: number
  pendingReviews: number
  transferCorrect: number
  transferUnscored: number
}

export interface Profile {
  observations: SkillObservation[]
  reviewTasks: ReviewTask[]
  marks: MarkedSentence[]
  sessions: TrainingSession[]
  stats: ProfileStats
}

export interface ProviderCapability {
  id: string
  label: string
  kind: 'mock' | 'siwc' | 'api' | 'local' | 'codex'
  status: 'available' | 'unverified' | 'disabled'
  authentication: string
  availableModels: string[]
  streaming: boolean
  cancellation: boolean
  strictStructuredOutput: boolean
  maxContext?: number
  estimatedCost: string
  errorTypes: string[]
  note: string
}

export interface DiagnosisRequest {
  analysis: SentenceAnalysis
  /** Exact source sentence, needed to verify every originalSpan verbatim. */
  sentenceText?: string
  attemptText: string
  contextBefore: string
  contextAfter: string
  level: FeedbackLevel
  attemptSequence: number
}

export interface AIProvider {
  id: string
  modelId: string
  capability: ProviderCapability
  diagnose(req: DiagnosisRequest): Promise<RawDiagnosis>
  /** Optional lightweight connectivity probe used by the settings page. */
  testConnection?(): Promise<ApiConnectionResult>
}

/** Non-secret configuration for a user-supplied OpenAI-compatible endpoint. */
export interface ThirdPartyConfig {
  baseUrl: string
  model: string
  enabled: boolean
  /** Explicit user acknowledgement that this is an independently billed API. */
  costConfirmed: boolean
  /** Derived from encrypted credential availability; never contains the key. */
  hasKey: boolean
  lastTest?: { ok: boolean; at: string; message: string }
}

export interface ApiConnectionResult {
  ok: boolean
  message: string
  model?: string
  errorKind?: string
}

export interface AppSettings {
  activeProviderId: string
  theme: 'light' | 'dark'
  fontScale: number
  personalization: boolean
  showModelMeta: boolean
  /** Version of the built-in article bank already offered to this database. */
  sampleBankVersion?: number
}

export const POLICY_VERSION = 'policy-0.1.0'
