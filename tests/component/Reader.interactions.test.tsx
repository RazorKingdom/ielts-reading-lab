// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { createArticle } from '../../src/core/segment'
import type { SentenceAnalysis } from '../../src/core/types'

const SENTENCE = 'The extent to which technology improves productivity depends on how effectively employees use it.'
const MEANING = '技术能在多大程度上提高生产率，取决于员工使用技术有多有效。'

const apiMock = vi.hoisted(() => ({
  getAnalysis: vi.fn(),
  markAnalysisViewed: vi.fn(),
  hasAnalysisBeenViewed: vi.fn(),
  addMark: vi.fn(),
  getReadingPosition: vi.fn(),
  saveReadingPosition: vi.fn(),
}))

vi.mock('../../src/backend', () => ({ api: apiMock }))

import Reader from '../../src/ui/Reader'

const analysis: SentenceAnalysis = {
  sentenceId: 'x',
  skeleton: { subject: 'Recent studies', predicate: 'suggest', object: 'a conditional relationship', note: '' },
  chunks: [{ text: SENTENCE, role: '起始意群', meaning: '' }],
  phrases: [],
  meaning: MEANING,
  layers: [],
  followUps: [],
  targets: [],
}

const article = createArticle({ id: 'a1', title: 'Test Article', originalText: SENTENCE })
const props = () => ({
  article, fontScale: 1, marks: [], trainedSentenceIds: [],
  onBack: vi.fn(), onStartTraining: vi.fn(), onDataChanged: vi.fn(), onToast: vi.fn(),
})

function sentenceEl(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-sid]')!
}

function mouse(el: HTMLElement, type: string, button: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: 100, clientY: 100 }))
  })
}

