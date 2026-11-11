import type { Article, TeachingAction, Verdict } from './types'
import { createArticle } from './segment'
import { ARTICLE_BANK } from './articleBank'

export { ARTICLE_BANK_VERSION, ARTICLE_BANK_SIZE } from './articleBank'

/**
 * 100 ORIGINAL IELTS-style practice passages. NOT official past papers and not
 * copied from any copyrighted source. The first three are hand-written and
 * contain the human-labelled diagnostic target sentences; the other 97 are
 * deterministically composed by scripts/generate-article-bank.mjs.
 */
export const SAMPLE_ARTICLE_INPUTS = ARTICLE_BANK

export function createSampleArticles(now = new Date().toISOString()): Article[] {
  return ARTICLE_BANK.map((s, i) =>
    createArticle({
      id: `sample-${i + 1}`,
      title: s.title,
      originalText: s.text,
      sourceType: 'sample',
      sourceNote: s.sourceNote,
      now,
    }),
  )
}

/** Human-labelled baseline cases from test plan section 2. */
export interface BenchmarkCase {
  id: string
  sentence: string
  answer: string
  /** Expected status of the CORE target (never a hard error for reasonable simplification). */
  expectedCoreStatus: Verdict
  expectedAction: TeachingAction
  note: string
}

const S_D01 =
  'The extent to which technology improves productivity depends on how effectively employees use it.'
const S_D04 = 'Although resources are widely available, understanding depends on critical evaluation.'
const S_D06 = 'Success depends less on speed than on accuracy.'
const S_D08 = 'The system was designed to reduce costs.'
const S_D09 = 'The information students encounter is not always reliable.'
const S_D10 = 'The decision depends on whether the evidence is sufficient.'
const S_D11 = 'The policy, introduced last year, has not yet produced measurable results.'

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: 'D01', sentence: S_D01,
    answer: '技术提高生产率的程度取决于员工使用技术有多有效。',
    expectedCoreStatus: 'correct', expectedAction: 'PASS', note: '关键正确',
  },
  {
    id: 'D02', sentence: S_D01,
    answer: '技术提高生产率取决于员工怎么使用技术。',
    expectedCoreStatus: 'partial', expectedAction: 'CLARIFY', note: '大意正确、程度细节缺失；不得判语法错误',
  },
  {
    id: 'D03', sentence: S_D01,
    answer: '技术提高了生产率，所以员工更有效地用它。',
    expectedCoreStatus: 'incorrect', expectedAction: 'RETRY', note: '依赖方向倒置为因果',
  },
  {
    id: 'D04', sentence: S_D04,
    answer: '虽然资源丰富，理解仍取决于批判性评价。',
    expectedCoreStatus: 'correct', expectedAction: 'PASS', note: '让步关系正确',
  },
  {
    id: 'D05', sentence: S_D04,
    answer: '资源丰富，因此理解自然更好。',
    expectedCoreStatus: 'incorrect', expectedAction: 'RETRY', note: '让步误读为因果',
  },
  {
    id: 'D06', sentence: S_D06,
    answer: '成功同等取决于速度与准确性。',
    expectedCoreStatus: 'incorrect', expectedAction: 'RETRY', note: '重要比较关系错误',
  },
  {
    id: 'D07', sentence: S_D06,
    answer: '成功相比速度更取决于准确性。',
    expectedCoreStatus: 'correct', expectedAction: 'PASS', note: '比较方向正确',
  },
  {
    id: 'D08', sentence: S_D08,
    answer: '系统已经降低了成本。',
    expectedCoreStatus: 'incorrect', expectedAction: 'RETRY', note: '把目的当结果',
  },
  {
    id: 'D09', sentence: S_D09,
    answer: '学生接触的信息未必可靠。',
    expectedCoreStatus: 'correct', expectedAction: 'PASS', note: '正确，即使未称定语从句',
  },
  {
    id: 'D10', sentence: S_D10,
    answer: '这取决于证据是否充足。',
    expectedCoreStatus: 'correct', expectedAction: 'PASS', note: '正确，不强制命名 whether 从句类型',
  },
  {
    id: 'D11', sentence: S_D11,
    answer: '去年出台的政策尚未产生可测量结果。',
    expectedCoreStatus: 'correct', expectedAction: 'PASS', note: '否定与时间均正确',
  },
  {
    id: 'D12', sentence: S_D11,
    answer: '政策去年已产生可测量结果。',
    expectedCoreStatus: 'incorrect', expectedAction: 'RETRY', note: '否定/时间误读',
  },
]

/**
 * Adversarial cases: reasonable simplifications, non-standard but correct
 * translations, and genuine ambiguity must never be judged `incorrect`.
 */
export interface AdversarialCase {
  id: string
  sentence: string
  answer: string
  forbiddenCoreStatus: Verdict
  note: string
}

export const ADVERSARIAL_CASES: AdversarialCase[] = [
  { id: 'A01', sentence: S_D01, answer: '技术能提升多少生产率，得看员工用得好不好。', forbiddenCoreStatus: 'incorrect', note: '口语化意译但程度与依赖均在' },
  { id: 'A02', sentence: S_D01, answer: '员工用得越顺手，效率提升越明显。', forbiddenCoreStatus: 'incorrect', note: '非标准对应但语义合理' },
  { id: 'A03', sentence: S_D10, answer: '看证据够不够。', forbiddenCoreStatus: 'incorrect', note: '极简但正确，无语法术语' },
  { id: 'A04', sentence: S_D09, answer: '学生看到的资料不一定都可信。', forbiddenCoreStatus: 'incorrect', note: '同义替换，未用术语' },
  { id: 'A05', sentence: S_D11, answer: '政策去年才推出来，到现在还没看到成效。', forbiddenCoreStatus: 'incorrect', note: '打乱顺序但否定与时间正确' },
  { id: 'A06', sentence: S_D06, answer: '准确性比速度更关键。', forbiddenCoreStatus: 'incorrect', note: '省去主干动词但比较方向正确' },
  { id: 'A07', sentence: 'Teachers often receive printed resources together with digital ones. How effectively teachers integrate them into their lessons varies widely across schools.', answer: '老师把这些材料用进课堂的效果，各校差别很大。', forbiddenCoreStatus: 'incorrect', note: 'them 指代歧义，不得硬判错' },
  { id: 'A08', sentence: S_D04, answer: '资源多不代表理解就好，还是得自己评判。', forbiddenCoreStatus: 'incorrect', note: '意译让步关系' },
  { id: 'A09', sentence: S_D08, answer: '这套系统是用来省钱的。', forbiddenCoreStatus: 'incorrect', note: '目的表述，无术语' },
  { id: 'A10', sentence: S_D01, answer: '不知道。', forbiddenCoreStatus: 'incorrect', note: '表示不理解，不应判为理解错误' },
]
