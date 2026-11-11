// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WrongWord } from '../../src/core/types'

const apiMock = vi.hoisted(() => ({
  listWrongWords: vi.fn(),
  removeWrongWord: vi.fn(),
}))

vi.mock('../../src/backend', () => ({ api: apiMock }))

import WrongWords from '../../src/ui/WrongWords'

const ROWS: WrongWord[] = [
  {
    id: 'ww-1', word: 'extent', query: 'extent', phonetic: 'ɪkˈstent',
    translation: 'n. 范围, 程度', tags: ['雅思'], found: true,
    createdAt: '2026-01-01T00:00:00.000Z', sentenceText: 'The extent to which technology improves productivity.',
  },
  {
    id: 'ww-2', word: 'run', query: 'ran', translation: 'v. 跑, 经营',
    tags: [], base: 'run', found: true, createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'ww-3', word: 'productivity', query: 'productivity', translation: 'n. 生产率',
    tags: [], found: true, createdAt: '2026-01-03T00:00:00.000Z',
  },
]

const props = () => ({ onDataChanged: vi.fn(), onToast: vi.fn() })

function columns() {
  return [
    document.querySelector<HTMLElement>('[data-column="1"]')!,
    document.querySelector<HTMLElement>('[data-column="2"]')!,
  ]
}

describe('component: wrong-word notebook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.listWrongWords.mockResolvedValue(ROWS.map((r) => ({ ...r })))
    apiMock.removeWrongWord.mockResolvedValue(undefined)
  })

  it('renders two vertical columns in reading order', async () => {
    render(<WrongWords {...props()} />)
    await waitFor(() => expect(screen.getByText('extent')).toBeInTheDocument())
    const [left, right] = columns()
    expect(within(left).getAllByRole('button')).toHaveLength(2)
    expect(within(right).getAllByRole('button')).toHaveLength(1)
    expect(within(left).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('extent'),
      expect.stringContaining('run'),
    ])
    expect(within(right).getByRole('button').textContent).toContain('productivity')
    expect(document.querySelectorAll('.ww-row')).toHaveLength(3)
  })

  it('shows the meaning only after clicking a word', async () => {
    render(<WrongWords {...props()} />)
    await waitFor(() => expect(screen.getByText('extent')).toBeInTheDocument())
    expect(document.querySelector('.ww-meaning')).toBeNull()
    expect(screen.getByText('点击左侧单词查看词义')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /extent/ }))
    const meaning = document.querySelector('.ww-meaning')
    expect(meaning?.textContent).toContain('范围')
    expect(screen.getByText('来源句子')).toBeInTheDocument()
    expect(screen.getByText(/The extent to which technology/)).toBeInTheDocument()
    expect(screen.getByText(/收录于 2026-01-01/)).toBeInTheDocument()
  })

  it('removing a selected word calls the API and drops the row', async () => {
    const p = props()
    render(<WrongWords {...p} />)
    await waitFor(() => expect(screen.getByText('extent')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /extent/ }))
    fireEvent.click(screen.getByRole('button', { name: /移除/ }))

    await waitFor(() => expect(apiMock.removeWrongWord).toHaveBeenCalledWith('ww-1'))
    await waitFor(() => expect(document.querySelectorAll('.ww-row')).toHaveLength(2))
    expect(p.onDataChanged).toHaveBeenCalledTimes(1)
    expect(p.onToast).toHaveBeenCalledWith(expect.stringContaining('extent'))
  })

  it('filters both columns by word or original query', async () => {
    render(<WrongWords {...props()} />)
    await waitFor(() => expect(screen.getByText('extent')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('筛选错词'), { target: { value: 'ran' } })
    expect(document.querySelectorAll('.ww-row')).toHaveLength(1)
    expect(screen.getByText('run')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('筛选错词'), { target: { value: 'nomatch' } })
    expect(screen.getByText(/没有匹配/)).toBeInTheDocument()
  })

  it('shows a clear empty state when nothing has been collected', async () => {
    apiMock.listWrongWords.mockResolvedValue([])
    render(<WrongWords {...props()} />)
    const empty = await waitFor(() => screen.getByText(/错词本还是空的/))
    expect(empty.textContent).toContain('添加错词本')
    expect(document.querySelector('.ww-columns')).toBeNull()
  })
})
