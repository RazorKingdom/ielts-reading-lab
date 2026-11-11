// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import type { AppSettings, ProviderCapability, ThirdPartyConfig } from '../../src/core/types'

const apiMock = vi.hoisted(() => ({
  getApiConfig: vi.fn(),
  setApiConfig: vi.fn(),
  setApiKey: vi.fn(),
  clearApiKey: vi.fn(),
  testApiConnection: vi.fn(),
  exportData: vi.fn(),
  deleteAllData: vi.fn(),
}))
vi.mock('../../src/backend', () => ({ api: apiMock }))

import SettingsView from '../../src/ui/Settings'

const cfg = (over: Partial<ThirdPartyConfig> = {}): ThirdPartyConfig => ({
  baseUrl: 'https://api.openai.com/v1', model: '', enabled: false,
  costConfirmed: false, hasKey: false, ...over,
})

const settings: AppSettings = {
  activeProviderId: 'mock-rules', theme: 'light', fontScale: 1,
  personalization: true, showModelMeta: true, sampleBankVersion: 2,
}
const providers: ProviderCapability[] = [{
  id: 'third-party-api', label: '第三方 API', kind: 'api', status: 'disabled',
  authentication: 'api-key', availableModels: [],
  streaming: false, cancellation: false, strictStructuredOutput: false,
  estimatedCost: '按服务商计费', errorTypes: [], note: '',
}]

function renderSettings() {
  const props = {
    settings, providers, hostInfo: null,
    onSettings: vi.fn().mockResolvedValue(undefined),
    onToast: vi.fn(), onDataChanged: vi.fn(),
  }
  render(<SettingsView {...props} />)
  return props
}

describe('component: Settings API configuration gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const initial = cfg()
    apiMock.getApiConfig.mockResolvedValue(initial)
    apiMock.setApiConfig.mockImplementation(async (patch) => ({ ...initial, ...patch }))
    apiMock.setApiKey.mockImplementation(async () => cfg({ hasKey: true }))
    apiMock.testApiConnection.mockResolvedValue({ ok: true, message: 'OK' })
  })

  it('renders the single third-party card and a disabled enable button', async () => {
    renderSettings()
    await waitFor(() => expect(apiMock.getApiConfig).toHaveBeenCalled())
    expect(screen.getAllByText('第三方 API（OpenAI 兼容）').length).toBeGreaterThan(0)
  })

  it('saving trims the URL and model before calling the API', async () => {
    renderSettings()
    await waitFor(() => expect(apiMock.getApiConfig).toHaveBeenCalled())
    const inputs = document.querySelectorAll<HTMLInputElement>('input')
    // The form order is Base URL, Model, API Key; set the first two.
    fireEvent.change(inputs[0], { target: { value: '  https://example.com/v1  ' } })
    fireEvent.change(inputs[1], { target: { value: '  deepseek-test  ' } })
    act(() => { screen.getByRole('button', { name: /保存配置/ }).click() })
    await waitFor(() => expect(apiMock.setApiConfig).toHaveBeenCalled())
    const saved = apiMock.setApiConfig.mock.calls[0][0]
    expect(saved.baseUrl).toBe('https://example.com/v1')
    expect(saved.model).toBe('deepseek-test')
  })

  it('test connection requires model name and refuses without cost confirmation', async () => {
    renderSettings()
    await waitFor(() => expect(apiMock.getApiConfig).toHaveBeenCalled())
    const btn = screen.getByRole('button', { name: /测试连接/ })
    expect(btn).toBeDisabled() // no model => cannot send a paid request
    fireEvent.change(document.querySelectorAll<HTMLInputElement>('input')[1], { target: { value: 'test-model' } })
    expect(btn).not.toBeDisabled()

    // Cost confirmation is unchecked: UI blocks before any request is sent.
    act(() => { btn.click() })
    await waitFor(() => expect(screen.getAllByText(/勾选费用确认/).length).toBeGreaterThan(0))
    expect(apiMock.testApiConnection).not.toHaveBeenCalled()
    expect(apiMock.setApiKey).not.toHaveBeenCalled() // no silent key draft save
  })

  it('testing never silently persists an unsaved API key draft', async () => {
    const withKey = cfg({ hasKey: true, costConfirmed: true, model: 'm' })
    apiMock.getApiConfig.mockResolvedValue(withKey)
    apiMock.setApiConfig.mockImplementation(async (patch) => ({ ...withKey, ...patch }))
    renderSettings()
    await waitFor(() => expect(apiMock.getApiConfig).toHaveBeenCalled())
    const keyInput = document.querySelectorAll<HTMLInputElement>('input')[2]
    fireEvent.change(keyInput, { target: { value: 'sk-draft-should-not-be-saved' } })
    act(() => { screen.getByRole('button', { name: /测试连接/ }).click() })
    await waitFor(() => expect(apiMock.testApiConnection).toHaveBeenCalledTimes(1))
    expect(apiMock.setApiKey).not.toHaveBeenCalled()
  })
})
