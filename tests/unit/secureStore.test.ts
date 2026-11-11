// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Only Electron's safeStorage is mocked; the real filesystem is used via a
// real temp dir, so this tests the actual encrypt/decrypt/file lifecycle.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-securestore-'))
const state = vi.hoisted(() => ({
  available: true,
  encryptionThrows: false,
  decryptThrows: false,
}))

vi.mock('electron', () => ({
  app: { getPath: () => (globalThis as unknown as { __LAB_TEST_USERDATA__: string }).__LAB_TEST_USERDATA__ },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (state.encryptionThrows) throw new Error('no secure store')
      return state.available
    },
    encryptString: (s: string) => Buffer.from('enc:' + [...s].reverse().join('')),
    decryptString: (b: Buffer) => {
      if (state.decryptThrows) throw new Error('corrupt')
      return [...b.toString().replace(/^enc:/, '')].reverse().join('')
    },
  },
}))

;(globalThis as unknown as { __LAB_TEST_USERDATA__: string }).__LAB_TEST_USERDATA__ = userData

type SecureStore = typeof import('../../electron/secureStore')
const credFile = path.join(userData, 'api-credential.bin')
const ENC_TEST = Buffer.from('enc:' + [...'sk-test-secret'].reverse().join(''))

// Fresh module per case: secureStore keeps a module-level `cached` key, so
// re-importing after resetModules is the only way to exercise the fs path.
async function freshStore(): Promise<SecureStore> {
  vi.resetModules()
  return import('../../electron/secureStore')
}

describe('unit: secureStore (DPAPI wrapper)', () => {
  beforeEach(() => {
    state.available = true
    state.encryptionThrows = false
    state.decryptThrows = false
    if (fs.existsSync(credFile)) fs.unlinkSync(credFile)
    fs.writeFileSync(credFile, ENC_TEST)
  })

  it('isSecureStorageAvailable reflects the OS capability', async () => {
    const store = await freshStore()
    expect(store.isSecureStorageAvailable()).toBe(true)
    state.available = false
    expect(store.isSecureStorageAvailable()).toBe(false)
    state.encryptionThrows = true
    expect(store.isSecureStorageAvailable()).toBe(false)
  })

  it('reads a stored key, then serves later reads from its cache', async () => {
    const store = await freshStore()
    expect(store.readApiKey()).toBe('sk-test-secret')
    fs.unlinkSync(credFile)
    expect(store.readApiKey()).toBe('sk-test-secret') // cache survives file removal
  })

  it('encrypts before writing so the file never holds the plaintext key', async () => {
    const store = await freshStore()
    store.writeApiKey('sk-new-secret')
    const raw = fs.readFileSync(credFile).toString()
    expect(raw).not.toContain('sk-new-secret')
    expect(raw).toContain('enc:')
    expect(store.readApiKey()).toBe('sk-new-secret')
  })

  it('refuses to persist in plaintext when OS encryption is unavailable', async () => {
    const store = await freshStore()
    state.available = false
    expect(() => store.writeApiKey('sk-secret')).toThrow(/拒绝以明文保存/)
    expect(fs.readFileSync(credFile).toString()).not.toContain('sk-secret')
  })

  it('refuses to persist when isEncryptionAvailable itself throws', async () => {
    const store = await freshStore()
    state.encryptionThrows = true
    expect(() => store.writeApiKey('sk-secret')).toThrow()
  })

  it('clearStoredApiKey deletes the encrypted file; later reads yield null', async () => {
    const store = await freshStore()
    store.clearStoredApiKey()
    expect(fs.existsSync(credFile)).toBe(false)
    expect(store.readApiKey()).toBeNull()
  })

  it('returns null when the credential file is missing', async () => {
    fs.unlinkSync(credFile)
    const store = await freshStore()
    expect(store.readApiKey()).toBeNull()
  })

  it('returns null (never throws) when decryption fails', async () => {
    state.decryptThrows = true
    const store = await freshStore()
    expect(() => store.readApiKey()).not.toThrow()
    expect(store.readApiKey()).toBeNull()
  })
})
