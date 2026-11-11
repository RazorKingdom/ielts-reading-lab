import { describe, expect, it } from 'vitest'
import type { AIProvider, DiagnosisRequest, RawDiagnosis } from '../src/core/types'
import { analyzeSentence } from '../src/core/targets'
import { createProvider, ProviderError } from '../src/core/diagnose'
import {
  buildDiagnosisMessages,
  classifyHttpError,
  extractJsonObject,
  OpenAICompatibleProvider,
  parseDiagnosisResponse,
  THIRD_PARTY_CAPABILITY,
} from '../src/core/apiProvider'
import type { FetchLike, FetchResponseLike } from '../src/core/apiProvider'
import { makeRuntime, makeSessionInput, D01 } from './helpers'

const ANSWER = '技术提高生产率的程度取决于员工使用技术有多有效。'
const ANALYSIS = analyzeSentence('unit-sentence', D01)

function request(overrides: Partial<DiagnosisRequest> = {}): DiagnosisRequest {
  return {
    analysis: ANALYSIS,
    sentenceText: D01,
    attemptText: ANSWER,
    contextBefore: '',
    contextAfter: '',
    level: 0,
    attemptSequence: 1,
    ...overrides,
  }
}

function validRaw(req = request()): RawDiagnosis {
  return {
    evidences: req.analysis.targets.map((t) => ({
      targetId: t.id,
      status: 'correct' as const,
      originalSpan: t.originalSpan,
      answerQuote: ANSWER.slice(0, 8),
      rationale: '理解与原文一致。',
      suggestedAction: 'PASS' as const,
    })),
    summary: '核心关系理解正确。',
    suggestedAction: 'PASS',
  }
}

function reply(content: string, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : '{}',
  }
}

function captureFetch(content: string, status = 200) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return reply(content, status)
  }
  return { impl, calls }
}

describe('OpenAI-compatible request construction', () => {
  it('puts article text in the data payload and declares it untrusted', () => {
    const messages = buildDiagnosisMessages(request())
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toMatch(/untrusted content|DATA to be analysed/i)
    const payload = JSON.parse(messages[1].content) as Record<string, unknown>
    expect(payload.sentence).toBe(D01)
    expect(payload.learnerAnswer).toBe(ANSWER)
    expect(payload.untrustedDataWarning).toMatch(/data, not instructions/i)
    expect(Array.isArray(payload.targets)).toBe(true)
    // Credentials are never part of the prompt.
    expect(messages[1].content).not.toMatch(/sk-|Bearer|apiKey/i)
  })

  it('sends a bearer request to /chat/completions with the configured model', async () => {
    const { impl, calls } = captureFetch(JSON.stringify(validRaw()))
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1/',
      model: 'test-model',
      apiKey: 'sk-secret-123',
      fetchImpl: impl,
    })
    await provider.diagnose(request())
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://example.test/v1/chat/completions')
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-secret-123')
    const body = JSON.parse(calls[0].init.body) as Record<string, unknown>
    expect(body.model).toBe('test-model')
    expect(body.stream).toBe(false)
    // The key must not leak into the request body or any prompt.
    expect(calls[0].init.body).not.toContain('sk-secret-123')
  })
})

describe('diagnosis response parsing', () => {
  it('accepts a well-formed JSON result', () => {
    const raw = validRaw()
    const parsed = parseDiagnosisResponse(JSON.stringify(raw), {
      allowedTargetIds: ANALYSIS.targets.map((t) => t.id),
      sentence: D01,
      answer: ANSWER,
    })
    expect(parsed.evidences).toHaveLength(ANALYSIS.targets.length)
    expect(parsed.suggestedAction).toBe('PASS')
  })

  it('tolerates markdown fences and surrounding prose', () => {
    const raw = validRaw()
    const text = `Here is the result:\n\n\`\`\`json\n${JSON.stringify(raw)}\n\`\`\``
    expect(extractJsonObject(text)).toEqual(raw)
    expect(parseDiagnosisResponse(text, {
      allowedTargetIds: ANALYSIS.targets.map((t) => t.id), sentence: D01, answer: ANSWER,
    }).summary).toBe(raw.summary)
  })

  it('rejects unknown targets, fabricated spans and unquoted errors', () => {
    const base = { allowedTargetIds: ANALYSIS.targets.map((t) => t.id), sentence: D01, answer: ANSWER }
    const unknown = validRaw()
    unknown.evidences[0].targetId = 'does-not-exist'
    expect(() => parseDiagnosisResponse(JSON.stringify(unknown), base)).toThrow(ProviderError)

    const fake = validRaw()
    fake.evidences[0].originalSpan = 'this text never appears in the sentence'
    expect(() => parseDiagnosisResponse(JSON.stringify(fake), base)).toThrow(/原文片段/)

    const noEvidence = validRaw()
    noEvidence.evidences[0].status = 'incorrect'
    noEvidence.evidences[0].answerQuote = ''
    expect(() => parseDiagnosisResponse(JSON.stringify(noEvidence), base)).toThrow(/引用/)
  })

  it('classifies HTTP failures without echoing response bodies', async () => {
    expect(classifyHttpError(401)).toBe('TOKEN_EXPIRED')
    expect(classifyHttpError(403)).toBe('TOKEN_EXPIRED')
    expect(classifyHttpError(429)).toBe('QUOTA_EXCEEDED')
    expect(classifyHttpError(500)).toBe('NETWORK')
    expect(classifyHttpError(400)).toBe('INVALID_STRUCTURE')

    const { impl } = captureFetch('', 429)
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'sk-secret-123', fetchImpl: impl,
    })
    await expect(provider.diagnose(request())).rejects.toMatchObject({ errorKind: 'QUOTA_EXCEEDED' })
    await expect(provider.diagnose(request())).rejects.toThrow(/HTTP 429/)
  })

  it('testConnection reports success and failure without exposing credentials', async () => {
    const ok = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'sk-x',
      fetchImpl: captureFetch('OK').impl,
    })
    expect((await ok.testConnection()).ok).toBe(true)

    const bad = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'sk-x',
      fetchImpl: captureFetch('', 401).impl,
    })
    const result = await bad.testConnection()
    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('TOKEN_EXPIRED')
    expect(result.message).not.toContain('sk-x')
  })
})

