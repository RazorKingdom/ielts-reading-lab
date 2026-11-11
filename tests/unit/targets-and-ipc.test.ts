import { describe, expect, it } from 'vitest'
import { analyzeSentence, ruleIdFor, splitChunks, targetFingerprint } from '../../src/core/targets'
import { LAB_API_METHODS } from '../../electron/apiMethods'

describe('unit: target analysis primitives', () => {
  it('ruleIdFor distinguishes built-in sentence rules from the generic fallback', () => {
    expect(ruleIdFor('The extent to which technology improves productivity depends on how effectively employees use it.')).toBe('extent-depends')
    expect(ruleIdFor('Although resources are widely available, understanding depends on critical evaluation.')).toBe('concession')
    expect(ruleIdFor('Some entirely unrelated sentence about weather patterns.')).toBe('generic')
  })

  it('analyzeSentence always produces a verifiable core target and a skeleton', () => {
    const s = 'The policy, introduced last year, has not yet produced measurable results.'
    const a = analyzeSentence('x:s0', s)
    expect(a.sentenceId).toBe('x:s0')
    expect(a.targets.length).toBeGreaterThan(0)
    expect(a.targets.some((t) => t.weight === 'core')).toBe(true)
    for (const t of a.targets) {
      expect(s.includes(t.originalSpan)).toBe(true)
      expect(t.id.startsWith('x:s0')).toBe(true)
    }
    expect(a.skeleton.subject).toBeTruthy()
    expect(a.skeleton.predicate).toBeTruthy()
  })

  it('targetFingerprint is stable and category/span sensitive', () => {
    const [t] = analyzeSentence('x', 'Success depends less on speed than on accuracy.').targets
    expect(targetFingerprint(t)).toBe(targetFingerprint(t))
    expect(targetFingerprint({ ...t, category: '意群' })).not.toBe(targetFingerprint(t))
    expect(targetFingerprint({ ...t, originalSpan: 'other' })).not.toBe(targetFingerprint(t))
  })

  it('splitChunks covers the whole sentence with first/last role labels', () => {
    const s = 'First, the data were reweighted. Then, the ranking was compared across sites.'
    const parts = splitChunks(s)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].role).toBe('起始意群')
    expect(parts[parts.length - 1].role).toBe('收尾意群')
    for (const p of parts) expect(s.includes(p.text)).toBe(true)
  })
})

describe('unit: IPC whitelist', () => {
  it('exposes every method the renderer needs and no duplicates', () => {
    expect(new Set(LAB_API_METHODS).size).toBe(LAB_API_METHODS.length)
    const required = [
      'bootstrap', 'createArticle', 'deleteArticle', 'getAnalysis', 'markAnalysisViewed',
      'hasAnalysisBeenViewed', 'startSession', 'resumeSession', 'dispatch',
      'getApiConfig', 'setApiKey', 'setApiConfig', 'clearApiKey', 'testApiConnection',
      'exportData', 'deleteAllData',
    ]
    for (const m of required) expect(LAB_API_METHODS).toContain(m)
  })

  it('never exposes raw key material or arbitrary evaluation to the renderer', () => {
    // Writing/clearing a key is allowed (it goes into DPAPI in main); READING
    // the plaintext back is not — getApiConfig only returns a hasKey boolean.
    expect(LAB_API_METHODS).toContain('setApiKey')
    expect(LAB_API_METHODS).toContain('clearApiKey')
    expect(LAB_API_METHODS).not.toContain('getApiKey' as never)
    expect(LAB_API_METHODS.some((m) => /^(get|read)(secret|token|raw)/i.test(m))).toBe(false)
    expect(LAB_API_METHODS.some((m) => /eval|exec|require|fetch/i.test(m))).toBe(false)
  })
})
