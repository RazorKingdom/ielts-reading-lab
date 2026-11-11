import { describe, expect, it } from 'vitest'
import { makeRuntime, makeSessionInput, D01 } from '../helpers'
import { DEFAULT_API_CONFIG } from '../../src/core/runtime'

function start(h: ReturnType<typeof makeRuntime>['api']) {
  return h.startSession(makeSessionInput(D01))
}

describe('integration: dispatch guard branches', () => {
  it('SET_DRAFT persists text and EXIT keeps the session resumable', async () => {
    const { api, restart } = makeRuntime()
    const { session } = await start(api)
    await api.dispatch(session.id, { type: 'SET_DRAFT', text: '草稿内容' })
    let s = await api.dispatch(session.id, { type: 'EXIT' })
    expect(s.notice).toContain('已保存')
    const restored = await restart().resumeSession(session.id)
    expect(restored?.session.draft).toBe('草稿内容')
    expect(restored?.session.state).toBe('PREPARE')
  })

  it('SUBMIT with blank text creates no attempt', async () => {
    const { api } = makeRuntime()
    const { session } = await start(api)
    const s = await api.dispatch(session.id, { type: 'SUBMIT', text: '   ' })
    expect(s.notice).toContain('空内容不会创建')
    expect(s.attempts).toHaveLength(0)
  })

  it('SUBMIT is blocked after two attempts and during DIAGNOSE', async () => {
    const { api } = makeRuntime()
    const { session } = await start(api)
    await api.dispatch(session.id, { type: 'SUBMIT', text: '这取决于员工使用得有多有效。' })
    await api.dispatch(session.id, { type: 'SUBMIT', text: '第二次表达，仍取决于使用效果。' })
    const s = await api.dispatch(session.id, { type: 'SUBMIT', text: '第三次' })
    expect(s.notice).toContain('上限')
    expect(s.attempts).toHaveLength(2)
  })

  it('RETRY_DIAGNOSIS is rejected outside DIAGNOSE_FAILED state', async () => {
    const { api } = makeRuntime()
    const { session } = await start(api)
    const s = await api.dispatch(session.id, { type: 'RETRY_DIAGNOSIS' })
    expect(s.notice).toContain('不处于可重试状态')
    expect(s.attempts).toHaveLength(0)
  })

  it('REQUEST_HINT increments levels and unlocking L3 marks answer revealed', async () => {
    const { api } = makeRuntime()
    const { session } = await start(api)
    let s = await api.dispatch(session.id, { type: 'REQUEST_HINT' })
    expect(s.session.currentLevel).toBe(1)
    expect(s.notice).toContain('Level 1')
    s = await api.dispatch(session.id, { type: 'REQUEST_HINT' })
    expect(s.session.currentLevel).toBe(2)
    s = await api.dispatch(session.id, { type: 'REQUEST_HINT' })
    expect(s.session.currentLevel).toBe(3)
    expect(s.session.answerRevealed).toBe(true)
    expect(s.notice).toContain('不再计为独立正确')
  })

  it('UNLOCK_LEVEL3 with no attempts still writes an exposure feedback row', async () => {
    const { api } = makeRuntime()
    const { session } = await start(api)
    const s = await api.dispatch(session.id, { type: 'UNLOCK_LEVEL3' })
    expect(s.session.currentLevel).toBe(3)
    expect(s.feedback.some((f) => f.level === 3 && f.kind === 'full')).toBe(true)
  })

  it('DISPUTE with empty note uses a placeholder and never rewrites the diagnosis', async () => {
    const { api } = makeRuntime()
    const { session } = await start(api)
    await api.dispatch(session.id, { type: 'SUBMIT', text: '取决于员工使用效果。' })
    const before = await api.resumeSession(session.id)
    const beforeDiagnosis = before?.diagnosis
    const s = await api.dispatch(session.id, { type: 'DISPUTE', note: '   ' })
    expect(s.notice).toContain('有争议')
    expect(s.feedback.some((f) => f.content.includes('未填写理由'))).toBe(true)
    const after = await api.resumeSession(session.id)
    expect(after?.session.disputed).toBe(true)
    expect(after?.diagnosis).toEqual(beforeDiagnosis) // evidence untouched
  })
})

describe('integration: API configuration gate', () => {
  it('is disabled by default and refuses to enable without a key or model', async () => {
    const { api } = makeRuntime()
    const cfg = await api.getApiConfig()
    expect(cfg).toMatchObject(DEFAULT_API_CONFIG)
    await expect(api.setApiConfig({ enabled: true })).resolves.toMatchObject({ enabled: false })
    await api.setApiKey('sk-test')
    await expect(api.setApiConfig({ enabled: true, model: 'm' })).resolves.toMatchObject({ enabled: false })
  })

  it('enables only when key + cost + model + baseUrl are all present', async () => {
    const { api } = makeRuntime()
    await api.setApiKey('sk-test')
    const cfg = await api.setApiConfig({ enabled: true, costConfirmed: true, model: 'm', baseUrl: 'https://example.com/v1' })
    expect(cfg.enabled).toBe(true)
    expect(cfg.hasKey).toBe(true)
  })

  it('clearing the key automatically disables the configuration', async () => {
    const { api } = makeRuntime()
    await api.setApiKey('sk-test')
    await api.setApiConfig({ enabled: true, costConfirmed: true, model: 'm', baseUrl: 'https://example.com/v1' })
    const cfg = await api.clearApiKey()
    expect(cfg.enabled).toBe(false)
    expect(cfg.hasKey).toBe(false)
  })
})
