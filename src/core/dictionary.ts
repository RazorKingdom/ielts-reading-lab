import { DICT_ROWS } from '../data/dictionary'
import type { DictRow } from '../data/dictionary'

/**
 * Fully offline word lookup. The data comes from ECDICT (MIT) filtered to the
 * words used by this app's reading passages plus IELTS/high-frequency words.
 * No network, no AI, no credential is involved.
 */

export interface WordEntry {
  word: string
  phonetic?: string
  translation: string
  tags: string[]
  /** Set when the query was an inflected form and the entry is its lemma. */
  base?: string
}

export interface LookupResult {
  query: string
  found: boolean
  entry?: WordEntry
  suggestions: string[]
  note?: string
}

const TAG_LABELS: Record<string, string> = {
  ielts: '雅思',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  gk: '高考',
  zk: '中考',
}

/** Common irregular forms that a suffix rule cannot recover. */
const IRREGULAR: Record<string, string> = {
  gave: 'give', given: 'give', went: 'go', gone: 'go', done: 'do', did: 'do',
  took: 'take', taken: 'take', made: 'make', saw: 'see', seen: 'see',
  wrote: 'write', written: 'write', chose: 'choose', chosen: 'choose',
  began: 'begin', begun: 'begin', held: 'hold', kept: 'keep', felt: 'feel',
  left: 'leave', built: 'build', sent: 'send', spent: 'spend', meant: 'mean',
  bought: 'buy', brought: 'bring', thought: 'think', taught: 'teach',
  caught: 'catch', paid: 'pay', said: 'say', told: 'tell', found: 'find',
  ran: 'run', fell: 'fall', fallen: 'fall', rose: 'rise', risen: 'rise',
  grew: 'grow', grown: 'grow', knew: 'know', known: 'know', threw: 'throw',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  men: 'man', women: 'woman', children: 'child', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', lives: 'life', wives: 'wife', leaves: 'leaf',
}

let index: Map<string, WordEntry> | null = null
/** surface form -> lemma word, from ECDICT exchange data */
let variants: Map<string, string> | null = null
let sortedWords: string[] | null = null

function toEntry(row: DictRow): WordEntry {
  const [word, phonetic, translation, tagsRaw] = row
  const tags = tagsRaw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => TAG_LABELS[t] ?? t)
  return { word, phonetic: phonetic || undefined, translation, tags }
}

function getIndex(): Map<string, WordEntry> {
  if (!index) {
    index = new Map()
    variants = new Map()
    for (const row of DICT_ROWS) {
      const entry = toEntry(row)
      index.set(row[0].toLowerCase(), entry)
      if (row[4]) variants.set(row[0].toLowerCase(), row[4].toLowerCase())
    }
  }
  return index
}

export function dictionarySize(): number {
  return DICT_ROWS.length
}

export function clearDictionaryCache(): void {
  index = null
  sortedWords = null
}

/**
 * Extract the word at a text offset (used by left-click word picking).
 * Pure so the boundary rules can be unit-tested without a DOM.
 */
export function extractWordAt(text: string, offset: number): string {
  const idx = Math.max(0, Math.min(offset, text.length))
  const isWord = (ch: string) => /[\p{L}\p{N}’'-]/u.test(ch)
  let start = idx
  let end = idx
  if (idx < text.length && isWord(text[idx])) end = idx + 1
  while (start > 0 && isWord(text[start - 1])) start--
  while (end < text.length && isWord(text[end])) end++
  return text.slice(start, end).replace(/^[’'-]+|[’'-]+$/g, '')
}

/** Candidate keys to try, ordered from exact to increasingly speculative. */
export function normalizeQuery(raw: string): string[] {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return []
  const out: string[] = [trimmed]
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s)
  }

  const stripped = trimmed.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  add(stripped)
  // A multi-word selection: try the whole phrase first, then its head word.
  const head = stripped.match(/[\p{L}]+(?:[-'][\p{L}]+)*/u)?.[0]
  add(head ?? '')
  add(stripped.replace(/['’]s$/, ''))

  const irregular = IRREGULAR[stripped]
  if (irregular) add(irregular)

  const suffixes: [RegExp, string][] = [
    [/ies$/, 'y'], [/es$/, ''], [/s$/, ''],
    [/ing$/, ''], [/ing$/, 'e'], [/ed$/, ''], [/ed$/, 'e'],
    [/er$/, ''], [/est$/, ''], [/ly$/, ''],
  ]
  for (const [re, replacement] of suffixes) {
    if (re.test(stripped)) add(stripped.replace(re, replacement))
  }
  return out
}

function suggestionsFor(query: string, limit = 5): string[] {
  if (query.length < 3) return []
  if (!sortedWords) sortedWords = [...getIndex().keys()].sort()
  const prefix = sortedWords.filter((w) => w.startsWith(query)).slice(0, limit)
  if (prefix.length >= limit) return prefix
  // A short word can be an inflected form, so also offer lemma-prefix hits.
  for (const w of sortedWords) {
    if (prefix.length >= limit) break
    if (w.includes(query) && !prefix.includes(w)) prefix.push(w)
  }
  return prefix
}

export function lookupWord(raw: string): LookupResult {
  const query = raw.trim()
  const candidates = normalizeQuery(query)
  if (!candidates.length) {
    return { query, found: false, suggestions: [], note: '请点击一个英文单词，或划选短语。' }
  }
  const dict = getIndex()

  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i]
    const hit = dict.get(key)
    if (hit) {
      if (i === 0) return { query, found: true, entry: hit, suggestions: [] }
      // The exact surface form is missing: report the recovered base form.
      return {
        query,
        found: true,
        entry: { ...hit, base: hit.word },
        suggestions: [],
        note: `${key} 是 ${hit.word} 的词形变化，已按原形查询。`,
      }
    }
    // ECDICT "exchange" gives a reliable lemma for irregular forms.
    getIndex()
    const lemmaWord = variants?.get(key)
    const base = lemmaWord ? dict.get(lemmaWord) : undefined
    if (base) {
      return {
        query,
        found: true,
        entry: { ...base, base: base.word },
        suggestions: [],
        note: `已按词形还原到 ${base.word}。`,
      }
    }
  }

  return {
    query,
    found: false,
    suggestions: suggestionsFor(candidates[0]),
    note: '离线词库未收录该词；它可能是专有名词、生僻词或新词。',
  }
}
