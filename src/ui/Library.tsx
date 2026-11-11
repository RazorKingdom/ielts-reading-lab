import { useState } from 'react'
import type { Article } from '../core/types'
import { splitParagraphs } from '../core/segment'
import { Badge, Empty, formatDate, Icon } from './kit'

interface Props {
  articles: Article[]
  onOpen: (a: Article) => void
  onCreate: (input: { title?: string; originalText: string }) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToast: (msg: string) => void
}

export default function Library({ articles, onOpen, onCreate, onDelete, onToast }: Props) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  const canImport = text.trim().length >= 40
  const q = query.trim().toLowerCase()
  const visible = q
    ? articles.filter((a) => `${a.title} ${a.originalText}`.toLowerCase().includes(q))
    : articles

  async function handleCreate() {
    if (!canImport) return
    setBusy(true)
    try {
      await onCreate({ title, originalText: text })
      setTitle('')
      setText('')
      onToast('文章已导入。段落与句子按原文切分，标点保持完整。')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(a: Article) {
    const ok = window.confirm(
      `确定删除《${a.title}》？\n\n这会移除文章及其阅读位置；训练会话与学习记录按 append-only 保留。建议先在「设置」中导出数据备份。`,
    )
    if (!ok) return
    await onDelete(a.id)
    onToast('文章已删除。')
  }

  return (
    <div className="content-scroll">
      <div className="content-inner">
        <div className="page-head">
          <div>
            <h2>文章库</h2>
            <p>内置 100 篇原创 IELTS 风格练习文本，也可粘贴自己的纯文本。阅读时左键点词查词，右键点句打开训练菜单。</p>
          </div>
          <div className="right">
            <Badge tone="blue">
              {visible.length === articles.length ? `${articles.length} 篇文章` : `${visible.length} / ${articles.length} 篇`}
            </Badge>
          </div>
        </div>

        <div className="grid-2">
          <div>
            <div className="section-title">我的文章</div>
            <input
              type="search"
              value={query}
              placeholder="搜索标题或正文关键词…"
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div className="article-list">
              {visible.length === 0 && (
                <div className="card">
                  <Empty>
                    {articles.length === 0
                      ? '还没有文章，先在右侧粘贴一篇。'
                      : `没有匹配「${query}」的文章，换个关键词试试。`}
                  </Empty>
                </div>
              )}
              {visible.map((a, i) => {
                const paragraphs = splitParagraphs(a.originalText)
                return (
                  <div className="card article-card" key={a.id}>
                    <div className="num">{String(i + 1).padStart(2, '0')}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3>{a.title}</h3>
                      <div className="meta">
                        {a.sourceType === 'sample' ? '内置示例' : '自行导入'} · {paragraphs.length} 段 ·{' '}
                        {formatDate(a.createdAt)} · 版本 {a.versionHash.slice(0, 8)}
                      </div>
                      <div className="excerpt">{a.originalText.replace(/\s+/g, ' ').slice(0, 160)}</div>
                    </div>
                    <div className="actions">
                      <button className="btn sm primary" onClick={() => onOpen(a)}>
                        <Icon name="reader" size={13} /> 阅读
                      </button>
                      <button className="btn sm ghost" title="删除文章" onClick={() => void handleDelete(a)}>
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <div className="section-title">导入新文章</div>
            <div className="card card-pad">
              <label className="field-label">标题（可选）</label>
              <input
                type="text"
                value={title}
                placeholder="例如：The Limits of Measurement"
                onChange={(e) => setTitle(e.target.value)}
                style={{ marginBottom: 16 }}
              />
              <label className="field-label">正文（纯文本粘贴）</label>
              <textarea
                value={text}
                rows={11}
                placeholder={'粘贴英文文章…\n\n空行分隔段落；句子按标点自动切分，不改动原文标点。'}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="hint" style={{ marginTop: 8 }}>
                {text.trim().length} 字符 · {splitParagraphs(text).length} 段
                {!canImport && text.length > 0 ? ' · 至少 40 字符' : ''}
              </div>
              <button
                className="btn primary lg"
                style={{ width: '100%', marginTop: 14 }}
                disabled={!canImport || busy}
                onClick={() => void handleCreate()}
              >
                <Icon name="plus" size={14} /> {busy ? '导入中…' : '导入并开始阅读'}
              </button>
              <div className="hint" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                文章内容一律作为不可信纯文本渲染，不执行其中的 HTML / 脚本。请只导入你有权使用的内容；内置 100 篇均为本项目原创 IELTS 风格练习文本（97 篇由确定性模板合成），<strong>不是官方真题，也不复制任何受版权保护的原文</strong>。前 3 篇含可精准诊断的重点句，其余以阅读与标记为主。
              </div>
            </div>

            <div className="card card-pad" style={{ marginTop: 14 }}>
              <div className="section-title">今日建议路径</div>
              <div className="small muted" style={{ lineHeight: 1.9 }}>
                1. 从内置 100 篇中选一篇（建议先试前 3 篇）<br />
                2. 右键单击一个长句打开解析，点解析栏底部「进入引导训练」<br />
                3. 用中文自由写出你的理解<br />
                4. 观察 Level 1 反馈如何不剧透<br />
                5. 需要时再解锁完整解析或迁移题
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