describe('billing gate and credential handling in the runtime', () => {
  function fakeProvider(onCall: () => void): AIProvider {
    return {
      id: 'third-party-api',
      modelId: 'fake-model',
      capability: THIRD_PARTY_CAPABILITY,
      async diagnose(req) {
        onCall()
        return {
          evidences: req.analysis.targets.map((t) => ({
            targetId: t.id,
            status: 'correct' as const,
            originalSpan: t.originalSpan,
            answerQuote: req.attemptText.slice(0, 6),
            rationale: '与原文一致。',
            suggestedAction: 'PASS' as const,
          })),
          summary: '理解正确。',
          suggestedAction: 'PASS',
        }
      },
      async testConnection() {
        return { ok: true, message: 'ok', model: 'fake-model' }
      },
    }
  }

  function harness(onCall: () => void) {
    return makeRuntime({
      providerFactory: (id) => (id === 'third-party-api' ? fakeProvider(onCall) : createProvider(id)),
    })
  }

  it('never calls the external API until enabled with explicit cost confirmation', async () => {
    let calls = 0
    const { api } = harness(() => void calls++)
    await api.bootstrap()
    await api.setApiKey('sk-test-secret')
    await api.setApiConfig({ baseUrl: 'https://example.test/v1', model: 'fake-model', costConfirmed: true })

    const s1 = await api.startSession(makeSessionInput(D01))
    const r1 = await api.dispatch(s1.session.id, { type: 'SUBMIT', text: ANSWER })
    expect(calls).toBe(0)
    expect(r1.diagnosis?.providerId).not.toBe('third-party-api')

    const cfg = await api.setApiConfig({ enabled: true })
    expect(cfg.enabled).toBe(true)
    const s2 = await api.startSession(makeSessionInput(D01))
    const r2 = await api.dispatch(s2.session.id, { type: 'SUBMIT', text: ANSWER })
    expect(calls).toBe(1)
    expect(r2.diagnosis?.providerId).toBe('third-party-api')
    expect(r2.diagnosis?.modelId).toBe('fake-model')
    expect(r2.diagnosis?.validation.valid).toBe(true)
  })

  it('refuses to enable without cost confirmation, a key, a model and a URL', async () => {
    const { api } = harness(() => {})
    await api.bootstrap()
    expect((await api.setApiConfig({ enabled: true })).enabled).toBe(false)
    await api.setApiKey('k')
    await api.setApiConfig({ model: 'm', baseUrl: 'https://x.test/v1', costConfirmed: false })
    expect((await api.setApiConfig({ enabled: true })).enabled).toBe(false)
    await api.setApiConfig({ costConfirmed: true })
    expect((await api.setApiConfig({ enabled: true })).enabled).toBe(true)
  })

  it('never exports the key and disables the API when the key is cleared', async () => {
    const { api } = harness(() => {})
    await api.bootstrap()
    await api.setApiKey('sk-top-secret')
    expect((await api.getApiConfig()).hasKey).toBe(true)
    expect(await api.exportData()).not.toContain('sk-top-secret')
    const after = await api.clearApiKey()
    expect(after.hasKey).toBe(false)
    expect(after.enabled).toBe(false)
  })

  it('keeps the learner answer when the third-party request fails', async () => {
    const { api } = makeRuntime({
      providerFactory: (id) =>
        id === 'third-party-api'
          ? ({
              id: 'third-party-api', modelId: 'failing', capability: THIRD_PARTY_CAPABILITY,
              async diagnose(): Promise<RawDiagnosis> {
                throw new ProviderError('NETWORK', 'network down')
              },
            } as AIProvider)
          : createProvider(id),
    })
    await api.bootstrap()
    await api.setApiKey('k')
    await api.setApiConfig({ model: 'm', baseUrl: 'https://x.test/v1', costConfirmed: true, enabled: true })
    const s = await api.startSession(makeSessionInput(D01))
    const r = await api.dispatch(s.session.id, { type: 'SUBMIT', text: ANSWER })
    expect(r.session.state).toBe('DIAGNOSE_FAILED')
    expect(r.attempts).toHaveLength(1)
    expect(r.attempts[0].userText).toBe(ANSWER)
    expect(r.diagnosis).toBeUndefined()
  })
})
