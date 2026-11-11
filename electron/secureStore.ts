import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * OS-backed credential storage for the user-supplied third-party API key.
 * Windows uses DPAPI through Electron's safeStorage. The plaintext key never
 * enters the renderer, logs, the SQLite records table, or data exports.
 * If OS encryption is unavailable we refuse to store it in plaintext.
 */
const FILE_NAME = 'api-credential.bin'

let cached: string | null | undefined

function credentialPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

export function isSecureStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function readApiKey(): string | null {
  if (cached !== undefined) return cached
  try {
    const file = credentialPath()
    if (!fs.existsSync(file) || !isSecureStorageAvailable()) {
      cached = null
      return null
    }
    cached = safeStorage.decryptString(fs.readFileSync(file))
    return cached
  } catch {
    // A corrupt/undecryptable file must never be silently replaced by plaintext.
    cached = null
    return null
  }
}

export function writeApiKey(key: string): void {
  if (!isSecureStorageAvailable()) {
    throw new Error('当前系统未提供可用的加密存储（safeStorage），拒绝以明文保存 API Key。')
  }
  const encrypted = safeStorage.encryptString(key)
  fs.writeFileSync(credentialPath(), encrypted, { mode: 0o600 })
  cached = key
}

export function clearStoredApiKey(): void {
  try {
    fs.unlinkSync(credentialPath())
  } catch {
    /* already absent */
  }
  cached = null
}
