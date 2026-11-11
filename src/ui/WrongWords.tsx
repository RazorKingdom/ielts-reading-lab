import { useEffect, useMemo, useState } from 'react'
import type { WrongWord } from '../core/types'
import { lookupWord } from '../core/dictionary'
import { api } from '../backend'
import { Badge, Empty, formatDate, Icon } from './kit'

interface Props {
  onDataChanged: () => void
  onToast: (msg: string) => void
}

/**
 * Wrong-word notebook: two vertical columns of words on the left, a meaning
 * card on the right. Meanings come from the bundled offline dictionary, with
 * the snapshot saved at add-time as a fallback.
 */
export default function WrongWords({ onDataChanged, onToast }: Props) {
  const [words, setWords] = useState<WrongWord[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    void api.listWrongWords()
      .then(setWords)
      .catch((e) => {
        setWords([])
        onToast(`读取错词本失败：${e instanceof Error ? e.message : '未知错误'}`)
      })
  }, [onToast])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = words ?? []
    if (!q) return list
    return list.filter((w) => w.word.toLowerCase().includes(q) || w.query.toLowerCase().includes(q))
  }, [words, filter])

  // Split into two vertical columns in reading order (top half / bottom half).
  const half = Math.ceil(visible.length / 2)
  const columns = [visible.slice(0, half), visible.slice(half)]
  const selected = visible.find((w) => w.id === selectedId) ?? null

  // Re-query the bundled dictionary when a word is opened, so the definition
  // stays correct even if the dictionary data changes after the word was saved.
  const live = selected ? lookupWord(selected.query || selected.word) : null
  const meaning = live?.found && live.entry ? live.entry.translation : selected?.translation
  const phonetic = live?.entry?.phonetic ?? selected?.phonetic
  const tags = live?.entry?.tags ?? selected?.tags ?? []
  const base = live?.entry?.base ?? selected?.base

  async function remove(w: WrongWord) {
    try {
      await api.removeWrongWord(w.id)
      setWords((prev) => prev?.filter((x) => x.id !== w.id) ?? null)
      if (selectedId === w.id) setSelectedId(null)
      onDataChanged()
      onToast(`已从错词本移除「${w.word}」`)
    } catch (e) {
      onToast(`移除失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  return (
    <div className="content-scroll">
      <div className="content-inner">
        <div className="page-head">
          <div>
            <h2>错词本</h2>
            <p>阅读时左键点词，在词义卡里点「添加错词本」即可收录。点击左侧单词查看词义，数据保存在本机、完全离线。</p>
          </div>
          <div className="right"><Badge tone="blue">{words?.length ?? 0} 个错词</Badge></div>
        </div>

        <div className="ww-toolbar">
          <input
            className="ww-search"
            value={filter}
            placeholder="筛选单词…"
            aria-label="筛选错词"
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="hint">双栏列表 · 点击单词显示词义</span>
        </div>

        {words === null ? (
          <div className="loading">正在读取错词本…</div>
        ) : words.length === 0 ? (
          <div className="card card-pad">
            <Empty>
              错词本还是空的。去「阅读工作台」左键单击一个单词，
              在弹出的词义卡里点「添加错词本」。
            </Empty>
          </div>
        ) : visible.length === 0 ? (
          <div className="card card-pad"><Empty>没有匹配「{filter}」的错词。</Empty></div>
        ) : (
          <div className="ww-layout">
            <div className="ww-columns" data-testid="wrong-word-columns">
              {columns.map((column, i) => (
                <div className="ww-column" key={i} data-column={i + 1}>
                  {column.map((w) => (
                    <button
                      key={w.id}
                      className={`ww-row ${selectedId === w.id ? 'selected' : ''}`}
                      aria-pressed={selectedId === w.id}
                      onClick={() => setSelectedId(w.id)}
                    >
                      <span className="ww-word">{w.word}</span>
                      {w.phonetic && <span className="ww-phonetic">/{w.phonetic}/</span>}
                      <Icon name="arrow" size={13} />
                    </button>
                  ))}
                </div>
              ))}
            </div>

            <div className="ww-detail card card-pad">
              {selected ? (
                <>
                  <div className="ww-detail-head">
                    <div>
                      <div className="ww-detail-word">{selected.word}</div>
                      {phonetic && <div className="word-phonetic">/{phonetic}/</div>}
                    </div>
                    <button className="btn sm danger" onClick={() => void remove(selected)}>
                      <Icon name="trash" size={12} /> 移除
                    </button>
                  </div>

                  <div className="section-title" style={{ marginTop: 16 }}>词义</div>
                  <div className="ww-meaning">{meaning}</div>
                  {!selected.found && !live?.found && (
                    <div className="hint" style={{ marginTop: 8 }}>
                      离线词库未收录该词，可在阅读时结合上下文自行补记。
                    </div>
                  )}

                  {tags.length > 0 && (
                    <div className="word-tags">
                      {tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}
                    </div>
                  )}
                  {(base || selected.query.toLowerCase() !== selected.word.toLowerCase()) && (
                    <div className="hint" style={{ marginTop: 10 }}>
                      取词原文：{selected.query}{base ? ` → 原形 ${base}` : ''}
                    </div>
                  )}

                  {selected.sentenceText && (
                    <>
                      <div className="section-title" style={{ marginTop: 18 }}>来源句子</div>
                      <div className="ww-context">{selected.sentenceText}</div>
                    </>
                  )}

                  <div className="hint" style={{ marginTop: 16 }}>
                    收录于 {formatDate(selected.createdAt)} · 本地离线词库，无网络请求
                  </div>
                </>
              ) : (
                <div className="ww-detail-empty">
                  <Icon name="spark" size={22} />
                  <div className="section-title" style={{ marginTop: 12 }}>点击左侧单词查看词义</div>
                  <div className="hint">这里会显示音标、中文释义、词形还原与当时的来源句子。</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
