import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent, CSSProperties } from 'react'
import type { Article, MarkedSentence, ReadingPosition, Sentence, SentenceAnalysis } from '../core/types'
import { allSentences, segmentArticle } from '../core/segment'
import { extractWordAt, lookupWord } from '../core/dictionary'
import { api } from '../backend'
import { Badge, Icon } from './kit'

export interface TrainingRequest {
  sentence: Sentence
  contextBefore: string
  contextAfter: string
  directAnalysisSeen: boolean
}

interface Props {
  article: Article
  fontScale: number
  marks: MarkedSentence[]
  trainedSentenceIds: string[]
  onBack: () => void
  onStartTraining: (req: TrainingRequest) => void
  onDataChanged: () => void
  onToast: (msg: string) => void
}

interface WordToolState { x: number; y: number; text: string }
/** Right-click: compact popover showing only the sentence's Chinese meaning. */
interface SentenceToolState { x: number; y: number; sentenceId: string; sentenceText: string; meaning: string; loading: boolean }
/** Middle-click: the original three-choice menu. */
interface SentenceMenuState { x: number; y: number; sentence: Sentence }

export default function Reader({
  article, fontScale, marks, trainedSentenceIds, onBack, onStartTraining, onDataChanged, onToast,
}: Props) {
  const paragraphs = useMemo(() => segmentArticle(article), [article])
  const sentences = useMemo(() => allSentences(paragraphs), [paragraphs])

  const [wordTool, setWordTool] = useState<WordToolState | null>(null)
  const [sentenceTool, setSentenceTool] = useState<SentenceToolState | null>(null)
  const [sentenceMenu, setSentenceMenu] = useState<SentenceMenuState | null>(null)
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [analysis, setAnalysis] = useState<SentenceAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef<ReadingPosition | null>(null)
  const scrollTimer = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWordTool(null)
        setSentenceTool(null)
        setSentenceMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const markedIds = useMemo(() => new Set(marks.filter((m) => m.status === 'pending').map((m) => m.sentenceId)), [marks])
  const trainedIds = useMemo(() => new Set(trainedSentenceIds), [trainedSentenceIds])

  function contextOf(s: Sentence) {
    const i = sentences.findIndex((x) => x.id === s.id)
    return { before: sentences[i - 1]?.text ?? '', after: sentences[i + 1]?.text ?? '' }
  }

  /** Anchor by articleId + sentenceId, never by a raw pixel offset (R03). */
  function restore(p: ReadingPosition) {
    const container = scrollRef.current
    if (!container) return
    const el = container.querySelector<HTMLElement>(`[data-sid="${CSS.escape(p.sentenceId)}"]`)
    if (!el) return
    const cr = container.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const absoluteTop = er.top - cr.top + container.scrollTop
    container.scrollTop = Math.max(0, absoluteTop - p.viewportRatio * container.clientHeight)
  }

  useEffect(() => {
    let cancelled = false
    void api.getReadingPosition(article.id).then((p) => {
      if (cancelled) return
      positionRef.current = p
      if (p) requestAnimationFrame(() => restore(p))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id])

  useEffect(() => {
    // Re-anchor after sidebar open/close or window resize reflows the text.
    const handler = () => { if (positionRef.current) requestAnimationFrame(() => restore(positionRef.current!)) }
    window.addEventListener('resize', handler)
    const raf = requestAnimationFrame(handler)
    return () => { window.removeEventListener('resize', handler); cancelAnimationFrame(raf) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.word-tool')) setWordTool(null)
      if (!target.closest('.sentence-tool')) setSentenceTool(null)
      if (!target.closest('.sentence-menu')) setSentenceMenu(null)
    }
    document.addEventListener('mousedown', onDocClick)
    // Middle-click auto-scroll must not fight the popover.
    const onAux = (e: globalThis.MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    document.addEventListener('auxclick', onAux, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('auxclick', onAux, true)
    }
  }, [])

  function handleScroll() {
    if (scrollTimer.current) window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => {
      const container = scrollRef.current
      if (!container) return
      const cr = container.getBoundingClientRect()
      let best: HTMLElement | null = null
      let bestDist = Infinity
      let bestRatio = 0
      container.querySelectorAll<HTMLElement>('[data-sid]').forEach((el) => {
        const er = el.getBoundingClientRect()
        if (er.bottom < cr.top - 20) return
        const d = Math.abs(er.top - cr.top)
        if (d < bestDist) {
          bestDist = d
          best = el
          bestRatio = Math.max(0, Math.min(1, (cr.top - er.top) / container.clientHeight))
        }
      })
      if (best && (best as HTMLElement).dataset.sid) {
        const p: ReadingPosition = {
          articleId: article.id,
          sentenceId: (best as HTMLElement).dataset.sid!,
          anchorOffset: Math.round(container.scrollTop),
          viewportRatio: bestRatio,
          updatedAt: new Date().toISOString(),
        }
        positionRef.current = p
        void api.saveReadingPosition(p)
      }
    }, 350)
  }

  /** Left-click word picking: resolve the DOM caret at the pointer position. */
  function wordAtPointer(x: number, y: number): string {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    let node: Node | null = null
    let offset = 0
    if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(x, y)
      if (range) {
        node = range.startContainer
        offset = range.startOffset
      }
    } else if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(x, y)
      if (pos) {
        node = pos.offsetNode
        offset = pos.offset
      }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return ''
    return extractWordAt(node.textContent ?? '', offset)
  }

  /** Selection still works as an optional convenience, left button only. */
  function handleSelectionEnd(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    if (!text || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!scrollRef.current?.contains(range.commonAncestorContainer)) return
    const rect = range.getBoundingClientRect()
    setWordTool({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 300)),
      y: Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - 300)),
      text: text.slice(0, 80),
    })
  }

  function handleReaderClick(e: ReactMouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    // Only a click on empty reading chrome closes the popover. A click that
    // ends a selection stays open even if it landed on a heading/paragraph.
    if (
      target === e.currentTarget ||
      target.classList.contains('reader-column') ||
      target.classList.contains('paragraph')
    ) {
      setWordTool(null)
    }
  }

  /** Left button = take the word under the pointer (or a drag-selected phrase). */
  function onSentenceClick(e: ReactMouseEvent) {
    const selected = window.getSelection()?.toString().trim() ?? ''
    const word = selected || wordAtPointer(e.clientX, e.clientY)
    if (!word) {
      setWordTool(null)
      return
    }
    setWordTool({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 320)),
      y: Math.max(8, Math.min(e.clientY + 12, window.innerHeight - 310)),
      text: word.slice(0, 80),
    })
  }

  /** Right button = lightweight translation popover (Shanbay-style).
   * Deliberately does NOT mark analysis as viewed: this only shows the meaning,
   * not the structure/targets, so training can still be credited as unaided. */
  function onSentenceContextMenu(e: ReactMouseEvent, s: Sentence) {
    e.preventDefault()
    e.stopPropagation()
    window.getSelection()?.removeAllRanges()
    setWordTool(null)
    setSentenceMenu(null)
    setSentenceTool({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 330)),
      y: Math.max(8, Math.min(e.clientY + 12, window.innerHeight - 200)),
      sentenceId: s.id,
      sentenceText: s.text,
      meaning: '',
      loading: true,
    })
    const ctx = contextOf(s)
    void api.getAnalysis({
      articleId: article.id,
      sentenceId: s.id,
      sentenceText: s.text,
      paragraphNo: s.paragraphNo,
      articleVersion: s.articleVersion,
      contextBefore: ctx.before,
      contextAfter: ctx.after,
    }).then((a) => {
      setSentenceTool((cur) =>
        cur?.sentenceId === s.id ? { ...cur, meaning: a.meaning, loading: false } : cur,
      )
    }).catch(() => {
      setSentenceTool((cur) =>
        cur?.sentenceId === s.id ? { ...cur, meaning: '暂无参考译文。', loading: false } : cur,
      )
    })
  }

  /** Middle button = the original three-choice action menu. */
  function onSentenceAuxClick(e: ReactMouseEvent, s: Sentence) {
    if (e.button !== 1) return
    e.preventDefault()
    e.stopPropagation()
    window.getSelection()?.removeAllRanges()
    setWordTool(null)
    setSentenceTool(null)
    setSentenceMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 250)),
      y: Math.max(8, Math.min(e.clientY + 10, window.innerHeight - 210)),
      sentence: s,
    })
  }

  /** Keyboard (Enter/Space) keeps the direct-analysis path for accessibility. */
  function onSentenceKey(e: ReactKeyboardEvent, s: Sentence) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    void openSidebar(s)
  }

  async function openSidebar(s: Sentence) {
    setWordTool(null)
    setSentenceTool(null)
    setSentenceMenu(null)
    setActiveSentenceId(s.id)
    setSidebarOpen(true)
    setAnalysis(null)
    setAnalysisLoading(true)
    const ctx = contextOf(s)
    try {
      const a = await api.getAnalysis({
        articleId: article.id,
        sentenceId: s.id,
        sentenceText: s.text,
        paragraphNo: s.paragraphNo,
        articleVersion: s.articleVersion,
        contextBefore: ctx.before,
        contextAfter: ctx.after,
      })
      setAnalysis(a)
      // Opening the analysis exposes the answer: record it in the append-only
      // exposure log so a later training attempt is attributed correctly.
      await api.markAnalysisViewed(article.id, s.id)
    } finally {
      setAnalysisLoading(false)
    }
  }

  async function startTraining(s: Sentence) {
    setSentenceMenu(null)
    const ctx = contextOf(s)
    const seen = await api.hasAnalysisBeenViewed(article.id, s.id)
    onStartTraining({ sentence: s, contextBefore: ctx.before, contextAfter: ctx.after, directAnalysisSeen: seen })
  }

  async function markLater(s: Sentence) {
    setSentenceMenu(null)
    await api.addMark({ articleId: article.id, sentenceId: s.id, sentenceText: s.text, note: '稍后复习' })
    onDataChanged()
    onToast('已加入「稍后复习」，并排入复测队列。')
  }

  return (
    <div className="reader-layout">
      <div className="reader-main">
        <div className="reader-toolbar">
          <button className="btn ghost sm" onClick={onBack}><Icon name="back" size={14} /> 文章库</button>
          <span className="title">{article.title}</span>
          <div className="right">
            <button className="btn sm" onClick={() => setSidebarOpen((v) => !v)}>
              <Icon name="eye" size={13} /> {sidebarOpen ? '收起解析' : '解析栏'}
            </button>
          </div>
        </div>

        <div
          className="reader-scroll"
          ref={scrollRef}
          onScroll={handleScroll}
          onMouseUp={handleSelectionEnd}
          onClick={handleReaderClick}
        >
          <div className="reader-column" style={{ '--reader-font-scale': fontScale } as CSSProperties}>
            <div className="article-heading">
              <h2>{article.title}</h2>
            </div>

            {paragraphs.map((p) => (
              <div className="paragraph" key={p.no}>
                <div>
                  {p.sentences.map((s) => (
                    <span
                      key={s.id}
                      data-sid={s.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`选择句子：${s.text}`}
                      className={[
                        'sentence',
                        activeSentenceId === s.id ? 'active' : '',
                        markedIds.has(s.id) ? 'marked' : '',
                        trainedIds.has(s.id) ? 'trained' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={(e) => onSentenceClick(e)}
                      onContextMenu={(e) => onSentenceContextMenu(e, s)}
                      onAuxClick={(e) => onSentenceAuxClick(e, s)}
                      onKeyDown={(e) => onSentenceKey(e, s)}
                    >
                      {s.text}{' '}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sidebarOpen && (
        <div className="analysis-sidebar">
          <div className="side-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3>直接解析</h3>
              <Badge tone="orange">答案已暴露</Badge>
            </div>
          </div>
          <div className="side-body">
            {analysisLoading && <div className="loading">正在生成结构解析…</div>}
            {!analysisLoading && !analysis && (
              <div className="empty">中键单击句子，或直接点工具栏「解析栏」</div>
            )}
            {analysis && activeSentenceId && (
              <>
                <div className="analysis-sentence">
                  {sentences.find((s) => s.id === activeSentenceId)?.text ?? ''}
                </div>
                <div className="analysis-block">
                  <h4>结构 / Structure</h4>
                  <div className="kv-row"><span className="kv-key">Subject</span><span>{analysis.skeleton.subject}</span></div>
                  <div className="kv-row"><span className="kv-key">Predicate</span><span>{analysis.skeleton.predicate}</span></div>
                  <div className="kv-row"><span className="kv-key">Object</span><span>{analysis.skeleton.object || '—'}</span></div>
                </div>

                <div className="analysis-block">
                  <h4>意群 / Chunks</h4>
                  {analysis.chunks.map((c, i) => (
                    <div className="chunk-row" key={i}>
                      <div className="ch-role">{c.role}</div>
                      <div className="ch-text">{c.text}</div>
                    </div>
                  ))}
                </div>

                <div className="analysis-block">
                  <h4>语义 / Meaning</h4>
                  <div className="small">{analysis.meaning}</div>
                </div>

                {analysis.phrases.length > 0 && (
                  <div className="analysis-block">
                    <h4>词组 / Phrases</h4>
                    {analysis.phrases.map((p, i) => (
                      <div className="kv-row" key={i}><span className="kv-key" style={{ flex: '0 0 100px' }}>{p.text}</span><span>{p.meaning}</span></div>
                    ))}
                  </div>
                )}

                <div className="analysis-block">
                  <h4>诊断目标 / Targets</h4>
                  {analysis.targets.map((t) => (
                    <div className="target-item" key={t.id}>
                      <div className="ti-head">
                        <Badge tone={t.weight === 'core' ? 'blue' : ''}>{t.category}</Badge>
                        {t.ambiguous && <Badge tone="purple">允许争议</Badge>}
                      </div>
                      <div className="ti-span">{t.originalSpan}</div>
                    </div>
                  ))}
                </div>

                {analysis.ambiguity && (
                  <div className="notice-box info"><strong>歧义提示：</strong>{analysis.ambiguity}</div>
                )}

                <div className="analysis-block">
                  <h4>可选追问 / Follow-ups</h4>
                  <ol className="layer-list">
                    {analysis.followUps.map((q, i) => <li key={i}>{q}</li>)}
                  </ol>
                </div>
              </>
            )}
          </div>
          <div className="side-footer side-actions">
            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={!activeSentenceId}
              onClick={() => {
                const s = sentences.find((x) => x.id === activeSentenceId)
                if (s) void startTraining(s)
              }}
            >
              <Icon name="focus" size={14} /> 进入引导训练
            </button>
            <button
              className="btn"
              style={{ width: '100%' }}
              disabled={!activeSentenceId}
              onClick={() => {
                const s = sentences.find((x) => x.id === activeSentenceId)
                if (s) void markLater(s)
              }}
            >
              <Icon name="clock" size={14} /> 稍后复习 · 排入复测
            </button>
            <button className="btn ghost" style={{ width: '100%' }} onClick={() => setSidebarOpen(false)}>收起解析栏</button>
          </div>
        </div>
      )}

      {wordTool && (() => {
        const result = lookupWord(wordTool.text)
        return (
          <div className="sentence-menu word-tool" style={{ left: wordTool.x, top: wordTool.y, width: 310 }}>
            <div className="menu-head">离线词典 · 左键取词</div>
            <div style={{ padding: '8px 12px 12px' }}>
              <div className="word-query">“{result.query}”</div>
              {result.found && result.entry ? (
                <>
                  {result.entry.phonetic && <div className="word-phonetic">/{result.entry.phonetic}/</div>}
                  <div className="word-translation">{result.entry.translation}</div>
                  {result.entry.tags.length > 0 && (
                    <div className="word-tags">
                      {result.entry.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}
                    </div>
                  )}
                  {result.entry.base && (
                    <div className="hint" style={{ marginTop: 8 }}>词形还原：{result.query} → {result.entry.base}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="hint">{result.note ?? '离线词库未收录该词。'}</div>
                  {result.suggestions.length > 0 && (
                    <div className="word-suggestions">
                      相近词：
                      {result.suggestions.map((s) => (
                        <button
                          key={s}
                          className="linklike"
                          onClick={() => setWordTool({ ...wordTool, text: s })}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {result.note && !result.entry?.base && result.found && (
                <div className="hint" style={{ marginTop: 8 }}>{result.note}</div>
              )}
            </div>
          </div>
        )
      })()}

      {sentenceTool && (
        <div className="sentence-tool" style={{ left: sentenceTool.x, top: sentenceTool.y }}>
          <div className="st-head">句子语义</div>
          <div className="st-sentence">{sentenceTool.sentenceText}</div>
          <div className="st-meaning">
            {sentenceTool.loading ? '正在获取语义…' : sentenceTool.meaning}
          </div>
          <div className="st-hint">中键点句展开完整解析与训练</div>
        </div>
      )}

      {sentenceMenu && (() => {
        const s = sentenceMenu.sentence
        return (
          <div className="sentence-menu sentence-action-menu" style={{ left: sentenceMenu.x, top: sentenceMenu.y }}>
            <div className="menu-head">句子操作</div>
            <button className="menu-item" onClick={() => void openSidebar(s)}>
              <span className="mi-icon">◎</span>
              <span><span className="mi-title">直接解析</span><br /><span className="mi-desc">查看结构、意群与完整译文（答案将标记为已暴露）</span></span>
            </button>
            <button className="menu-item" onClick={() => void startTraining(s)}>
              <span className="mi-icon">◇</span>
              <span><span className="mi-title">推导训练</span><br /><span className="mi-desc">用自己的中文表达理解，进入渐进式引导训练</span></span>
            </button>
            <button className="menu-item" onClick={() => void markLater(s)}>
              <span className="mi-icon">◷</span>
              <span><span className="mi-title">加入复测</span><br /><span className="mi-desc">排入稍后复习队列，稍后安排独立复测</span></span>
            </button>
          </div>
        )
      })()}
    </div>
  )
}
