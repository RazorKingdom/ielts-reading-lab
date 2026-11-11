import { useEffect, useState } from 'react'
import type { FeedbackLevel, SessionSnapshot, TrainingIntent } from '../core/types'
import { api } from '../backend'
import { Badge, Icon, statusLabel, statusTone } from './kit'

interface Props {
  sessionId: string
  showModelMeta: boolean
  onReturn: () => void
  onRestart: () => void
  onDataChanged: () => void
}

function levelTone(level: FeedbackLevel, revealed: boolean): string {
  if (level >= 3 || revealed) return 'revealed'
  return 'current'
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export default function Focus({ sessionId, showModelMeta, onReturn, onRestart, onDataChanged }: Props) {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [transferDraft, setTransferDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [disputeNote, setDisputeNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void api.resumeSession(sessionId).then((s) => {
      if (cancelled || !s) return
      setSnap(s)
      setDraft(s.session.draft)
    })
    return () => { cancelled = true }
  }, [sessionId])

  // Draft persistence: survives closing the app mid-training (R05/E2E-03).
  useEffect(() => {
    if (!snap || draft === snap.session.draft) return
    const timer = window.setTimeout(() => {
      void api.dispatch(sessionId, { type: 'SET_DRAFT', text: draft }).then(setSnap)
    }, 650)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, sessionId])

  async function send(intent: TrainingIntent) {
    setBusy(true)
    setError(null)
    try {
      const next = await api.dispatch(sessionId, intent)
      setSnap(next)
      if (intent.type === 'SUBMIT') setDraft('')
      if (intent.type === 'SUBMIT_TRANSFER') setTransferDraft('')
      if (intent.type === 'DISPUTE') { setDisputeOpen(false); setDisputeNote('') }
      onDataChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  if (!snap) return <div className="loading">正在恢复训练现场…</div>

  const s = snap.session
  const intents = new Set(snap.availableIntents)
  const can = (t: TrainingIntent['type']) => intents.has(t) && !busy
  const diagnosis = snap.diagnosis

  return (
    <div className="focus-page">
      <div className="focus-top">
        <button className="btn ghost sm" onClick={onReturn}><Icon name="back" size={14} /> 返回阅读</button>
        <span className="title" style={{ fontWeight: 620, fontSize: 13 }}>引导训练</span>
        <Badge tone={s.answerRevealed ? 'orange' : 'green'}>
          Level {s.currentLevel}{s.answerRevealed ? ' · 答案已暴露' : ''}
        </Badge>
        {s.directAnalysisSeen && <Badge tone="orange">进入前已看解析</Badge>}
        {s.disputed && <Badge tone="purple">有争议 / 待复核</Badge>}
        <div className="right">
          {showModelMeta && (
            <span className="hint">
              {s.providerId === 'mock-rules' ? '本地保守判定（未连接 API）' : `${s.providerId} · ${s.modelId}`}
            </span>
          )}
          <button className="btn sm ghost" title="放弃当前恢复现场，重新开一轮（历史 session 仍保留）" onClick={onRestart}>
            重新开始本句
          </button>
        </div>
      </div>

      <div className="focus-body">
        <div className="focus-inner">
          {error && <div className="notice-box danger">{error}</div>}
          {snap.notice && <div className="notice-box info">{snap.notice}</div>}
          {snap.policyNote && (
            <div className="policy-box"><strong>应用策略裁决：</strong>{snap.policyNote}（模型输出仅为建议。）</div>
          )}
          {s.lastError && s.state === 'DIAGNOSE_FAILED' && (
            <div className="notice-box danger">
              诊断未完成，错误类别 <strong>{s.lastError}</strong>。你的回答已完整保存，未产生任何未经授权的费用。
              <button className="btn sm" style={{ marginLeft: 10 }} disabled={!can('RETRY_DIAGNOSIS')} onClick={() => void send({ type: 'RETRY_DIAGNOSIS' })}>
                重试诊断
              </button>
            </div>
          )}

          <div className="level-track">
            {([0, 1, 2, 3] as FeedbackLevel[]).map((l) => (
              <div key={l} className={`level-pill ${s.currentLevel === l ? levelTone(l, s.answerRevealed) : ''} ${l === 3 && s.answerRevealed ? 'revealed' : ''}`}>
                L{l} · {['无提示', '定位问题', '局部线索', '完整解析'][l]}
              </div>
            ))}
          </div>

          <div className="card focus-card">
            <div className="focus-label">原句 · 用中文自由写出你的理解</div>
            <div className="focus-sentence">{s.sentenceText}</div>
            {(s.contextBefore || s.contextAfter) && (
              <div className="focus-context">
                {s.contextBefore && <div><strong>上文：</strong>{s.contextBefore}</div>}
                {s.contextAfter && <div><strong>下文：</strong>{s.contextAfter}</div>}
              </div>
            )}

            {can('SUBMIT') && (
              <div className="answer-area">
                <textarea
                  value={draft}
                  disabled={busy}
                  placeholder={snap.attempts.length === 0
                    ? '用你自己的话写出这句话的意思（不必使用语法术语）…'
                    : '根据你的判断再表达一次；第一次回答已单独保存，不会被覆盖…'}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="answer-actions">
                  <span className="hint">
                    {snap.attempts.length === 0 ? '首次作答在发起诊断前入库，不可覆盖。' : '这是二次表达，单独保存。'}
                  </span>
                  <span className="spacer" />
                  <button className="btn primary" disabled={busy || !draft.trim()} onClick={() => void send({ type: 'SUBMIT', text: draft })}>
                    <Icon name="check" size={14} /> {snap.attempts.length === 0 ? '提交首次理解' : '提交二次表达'}
                  </button>
                </div>
              </div>
            )}

            {s.state === 'TRANSFER' && s.transfer && (
              <div className="answer-area">
                <div className="focus-label" style={{ marginTop: 8 }}>同技能新句 · 即时迁移</div>
                <div className="transfer-sentence">{s.transfer.sentence}</div>
                <textarea
                  style={{ marginTop: 14 }}
                  value={transferDraft}
                  disabled={busy}
                  placeholder="用中文写出这句的意思…"
                  onChange={(e) => setTransferDraft(e.target.value)}
                />
                {s.transfer.validationStatus === 'unscored' && (
                  <div className="notice-box" style={{ marginTop: 10 }}>
                    该题校验未通过（{s.transfer.validationIssues?.join('；')}），按规则<strong>不计分、不生成负面学习记录</strong>。
                  </div>
                )}
                <div className="answer-actions">
                  <span className="hint">参考含义在作答后显示；通过后另排延迟复测。</span>
                  <span className="spacer" />
                  <button className="btn" disabled={!can('SKIP_TRANSFER')} onClick={() => void send({ type: 'SKIP_TRANSFER' })}>跳过</button>
                  <button className="btn primary" disabled={busy || !transferDraft.trim()} onClick={() => void send({ type: 'SUBMIT_TRANSFER', text: transferDraft })}>
                    提交迁移作答
                  </button>
                </div>
              </div>
            )}

            {s.state === 'COMPLETE' && (
              <div className="notice-box info" style={{ marginTop: 20 }}>
                本轮已结束。
                {s.transferAttempt ? `即时迁移表现：${s.transferAttempt.result}；${s.transferAttempt.rationale}` : ''}
                <button className="btn sm primary" style={{ marginLeft: 10 }} onClick={onReturn}>返回阅读</button>
              </div>
            )}
          </div>

          {/* Progressive feedback timeline */}
          {snap.feedback.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="section-title">渐进反馈（含提示暴露记录）</div>
              {snap.feedback.map((f) => (
                <div className={`feedback-item l${f.level}`} key={f.id}>
                  <div className="fb-head">
                    <Badge tone={f.level >= 3 ? 'orange' : f.level === 0 ? 'green' : 'blue'}>Level {f.level}</Badge>
                    <span className="hint">{f.kind} · {timeLabel(f.exposedAt)}</span>
                  </div>
                  <div className="fb-content">{f.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Evidence-driven diagnosis */}
          {diagnosis && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div className="section-title" style={{ margin: 0 }}>逐项目标判断与证据</div>
                <Badge tone="green">Validator 通过</Badge>
                <Badge tone="blue">{statusLabel(diagnosis.suggestedAction)}（模型建议）</Badge>
                <span className="hint" style={{ marginLeft: 'auto' }}>
                  {diagnosis.providerId === 'mock-rules'
                    ? '本地保守判定（未连接 API）'
                    : `${diagnosis.providerId} / ${diagnosis.modelId}`} · {diagnosis.policyVersion}
                </span>
              </div>
              <div className="small muted" style={{ marginBottom: 12 }}>{diagnosis.summary}</div>
              <table className="evidence-table">
                <thead>
                  <tr><th style={{ width: 92 }}>判定</th><th style={{ width: '28%' }}>原文片段</th><th style={{ width: '22%' }}>回答证据</th><th>判断理由</th></tr>
                </thead>
                <tbody>
                  {diagnosis.evidences.map((e) => (
                    <tr key={e.targetId}>
                      <td><Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge></td>
                      <td className="quote">{e.originalSpan}</td>
                      <td>{e.answerQuote ? `「${e.answerQuote}」` : <span className="hint">（无 · 证据不足）</span>}</td>
                      <td className="small muted">{e.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hint" style={{ marginTop: 10 }}>
                规则：只有与原意直接冲突且能引用你回答中的原话，才判「明确错误」；缺少语法术语、合理简化、证据不足均不判错。争议项不更新长期能力记录。
              </div>
            </div>
          )}

          {/* Append-only attempts */}
          {snap.attempts.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="section-title">作答记录（append-only，首次答案不可覆盖）</div>
              {snap.attempts.map((a) => (
                <div className="attempt-row" key={a.id}>
                  <span className="seq">#{a.sequence} · {timeLabel(a.submittedAt)}</span>
                  <span style={{ flex: 1 }}>{a.userText}</span>
                  <Badge tone={a.exposureSnapshot.answerRevealed ? 'orange' : 'green'}>
                    L{a.exposureSnapshot.level}{a.exposureSnapshot.answerRevealed ? ' 已暴露' : ' 独立'}
                  </Badge>
                  {a.exposureSnapshot.directAnalysisSeen && <Badge tone="orange">已看解析</Badge>}
                </div>
              ))}
            </div>
          )}

          {/* Decisions */}
          {snap.decisions.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="section-title">教学决策（应用状态机最终裁决）</div>
              {snap.decisions.map((d, i) => (
                <div className="attempt-row" key={d.id}>
                  <span className="seq">#{i + 1}</span>
                  <Badge tone="blue">{statusLabel(d.action)}</Badge>
                  <span className="small muted">{d.reasonCodes.join(' · ')}</span>
                  <span className="hint" style={{ marginLeft: 'auto' }}>{d.policyVersion}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action bar */}
          <div className="card card-pad">
            <div className="section-title">你可以随时决定下一步</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {can('REQUEST_HINT') && (
                <button className="btn" disabled={busy} onClick={() => void send({ type: 'REQUEST_HINT' })}>
                  <Icon name="spark" size={14} /> 给一点更具体的提示（L{s.currentLevel + 1}）
                </button>
              )}
              {can('UNLOCK_LEVEL3') && !s.answerRevealed && (
                <button className="btn" disabled={busy} onClick={() => void send({ type: 'UNLOCK_LEVEL3' })}>
                  <Icon name="eye" size={14} /> 查看完整解析（L3）
                </button>
              )}
              {can('ACCEPT_TRANSFER') && (
                <button className="btn primary" disabled={busy} onClick={() => void send({ type: 'ACCEPT_TRANSFER' })}>
                  <Icon name="arrow" size={14} /> 做一道同技能新句
                </button>
              )}
              {can('SKIP_TRANSFER') && s.state !== 'TRANSFER' && s.state !== 'COMPLETE' && (
                <button className="btn" disabled={busy} onClick={() => void send({ type: 'SKIP_TRANSFER' })}>结束本轮</button>
              )}
              {can('DISPUTE') && (
                <button className="btn" disabled={busy} onClick={() => setDisputeOpen((v) => !v)}>
                  <Icon name="flag" size={14} /> 质疑这个结论
                </button>
              )}
              <button className="btn ghost" disabled={busy} onClick={() => void send({ type: 'EXIT' }).then(onReturn)}>
                <Icon name="back" size={14} /> 退出并返回阅读
              </button>
            </div>
            {disputeOpen && (
              <div className="dispute-input">
                <input
                  type="text"
                  value={disputeNote}
                  placeholder="说明你认为判断不当的地方（旧记录不会被修改，仅追加争议标记）"
                  onChange={(e) => setDisputeNote(e.target.value)}
                />
                <button className="btn primary" disabled={busy} onClick={() => void send({ type: 'DISPUTE', note: disputeNote })}>提交质疑</button>
              </div>
            )}
            <div className="hint" style={{ marginTop: 12 }}>
              默认上限：自动澄清 ≤1、原句二次表达 ≤1、新句迁移 ≤1。用户可随时停止；退出后草稿、阶段、提示等级、阅读锚点全部保留。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
