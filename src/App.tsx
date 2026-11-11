import { useEffect, useState } from 'react'
import type { AppSettings, Article, Profile, ProviderCapability } from './core/types'
import { DEFAULT_SETTINGS } from './core/runtime'
import { api } from './backend'
import { Badge, Icon } from './ui/kit'
import Library from './ui/Library'
import Reader from './ui/Reader'
import type { TrainingRequest } from './ui/Reader'
import Focus from './ui/Focus'
import ProfileView from './ui/Profile'
import SettingsView from './ui/Settings'

type View = 'library' | 'reader' | 'focus' | 'profile' | 'settings'

interface HostInfo {
  kind: 'electron'
  dbPath: string
  electron: string
  node: string
  platform: string
  dev: boolean
}

const NAV: { key: View; label: string; icon: string }[] = [
  { key: 'library', label: '文章库', icon: 'library' },
  { key: 'reader', label: '阅读工作台', icon: 'reader' },
  { key: 'focus', label: '训练中心', icon: 'focus' },
  { key: 'profile', label: '学习档案', icon: 'profile' },
]

const TITLES: Record<View, { title: string; sub: string }> = {
  library: { title: '文章库', sub: '沉浸式阅读的起点' },
  reader: { title: '阅读工作台', sub: '' },
  focus: { title: '训练中心', sub: '' },
  profile: { title: '学习档案', sub: '定性表现与证据追溯' },
  settings: { title: '设置', sub: '模型连接 / 隐私 / 排版 / 数据' },
}