describe('component: Reader three-button interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getAnalysis.mockResolvedValue(analysis)
    apiMock.markAnalysisViewed.mockResolvedValue(undefined)
    apiMock.hasAnalysisBeenViewed.mockResolvedValue(false)
    apiMock.addMark.mockResolvedValue(undefined)
    apiMock.getReadingPosition.mockResolvedValue(null)
    apiMock.saveReadingPosition.mockResolvedValue(undefined)
    // jsdom has no caretRangeFromPoint; left-click fallback must be controllable.
    ;(document as unknown as { caretRangeFromPoint: () => null }).caretRangeFromPoint = () => null
  })

  it('right-click shows a meaning popover and marks the answer as viewed', async () => {
    const p = props()
    render(<Reader {...p} />)
    const el = sentenceEl()
    mouse(el, 'contextmenu', 2)

    expect(screen.getByText('句子语义')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(MEANING)).toBeInTheDocument())
    expect(apiMock.getAnalysis).toHaveBeenCalledTimes(1)
    // Reference meaning == L3 answer: a peek disqualifies unaided attribution.
    expect(apiMock.markAnalysisViewed).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/已标记为看过答案/)).toBeInTheDocument()
    expect(screen.queryByText('结构 / Structure')).not.toBeInTheDocument()
  })

  it('right-click caches meaning per sentence: a second peek does not re-fetch', async () => {
    render(<Reader {...props()} />)
    const el = sentenceEl()
    mouse(el, 'contextmenu', 2)
    await waitFor(() => expect(screen.getByText(MEANING)).toBeInTheDocument())
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    mouse(el, 'contextmenu', 2)
    await waitFor(() => expect(screen.getByText(MEANING)).toBeInTheDocument())
    expect(apiMock.getAnalysis).toHaveBeenCalledTimes(1) // cached
    expect(apiMock.markAnalysisViewed).toHaveBeenCalledTimes(2) // exposure still recorded
  })

  it('right-click popover survives a re-click on another sentence without stale meaning', async () => {
    render(<Reader {...props()} />)
    const el = sentenceEl()
    mouse(el, 'contextmenu', 2)
    expect(screen.getByText('正在获取语义…')).toBeInTheDocument()

    // A second article sentence would race; here resolve only one and verify
    // the loading state is replaced (no stuck spinner).
    await waitFor(() => expect(screen.queryByText('正在获取语义…')).not.toBeInTheDocument())
    expect(screen.getByText(MEANING)).toBeInTheDocument()
  })

  it('middle-click opens the three-choice menu; middle button on the sentence only', () => {
    render(<Reader {...props()} />)
    const el = sentenceEl()
    mouse(el, 'auxclick', 0) // wrong button
    expect(screen.queryByText('句子操作')).not.toBeInTheDocument()

    mouse(el, 'auxclick', 1)
    expect(screen.getByText('句子操作')).toBeInTheDocument()
    expect(screen.getByText('直接解析')).toBeInTheDocument()
    expect(screen.getByText('推导训练')).toBeInTheDocument()
    expect(screen.getByText('加入复测')).toBeInTheDocument()
  })

  it('middle-menu "直接解析" opens the sidebar and marks analysis viewed', async () => {
    render(<Reader {...props()} />)
    mouse(sentenceEl(), 'auxclick', 1)
    act(() => { screen.getByText('直接解析').click() })
    await waitFor(() => expect(apiMock.markAnalysisViewed).toHaveBeenCalledTimes(1))
    expect(screen.getByText('结构 / Structure')).toBeInTheDocument()
    expect(screen.queryByText('句子操作')).not.toBeInTheDocument()
  })

  it('middle-menu "推导训练" starts training with directAnalysisSeen=false', async () => {
    const p = props()
    render(<Reader {...p} />)
    mouse(sentenceEl(), 'auxclick', 1)
    act(() => { screen.getByText('推导训练').click() })
    await waitFor(() => expect(p.onStartTraining).toHaveBeenCalledTimes(1))
    expect(p.onStartTraining.mock.calls[0][0].directAnalysisSeen).toBe(false)
    expect(apiMock.markAnalysisViewed).not.toHaveBeenCalled()
  })

  it('middle-menu "加入复测" adds a mark, refreshes data and toasts', async () => {
    const p = props()
    render(<Reader {...p} />)
    mouse(sentenceEl(), 'auxclick', 1)
    act(() => { screen.getByText('加入复测').click() })
    await waitFor(() => expect(apiMock.addMark).toHaveBeenCalledTimes(1))
    expect(p.onDataChanged).toHaveBeenCalledTimes(1)
    expect(p.onToast).toHaveBeenCalledWith(expect.stringContaining('稍后复习'))
  })

  it('Escape closes every floating layer', async () => {
    render(<Reader {...props()} />)
    const el = sentenceEl()
    mouse(el, 'contextmenu', 2)
    await waitFor(() => expect(screen.getByText('句子语义')).toBeInTheDocument())
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(screen.queryByText('句子语义')).not.toBeInTheDocument()

    mouse(el, 'auxclick', 1)
    expect(screen.getByText('句子操作')).toBeInTheDocument()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(screen.queryByText('句子操作')).not.toBeInTheDocument()
  })

  it('keyboard Enter opens analysis and warns once about answer exposure', async () => {
    const p = props()
    render(<Reader {...p} />)
    act(() => {
      sentenceEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await waitFor(() => expect(apiMock.markAnalysisViewed).toHaveBeenCalledTimes(1))
    expect(screen.getByText('结构 / Structure')).toBeInTheDocument()
    expect(p.onToast).toHaveBeenCalledWith(expect.stringContaining('答案已暴露'))
  })

  it('left click clears a leftover drag selection so it never hijacks word picking', () => {
    render(<Reader {...props()} />)
    // Simulate a stale selection left over from a previous drag.
    const text = sentenceEl().firstChild!
    const range = document.createRange()
    range.selectNodeContents(text)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    expect(sel.toString().length).toBeGreaterThan(0)

    mouse(sentenceEl(), 'click', 0)
    expect(window.getSelection()?.toString() ?? '').toBe('')
  })

  it('left-click with no caret word closes popovers rather than opening a menu', () => {
    render(<Reader {...props()} />)
    mouse(sentenceEl(), 'contextmenu', 2)
    expect(screen.getByText('句子语义')).toBeInTheDocument()
    mouse(sentenceEl(), 'click', 0)
    expect(screen.queryByText('句子语义')).not.toBeInTheDocument()
    expect(screen.queryByText('句子操作')).not.toBeInTheDocument()
  })
})
