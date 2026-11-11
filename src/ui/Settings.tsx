import { useEffect, useState } from 'react'
import type { AppSettings, ProviderCapability, ThirdPartyConfig } from '../core/types'
import { api } from '../backend'
import { Badge, Icon } from './kit'

interface HostInfo {
  kind: 'electron'
  dbPath: string
  electron: string
  node: string
  platform: string
  dev: boolean
}

interface Props {
  settings: AppSettings
  providers: ProviderCapability[]
  hostInfo: HostInfo | null
  onSettings: (patch: Partial<AppSettings>) => Promise<void>
  onToast: (msg: string) => void
  onDataChanged: () => void
}

function downloadJson(content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ielts-reading-lab-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : '未知错误')

export default function SettingsView({ settings, providers, hostInfo, onSettings, onToast, onDataChanged }: Props) {
  const [config, setConfig] = useState<ThirdPartyConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [costConfirmed, setCostConfirmed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void api.getApiConfig().then((c) => {
      setConfig(c)
      setBaseUrl(c.baseUrl)
      setModel(c.model)
      setCostConfirmed(c.costConfirmed)
    }).catch((e) => setFeedback({ ok: false, text: errorMessage(e) }))
  }, [])

  const capability = providers[0]
  const enabled = Boolean(config?.enabled)
  const ready = Boolean(config?.hasKey && costConfirmed && model.trim() && baseUrl.trim())

  async function persistFields(): Promise<ThirdPartyConfig> {
    let c = await api.setApiConfig({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      costConfirmed,
    })
    if (keyInput.trim()) {
      c = await api.setApiKey(keyInput.trim())
      setKeyInput('')
    }
    return c
  }

  async function handleSave() {
    setBusy('save')
    setFeedback(null)
    try {
      const c = await persistFields()
      setConfig(c)
      setFeedback({ ok: true, text: '配置已保存。API Key 只存于主进程加密区，不会回显，也不会出现在导出数据里。' })
      onToast('第三方 API 配置已保存。')
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  async function handleTest() {
    if (!model.trim() || !baseUrl.trim()) {
      setFeedback({ ok: false, text: '请先填写 Base URL 与模型名。' })
      return
    }
    if (!costConfirmed) {
      setFeedback({ ok: false, text: '请先勾选费用确认：测试连接会发出一次真实且可能计费的请求。' })
      return
    }
    setBusy('test')
    setFeedback(null)
    try {
      // Persist config fields, but NEVER the unsubmitted key draft: testing
      // must not silently overwrite a saved key (P1-1).
      const saved = await api.setApiConfig({ baseUrl: baseUrl.trim(), model: model.trim(), costConfirmed: true })
      setConfig(saved)
      if (!saved.hasKey) {
        setFeedback({ ok: false, text: '请先点「保存配置」保存 API Key，再测试连接。' })
        return
      }
      const result = await api.testApiConnection()
      setFeedback({
        ok: result.ok,
        text: result.ok
          ? `连接成功（${result.model ?? model.trim()}）。${result.message}`
          : `连接失败：${result.message}${result.errorKind ? `（${result.errorKind}）` : ''}`,
      })
      setConfig(await api.getApiConfig())
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  async function handleToggle() {
    setBusy('toggle')
    setFeedback(null)
    try {
      if (enabled) {
        setConfig(await api.setApiConfig({ enabled: false }))
        onToast('已停用第三方 API；应用不会再发起外部请求。')
      } else {
        // Don't silently persist an unsaved key draft on enable (P1-1).
        if (keyInput.trim()) {
          setFeedback({ ok: false, text: '请先把填写的 API Key 点「保存配置」，再启用诊断。' })
          return
        }
        let c = await api.setApiConfig({
          baseUrl: baseUrl.trim(), model: model.trim(), costConfirmed,
        })
        c = await api.setApiConfig({ enabled: true })
        setConfig(c)
        if (c.enabled) onToast('已启用第三方 API 诊断。')
        else setFeedback({ ok: false, text: '启用被拒绝：必须同时具备费用确认、已保存的 API Key、模型名与 Base URL。' })
      }
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  async function handleClearKey() {
    if (!window.confirm('确定清除已保存的 API Key？这会同时停用第三方 API 诊断。')) return
    setBusy('clear')
    setFeedback(null)
    try {
      const c = await api.clearApiKey()
      setConfig(c)
      setKeyInput('')
      setFeedback({ ok: true, text: '已清除加密凭据并停用第三方 API。' })
      onToast('API Key 已清除。')
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  async function handleExport() {
    const data = await api.exportData()
    downloadJson(data)
    onToast('已导出全部本地数据（不含任何凭据）。')
  }

  async function handleDelete() {
    const ok = window.confirm(
      '确定删除全部本地学习数据？\n\n包含文章、阅读位置、训练会话、作答、诊断、观察、复测队列，以及已保存的 API Key。此操作不可撤销，建议先导出备份。',
    )
    if (!ok) return
    await api.deleteAllData()
    onDataChanged()
    onToast('本地数据已删除。内置文章会在下次启动时重新出现，第三方 API 需重新配置。')
  }

  return (
    <div className="content-scroll">
      <div className="content-inner">
        <div className="page-head">
          <div>
            <h2>设置</h2>
            <p>第三方 API 连接、阅读排版与本地数据。API Key 只在主进程加密处理，渲染进程取不到明文。</p>
          </div>
          <div className="right">
            <Badge tone={hostInfo ? 'green' : 'blue'}>
              {hostInfo ? 'Electron · SQLite' : '浏览器预览 · localStorage'}
            </Badge>
          </div>
        </div>

        <div className="grid-2">
          <div>
            <div className="section-title">第三方 API（OpenAI 兼容）</div>
            <div className="card card-pad">
              <div className="provider-head" style={{ marginBottom: 14 }}>
                <div>
                  <h3>{capability?.label ?? '第三方 API（OpenAI 兼容）'}</h3>
                  <div className="hint">通用 /chat/completions 接口 · 自填服务商、模型与密钥</div>
                </div>
                <div className="right" style={{ display: 'flex', gap: 6 }}>
                  <Badge tone={enabled ? 'green' : ''}>{enabled ? '已启用' : '未启用'}</Badge>
                  <Badge tone={config?.hasKey ? 'green' : 'orange'}>{config?.hasKey ? '密钥已保存' : '未配置密钥'}</Badge>
                </div>
              </div>

              <label className="field-label">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => setBaseUrl(e.target.value)}
                style={{ marginBottom: 14 }}
              />

              <label className="field-label">模型名</label>
              <input
                type="text"
                value={model}
                placeholder="例如 gpt-4o-mini、deepseek-chat、moonshot-v1-8k"
                onChange={(e) => setModel(e.target.value)}
                style={{ marginBottom: 14 }}
              />

              <label className="field-label">API Key</label>
              <input
                type="password"
                value={keyInput}
                autoComplete="off"
                placeholder={config?.hasKey ? '已加密保存（不回显）；输入新值可覆盖' : 'sk-…（仅在保存时提交一次）'}
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <div className="hint" style={{ marginTop: 6 }}>
                {hostInfo
                  ? '使用系统加密存储（Windows DPAPI）保存在本机；不会写入数据库、日志或导出文件。'
                  : '浏览器预览模式：密钥仅保存在当前页面的内存中，刷新即丢失；且跨域请求可能被服务商拦截，建议用桌面应用。'}
              </div>

              <label className="setting-row" style={{ marginTop: 16, cursor: 'pointer' }}>
                <div className="sr-main">
                  <div className="sr-title">费用确认</div>
                  <div className="sr-desc">我确认这是独立计费的第三方 API，与 ChatGPT 订阅账单无关，产生的费用由我承担</div>
                </div>
                <input type="checkbox" checked={costConfirmed} onChange={(e) => setCostConfirmed(e.target.checked)} />
              </label>

              {feedback && (
                <div className={`notice-box ${feedback.ok ? 'info' : 'danger'}`} style={{ marginTop: 12, marginBottom: 0 }}>
                  {feedback.text}
                </div>
              )}
              {config?.lastTest && (
                <div className="hint" style={{ marginTop: 10 }}>
                  上次连接测试：{config.lastTest.ok ? '成功' : '失败'} · {config.lastTest.at.slice(0, 19).replace('T', ' ')} · {config.lastTest.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                <button className="btn primary" disabled={busy !== null} onClick={() => void handleSave()}>
                  <Icon name="shield" size={13} /> {busy === 'save' ? '保存中…' : '保存配置'}
                </button>
                <button className="btn" disabled={busy !== null || !model.trim()} onClick={() => void handleTest()}>
                  {busy === 'test' ? '测试中…' : '测试连接'}
                </button>
                <button className="btn" disabled={busy !== null || !ready} onClick={() => void handleToggle()}>
                  {busy === 'toggle' ? '处理中…' : enabled ? '停用' : '启用诊断'}
                </button>
                <button className="btn ghost" disabled={busy !== null || !config?.hasKey} onClick={() => void handleClearKey()}>
                  <Icon name="trash" size={13} /> 清除密钥
                </button>
              </div>
              <div className="hint" style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                「测试连接」会向该服务商发送一次极小的真实请求，可能产生微量费用。启用后的每次训练诊断都会调用该 API，
                并按你的服务商标准计费；网络失败、额度不足或密钥失效时应用会明确报错并完整保留你的作答，
                <strong>不会自动重试、不会自动切换到其他计费来源</strong>。未启用时不会产生任何外部请求与费用。
              </div>
            </div>

            <div style={{ marginTop: 14 }} className="card card-pad">
              <div className="section-title">计费与凭据边界</div>
              <div className="small muted" style={{ lineHeight: 1.95 }}>
                <Icon name="shield" size={13} /> 这是<strong>独立计费的第三方 API</strong>，与 ChatGPT Plus/Pro 订阅、官方 SIWC 授权完全无关<br />
                <Icon name="shield" size={13} /> 必须由你主动填写密钥、勾选费用确认并点击「启用诊断」，应用才会发起请求<br />
                <Icon name="shield" size={13} /> 密钥只在 Electron 主进程解密使用，不进入渲染进程、日志、SQLite 记录或数据导出<br />
                <Icon name="shield" size={13} /> 文章内容与你的作答作为不可信数据发送，不执行其中出现的任何指令<br />
                <Icon name="shield" size={13} /> 模型输出必须逐项通过证据与结构校验，模型只提供建议，教学动作由应用裁决<br />
                <Icon name="shield" size={13} /> 「删除全部数据」会一并清除已加密保存的 API Key
              </div>
            </div>
          </div>

          <div>
            <div className="section-title">阅读与隐私</div>
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <div className="setting-row">
                <div className="sr-main">
                  <div className="sr-title">正文字号</div>
                  <div className="sr-desc">正文栏固定 680–780px，字号随此设置缩放</div>
                </div>
                <input
                  type="range"
                  min={0.85}
                  max={1.5}
                  step={0.05}
                  value={settings.fontScale}
                  onChange={(e) => void onSettings({ fontScale: Number(e.target.value) })}
                />
                <span className="small muted" style={{ width: 38, textAlign: 'right' }}>{settings.fontScale.toFixed(2)}×</span>
              </div>
              <div className="setting-row">
                <div className="sr-main">
                  <div className="sr-title">学习历史个性化 <Badge tone="purple">当前版本未启用</Badge></div>
                  <div className="sr-desc">诊断当前只使用本句上下文，不会附带任何历史观察；此开关预留给后续版本，现为只读。</div>
                </div>
                <input type="checkbox" checked={false} disabled aria-label="学习历史个性化（当前版本未启用）" />
              </div>
              <div className="setting-row">
                <div className="sr-main">
                  <div className="sr-title">显示 Provider / 模型标识</div>
                  <div className="sr-desc">训练结果与诊断表注明来源，便于追溯</div>
                </div>
                <input type="checkbox" checked={settings.showModelMeta} onChange={(e) => void onSettings({ showModelMeta: e.target.checked })} />
              </div>
              <div className="setting-row">
                <div className="sr-main">
                  <div className="sr-title">主题</div>
                  <div className="sr-desc">当前为浅色主题；深色主题为后续版本</div>
                </div>
                <Badge>light</Badge>
              </div>
            </div>

            <div className="section-title">本地数据</div>
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              {hostInfo ? (
                <>
                  <div className="kv-row"><span className="kv-key">后端</span><span>Electron 主进程 · SQLite（sql.js WASM）</span></div>
                  <div className="kv-row"><span className="kv-key">数据库</span><span style={{ wordBreak: 'break-all' }}>{hostInfo.dbPath}</span></div>
                  <div className="kv-row"><span className="kv-key">运行时</span><span>Electron {hostInfo.electron} / Node {hostInfo.node} / {hostInfo.platform}</span></div>
                </>
              ) : (
                <div className="notice-box info">
                  当前为<strong>浏览器预览后端</strong>：数据存于 localStorage，仅用于体验交互，不是交付形态的数据层。
                  运行 <code>npm run dev:electron</code> 使用真正的 SQLite 桌面应用。
                </div>
              )}
              <div className="hint" style={{ marginTop: 12 }}>
                默认本地存储；启用第三方 API 后，选中句子、邻近上下文与你的作答会发送给你所填的服务商。
                导出文件不包含 API Key。
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn" onClick={() => void handleExport()}><Icon name="download" size={14} /> 导出全部数据</button>
                <button className="btn danger" onClick={() => void handleDelete()}><Icon name="trash" size={14} /> 删除全部数据</button>
              </div>
            </div>

            <div className="card card-pad">
              <div className="section-title">安全边界</div>
              <div className="small muted" style={{ lineHeight: 1.9 }}>
                <Icon name="shield" size={13} /> contextIsolation 开启、nodeIntegration 关闭、最小权限 IPC 白名单<br />
                <Icon name="shield" size={13} /> 外来文章按不可信纯文本渲染，不执行 HTML / 脚本<br />
                <Icon name="shield" size={13} /> 首次作答在发起诊断请求前入库，失败 / 取消 / 断网均不丢失<br />
                <Icon name="shield" size={13} /> 第三方 API 需显式启用与费用确认，不自动切换计费来源<br />
                <Icon name="shield" size={13} /> 日志与导出仅含错误类别，不输出凭据或作答原文
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