export default function App() {
  const [view, setView] = useState<View>('library')
  const [loading, setLoading] = useState(true)
  const [articles, setArticles] = useState<Article[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [providers, setProviders] = useState<ProviderCapability[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [activeArticle, setActiveArticle] = useState<Article | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [lastTrainingReq, setLastTrainingReq] = useState<TrainingRequest | null>(null)
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null)
  const [backendKind, setBackendKind] = useState<'electron-sqlite' | 'browser-localstorage'>('browser-localstorage')
  const [toast, setToast] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  async function refresh() {
    const boot = await api.bootstrap()
    setArticles(boot.articles)
    setSettings(boot.settings)
    setProviders(boot.providers)
    setProfile(boot.profile)
    setBackendKind(boot.backendKind)
  }

  useEffect(() => {
    void refresh()
      .then(() => setBootError(null))
      .catch((e) => setBootError(e instanceof Error ? e.message : '初始化失败'))
      .finally(() => setLoading(false))
    if (window.labHost) void window.labHost.getInfo().then(setHostInfo).catch(() => undefined)
  }, [])

  /** Run a write action with one consistent error channel. */
  async function runAsync(action: () => Promise<void>, failPrefix: string): Promise<void> {
    try {
      await action()
    } catch (e) {
      setToast(`${failPrefix}：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4600)
    return () => window.clearTimeout(t)
  }, [toast])

  function navigate(next: View) {
    if (next === 'reader' && !activeArticle) {
      setToast('请先在「文章库」打开一篇文章。')
      return
    }
    if (next === 'focus' && !sessionId) {
      setToast('请在阅读工作台里中键单击一个句子，从菜单选「推导训练」；或在解析栏底部点「进入引导训练」。')
      return
    }
    setView(next)
  }

  async function handleCreate(input: { title?: string; originalText: string }) {
    await runAsync(async () => {
      const a = await api.createArticle(input)
      await refresh()
      setActiveArticle(a)
      setView('reader')
    }, '导入文章失败')
  }

  async function handleDelete(id: string) {
    await runAsync(async () => {
      await api.deleteArticle(id)
      await refresh()
      if (activeArticle?.id === id) {
        setActiveArticle(null)
        setView('library')
      }
    }, '删除文章失败')
  }

  async function handleStartTraining(req: TrainingRequest) {
    setLastTrainingReq(req)
    const active = await api.findActiveSession(req.sentence.articleId, req.sentence.id)
    if (active) {
      setSessionId(active.id)
    } else {
      const snap = await api.startSession({
        articleId: req.sentence.articleId,
        sentenceId: req.sentence.id,
        sentenceText: req.sentence.text,
        paragraphNo: req.sentence.paragraphNo,
        articleVersion: req.sentence.articleVersion,
        contextBefore: req.contextBefore,
        contextAfter: req.contextAfter,
        directAnalysisSeen: req.directAnalysisSeen,
      })
      setSessionId(snap.session.id)
    }
    setView('focus')
  }

  async function handleRestart() {
    if (!lastTrainingReq) return
    const snap = await api.startSession({
      articleId: lastTrainingReq.sentence.articleId,
      sentenceId: lastTrainingReq.sentence.id,
      sentenceText: lastTrainingReq.sentence.text,
      paragraphNo: lastTrainingReq.sentence.paragraphNo,
      articleVersion: lastTrainingReq.sentence.articleVersion,
      contextBefore: lastTrainingReq.contextBefore,
      contextAfter: lastTrainingReq.contextAfter,
      directAnalysisSeen: lastTrainingReq.directAnalysisSeen,
    })
    setSessionId(snap.session.id)
    await refresh()
  }

  async function handleSettings(patch: Partial<AppSettings>) {
    const next = await api.setSettings(patch)
    setSettings(next)
  }

  if (loading) return <div className="loading">正在启动 IELTS Reading Lab…</div>
  if (bootError) {
    return (
      <div className="content-scroll">
        <div className="content-inner">
          <div className="notice-box danger">
            <strong>启动失败：{bootError}</strong>
            <div className="hint" style={{ marginTop: 6 }}>本地学习数据未被删除。请检查数据库文件权限后重试。</div>
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => {
            setLoading(true)
            void refresh().then(() => setBootError(null)).catch((e) => setBootError(e instanceof Error ? e.message : '重试失败')).finally(() => setLoading(false))
          }}>重试启动</button>
        </div>
      </div>
    )
  }

  const trainedSentenceIds = profile?.sessions.map((s) => s.sentenceId) ?? []
  const title = TITLES[view]

  return (
    <div className="app-shell">
      <nav className="sidebar-nav">
        <div className="brand">
          <div className="brand-mark">IR</div>
          <div>
            <div className="brand-name">IELTS Reading Lab</div>
            <div className="brand-sub">阅读 · 诊断 · 自适应训练</div>
          </div>
        </div>

        <div className="nav-group-label">工作区</div>
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${view === item.key ? 'active' : ''}`}
            onClick={() => navigate(item.key)}
          >
            <Icon name={item.icon} size={17} /> {item.label}
          </button>
        ))}

        <div className="nav-spacer" />
        <div className="host-chip">
          <span className="host-dot" />
          <strong>{backendKind === 'electron-sqlite' ? '本机 SQLite' : '浏览器预览'}</strong>
          <br />
          {backendKind === 'electron-sqlite'
            ? '数据保存在本机，离线可读'
            : 'localStorage · 非交付数据层'}
          <br />
          <span style={{ color: 'var(--text-3)' }}>
            {providers[0]?.status === 'available'
              ? `第三方 API · ${providers[0].availableModels[0] ?? '已连接'}`
              : '本地离线 · 未连接外部 API'}
          </span>
        </div>
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
          <Icon name="settings" size={17} /> 设置
        </button>
      </nav>

      <div className="main-area">
        {(view === 'library' || view === 'profile' || view === 'settings') && (
          <div className="topbar">
            <h1>{title.title}</h1>
            <span className="sub">{title.sub}</span>
            <div className="topbar-actions">
              <Badge tone="green">离线可用</Badge>
              <Badge tone="blue">¥0 费用</Badge>
            </div>
          </div>
        )}

        {view === 'library' && (
          <Library
            articles={articles}
            onOpen={(a) => { setActiveArticle(a); setView('reader') }}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onToast={setToast}
          />
        )}

        {view === 'reader' && activeArticle && (
          <Reader
            article={activeArticle}
            fontScale={settings.fontScale}
            marks={profile?.marks ?? []}
            trainedSentenceIds={trainedSentenceIds}
            onBack={() => setView('library')}
            onStartTraining={(req) => void handleStartTraining(req)}
            onDataChanged={() => void refresh()}
            onToast={setToast}
          />
        )}

        {view === 'focus' && sessionId && (
          <Focus
            sessionId={sessionId}
            showModelMeta={settings.showModelMeta}
            onReturn={() => setView('reader')}
            onRestart={() => void handleRestart()}
            onDataChanged={() => void refresh()}
          />
        )}

        {view === 'profile' && (
          <ProfileView profile={profile} onDataChanged={() => void refresh()} onToast={setToast} />
        )}

        {view === 'settings' && (
          <SettingsView
            settings={settings}
            providers={providers}
            hostInfo={hostInfo}
            onSettings={handleSettings}
            onToast={setToast}
            onDataChanged={() => void refresh()}
          />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
