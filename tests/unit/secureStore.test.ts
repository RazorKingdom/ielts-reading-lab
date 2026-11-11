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
  encryptCalls: [] as string[],
  decryptCalls: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: () => (globalThis as unknown as { __LAB_TEST_USERDATA__: string }).__LAB_TEST_USERDATA__ },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (state.encryptionThrows) throw new Error('no secure store')
      return state.available
    },
    encryptString: (s: string) => {
      state.encryptCalls.push(s)
      return Buffer.from('enc:' + [...s].reverse().join(''))
    },
    decryptString: (b: Buffer) => {
      state.decryptCalls.push(b.toString())
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
    state.encryptCalls.length = 0
    state.decryptCalls.length = 0
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

  it('encrypts before writing and a fresh module can decrypt it back from disk', async () => {
    const store = await freshStore()
    store.writeApiKey('sk-new-secret')
    // The OS encryption function must actually be called with the plaintext.
    expect(state.encryptCalls).toContain('sk-new-secret')
    const onDisk = fs.readFileSync(credFile)
    expect(onDisk.toString()).not.toContain('sk-new-secret')
    // Bytes on disk must be exactly what encryptString returned (not a
    // plaintext fallback, not a differently-named file).
    expect(onDisk.equals(Buffer.from('enc:' + [...state.encryptCalls[0]].reverse().join('')))).toBe(true)
    state.decryptCalls.length = 0
    // A brand-new module has no cache: this read MUST hit the filesystem and
    // call decryptString to recover the original key.
    const fresh = await freshStore()
    expect(fresh.readApiKey()).toBe('sk-new-secret')
    expect(state.decryptCalls.length).toBe(1)
  })

  it('refuses to persist in plaintext when OS encryption is unavailable', async () => {
    const store = await freshStore()
    const before = fs.readFileSync(credFile)
    state.available = false
    expect(() => store.writeApiKey('sk-secret')).toThrow(/拒绝以明文保存/)
    // The file must be byte-for-byte untouched, and no encryption attempted.
    expect(fs.readFileSync(credFile).equals(before)).toBe(true)
    expect(state.encryptCalls).toHaveLength(0)
  })

  it('refuses to persist when isEncryptionAvailable itself throws', async () => {
    const store = await freshStore()
    const before = fs.readFileSync(credFile)
    state.encryptionThrows = true
    expect(() => store.writeApiKey('sk-secret')).toThrow()
    expect(fs.readFileSync(credFile).equals(before)).toBe(true)
    expect(state.encryptCalls).toHaveLength(0)
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
