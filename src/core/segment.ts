import type { Article, Paragraph, Sentence } from './types'
import { contentHash, fnv1a } from './hash'

/** Abbreviations that must not be treated as sentence terminators. */
const ABBREVIATIONS = [
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'e.g', 'i.e', 'fig', 'no',
  'inc', 'ltd', 'jr', 'sr', 'approx', 'cf', 'al',
]

function isDecimalPoint(text: string, i: number): boolean {
  return /[0-9]/.test(text[i - 1] ?? '') && /[0-9]/.test(text[i + 1] ?? '')
}

function isAbbreviationDot(text: string, i: number): boolean {
  if (isDecimalPoint(text, i)) return true
  let start = i - 1
  while (start >= 0 && /[A-Za-z.]/.test(text[start])) start--
  const rawWord = text.slice(start + 1, i + 1).toLowerCase()
  const word = rawWord.replace(/\.$/, '')
  return (
    ABBREVIATIONS.includes(word) ||
    ABBREVIATIONS.includes(rawWord) ||
    /^([a-z]\.){2,}$/.test(rawWord)
  )
}

/** Does a terminator at index i end a sentence? */
function isBoundary(text: string, i: number): boolean {
  const ch = text[i]
  if (ch !== '.' && ch !== '!' && ch !== '?') return false
  if (ch === '.' && isAbbreviationDot(text, i)) return false
  // absorb consecutive terminators / closing quotes
  let j = i + 1
  while (j < text.length && /[.!?'")\]]/.test(text[j])) j++
  if (j >= text.length) return true
  return /\s/.test(text[j])
}

/**
 * Split a paragraph into sentences while preserving every original punctuation mark.
 * Offsets point into the paragraph text, so the source can always be reconstructed.
 */
export function splitSentences(paragraphText: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = []
  let start = 0
  for (let i = 0; i < paragraphText.length; i++) {
    if (!isBoundary(paragraphText, i)) continue
    let j = i + 1
    while (j < paragraphText.length && /[.!?'")\]]/.test(paragraphText[j])) j++
    const raw = paragraphText.slice(start, j)
    const text = raw.trim()
    if (text) out.push({ text, start: start + (raw.length - raw.trimStart().length), end: j })
    start = j
  }
  const tail = paragraphText.slice(start)
  if (tail.trim()) {
    out.push({
      text: tail.trim(),
      start: start + (tail.length - tail.trimStart().length),
      end: paragraphText.length,
    })
  }
  return out
}

/** Split pasted plain text into paragraphs. Blank lines win; otherwise each line is a paragraph. */
export function splitParagraphs(originalText: string): string[] {
  const normalized = originalText.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  if (/\n\s*\n/.test(normalized)) {
    return normalized
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
  }
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)
  // A single very long line: keep it as one paragraph (no lossy auto-wrapping).
  return lines.length > 1 ? lines : [normalized]
}

export function sentenceId(
  articleId: string,
  versionHash: string,
  paragraphNo: number,
  index: number,
  text: string,
): string {
  return `${articleId}:${versionHash.slice(0, 8)}:p${paragraphNo}:s${index}:${fnv1a(text).toString(36)}`
}

/** Derive paragraphs + stable sentence ids from an article. Pure and repeatable. */
export function segmentArticle(article: Article): Paragraph[] {
  return splitParagraphs(article.originalText).map((text, pIdx) => {
    const paragraphNo = pIdx + 1
    const sentences: Sentence[] = splitSentences(text).map((s, sIdx) => ({
      id: sentenceId(article.id, article.versionHash, paragraphNo, sIdx, s.text),
      articleId: article.id,
      articleVersion: article.versionHash,
      paragraphNo,
      indexInParagraph: sIdx,
      startOffset: s.start,
      endOffset: s.end,
      text: s.text,
    }))
    return { no: paragraphNo, text, sentences }
  })
}

export function createArticle(input: {
  title?: string
  originalText: string
  sourceType?: Article['sourceType']
  sourceNote?: string
  now?: string
  id?: string
}): Article {
  const originalText = input.originalText.replace(/\r\n?/g, '\n')
  const versionHash = contentHash(originalText)
  const createdAt = input.now ?? new Date().toISOString()
  const id = input.id ?? `art_${fnv1a(originalText + createdAt).toString(36)}`
  return {
    id,
    sourceType: input.sourceType ?? 'paste',
    title: (input.title ?? '').trim() || '未命名文章',
    originalText,
    versionHash,
    createdAt,
    sourceNote: input.sourceNote ?? '用户自行粘贴；请仅导入你有权使用的内容',
  }
}

export function allSentences(paragraphs: Paragraph[]): Sentence[] {
  return paragraphs.flatMap((p) => p.sentences)
}
