import { useState } from 'react'
import type { Profile } from '../core/types'
import { api } from '../backend'
import { Badge, Empty, formatDate, Icon, statusLabel, statusTone } from './kit'

interface Props {
  profile: Profile | null
  onDataChanged: () => void
  onToast: (msg: string) => void
}

type Tab = 'observations' | 'reviews' | 'marks' | 'sessions'

export default function ProfileView({ profile, onDataChanged, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('observations')
  if (!profile) return <div className="loading">正在读取学习档案…</div>

  const st = profile.stats
  const cards = [
    { label: '训练轮次', value: st.totalSessions, foot: '每次训练单独成 session，互不覆盖' },
    { label: '首次独立正确', value: st.independentCorrect, foot: 'L0 且未看答案的核心目标' },
    { label: '提示后正确', value: st.assistedCorrect, foot: '含提示 / 已暴露答案，单独归因' },
    { label: '证据引用', value: st.evidenceCount, foot: '每条判断可追溯至作答原话' },
    { label: '待复测', value: st.pendingReviews, foot: '即时迁移与延迟复测分开存储' },
    { label: '有争议', value: st.disputed, foot: '不计入长期能力负面记录' },
    { label: '部分理解', value: st.partial, foot: '关键细节偏差，不判为不会' },
    { label: '迁移不计分', value: st.transferUnscored, foot: '歧义或校验失败的题不产生负面记录' },
  ]

  async function setReview(id: string, status: 'pending' | 'done' | 'skipped') {
    await api.updateReviewTask(id, status)
    onDataChanged()
    onToast('复测任务状态已更新。')
  }

  async function setMark(id: string, status: 'pending' | 'done') {
    await api.updateMark(id, status)
    onDataChanged()
    onToast('标记已更新。')
  }

  return (
    <div className="content-scroll">
      <div className="content-inner">
        <div className="page-head">
          <div>
            <h2>学习档案</h2>
            <p>以定性标签呈现表现，不提供未经校准的百分制掌握度。所有记录 append-only，可追溯、可质疑。</p>
          </div>
          <div className="right"><Badge tone="blue">{profile.observations.length} 条观察</Badge></div>
        </div>

        <div className="stat-grid">
          {cards.map((c) => (
            <div className="card stat-card" key={c.label}>
              <div className="label">{c.label}</div>
              <div className="value">{c.value}</div>
              <div className="foot">{c.foot}</div>
            </div>
          ))}
        </div>

        <div className="tabs">
          {([
            ['observations', '能力观察'],
            ['reviews', `复测队列 (${profile.reviewTasks.length})`],
            ['marks', `稍后复习 (${profile.marks.length})`],
            ['sessions', `训练会话 (${profile.sessions.length})`],
          ] as [Tab, string][]).map(([key, label]) => (
            <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        <div className="card card-pad">
          {tab === 'observations' && (
            <>
              <div className="section-title">逐目标观察（含提示暴露条件）</div>
              {profile.observations.length === 0 ? <Empty>还没有观察记录。去阅读工作台做一轮引导训练。</Empty> : (
                <table className="data-table">
                  <thead><tr><th>时间</th><th>技能点</th><th>结果</th><th>辅助等级</th><th>答案已暴露</th><th>证据</th></tr></thead>
                  <tbody>
                    {profile.observations.slice().reverse().slice(0, 60).map((o) => (
                      <tr key={o.id}>
                        <td className="tiny muted">{formatDate(o.timestamp)}</td>
                        <td>{o.category}</td>
                        <td><Badge tone={statusTone(o.result)}>{statusLabel(o.result)}</Badge></td>
                        <td>L{o.assistedLevel}</td>
                        <td>{o.answerRevealed ? <Badge tone="orange">是</Badge> : <Badge tone="green">否</Badge>}</td>
                        <td>{o.evidenceCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="hint" style={{ marginTop: 12 }}>
                同一 (session, target) 若后续解锁了完整解析，会追加新的观察行；统计以最新曝光条件为准，旧行仍保留可追溯。
              </div>
            </>
          )}

          {tab === 'reviews' && (
            <>
              <div className="section-title">延迟复测队列</div>
              {profile.reviewTasks.length === 0 ? <Empty>暂无复测任务。完成迁移题或标记「稍后复习」后会自动排期。</Empty> : (
                <table className="data-table">
                  <thead><tr><th>来源</th><th>句子</th><th>最早复测</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {profile.reviewTasks.map((r) => (
                      <tr key={r.id}>
                        <td><Badge tone={r.source === 'transfer' ? 'blue' : 'purple'}>{r.source === 'transfer' ? '迁移题' : '稍后复习'}</Badge></td>
                        <td style={{ maxWidth: 380 }}>{r.sentenceText}</td>
                        <td className="tiny">{formatDate(r.earliestDue)}</td>
                        <td><Badge tone={r.status === 'pending' ? 'yellow' : 'green'}>{r.status}</Badge></td>
                        <td>
                          {r.status === 'pending' && (
                            <button className="btn sm" onClick={() => void setReview(r.id, 'done')}>标记已复测</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {tab === 'marks' && (
            <>
              <div className="section-title">稍后复习的句子</div>
              {profile.marks.length === 0 ? <Empty>还没有标记。在阅读工作台中键单击句子，从菜单选「加入复测」。</Empty> : (
                <table className="data-table">
                  <thead><tr><th>标记时间</th><th>原句</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {profile.marks.map((m) => (
                      <tr key={m.id}>
                        <td className="tiny">{formatDate(m.createdAt)}</td>
                        <td style={{ maxWidth: 460 }}>{m.sentenceText}</td>
                        <td><Badge tone={m.status === 'pending' ? 'yellow' : 'green'}>{m.status === 'pending' ? '待复习' : '已完成'}</Badge></td>
                        <td>
                          {m.status === 'pending' && (
                            <button className="btn sm" onClick={() => void setMark(m.id, 'done')}>
                              <Icon name="check" size={12} /> 完成
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {tab === 'sessions' && (
            <>
              <div className="section-title">训练会话（绑定文章版本）</div>
              {profile.sessions.length === 0 ? <Empty>还没有训练会话。</Empty> : (
                <table className="data-table">
                  <thead><tr><th>开始时间</th><th>原句</th><th>状态</th><th>等级</th><th>作答</th><th>版本</th></tr></thead>
                  <tbody>
                    {profile.sessions.slice().reverse().map((s) => (
                      <tr key={s.id}>
                        <td className="tiny">{formatDate(s.startedAt)}</td>
                        <td style={{ maxWidth: 330 }}>{s.sentenceText}</td>
                        <td><Badge tone={s.state === 'COMPLETE' ? 'green' : 'blue'}>{s.state}</Badge></td>
                        <td>L{s.currentLevel}{s.answerRevealed ? ' · 已暴露' : ''}</td>
                        <td>{s.disputed ? <Badge tone="purple">有争议</Badge> : '—'}</td>
                        <td className="tiny muted">{s.articleVersion.slice(0, 8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="hint" style={{ marginTop: 12 }}>
                每个 session 绑定当时的 articleVersion；文章编辑后旧会话仍可追溯，不会被覆盖。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
