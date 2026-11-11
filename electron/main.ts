import { app, BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import { openDatabase, createSqliteStore } from './db'
import { createRuntime } from '../src/core/runtime'
import type { LabAPI } from '../src/core/runtime'
import { createProvider } from '../src/core/diagnose'
import { OpenAICompatibleProvider } from '../src/core/apiProvider'
import type { AIProvider } from '../src/core/types'
import { LAB_API_METHODS } from './apiMethods'

let api: LabAPI | null = null
let dbPath = ''
let mainWindow: BrowserWindow | null = null

const DEV_URL = 'http://127.0.0.1:5173'

async function createWindow(): Promise<void> {
  dbPath = await openDatabase()
  // Provider construction stays in the main process: the encrypted key is read
  // here and never crosses the IPC boundary to the renderer.
  const store = createSqliteStore()
  api = createRuntime({
    store,
    backendKind: 'electron-sqlite',
    providerFactory: async (id): Promise<AIProvider> => {
      if (id === 'third-party-api') {
        const cfg = await store.getApiConfig()
        const key = await store.getApiKey()
        return new OpenAICompatibleProvider({
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          apiKey: key ?? '',
        })
      }
      return createProvider(id)
    },
  })

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    title: 'IELTS Reading Lab',
    backgroundColor: '#f6f7f9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // External links go to the system browser, never into the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || url.startsWith(DEV_URL)
    if (!allowed) event.preventDefault()
  })

  if (process.env.LAB_DEV === '1') {
    await mainWindow.loadURL(DEV_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
  }
}

/** Single constrained IPC channel with an explicit method whitelist. */
ipcMain.handle('lab:invoke', async (_event, method: string, args: unknown[]) => {
  if (!LAB_API_METHODS.includes(method as keyof LabAPI)) {
    throw new Error(`IPC method not allowed: ${String(method)}`)
  }
  if (!api) throw new Error('Runtime is not ready')
  const fn = (api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]
  if (typeof fn !== 'function') throw new Error(`Unknown method: ${String(method)}`)
  try {
    return await fn(...(args ?? []))
  } catch (err) {
    // Never log credentials or learner answers; only the error class/message.
    console.error(`[lab] ${method} failed:`, err instanceof Error ? err.message : 'unknown error')
    throw err
  }
})

ipcMain.handle('lab:hostInfo', () => ({
  kind: 'electron',
  dbPath,
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  dev: process.env.LAB_DEV === '1',
}))

app.whenReady().then(async () => {
  await createWindow()
  // Optional offline health probe for packaged builds. Only active when
  // LAB_VERIFY=1, so normal users never see an extra file.
  if (process.env.LAB_VERIFY === '1' && mainWindow) {
    const writeProbe = (extra: Record<string, unknown> = {}) => {
      try {
        require('fs').writeFileSync(
          path.join(app.getPath('userData'), 'packaged-probe.json'),
          JSON.stringify({
            ok: true,
            at: new Date().toISOString(),
            dbPath,
            dbReady: require('fs').existsSync(dbPath),
            electron: process.versions.electron,
            resourcesPath: process.resourcesPath,
            ...extra,
          }, null, 2),
        )
      } catch { /* probe is best-effort */ }
    }
    // Write the main-process probe immediately; renderer check is best-effort.
    writeProbe({ rendered: 'pending' })
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
    try {
      const apiCount = await Promise.race([
        mainWindow.webContents.executeJavaScript(
          'typeof window.labAPI === "object" ? Object.keys(window.labAPI).length : 0',
        ),
        new Promise((_r, rej) => setTimeout(() => rej(new Error('renderer probe timeout')), 5000)),
      ])
      writeProbe({ apiCount, rendered: apiCount > 0 })
    } catch (e) {
      writeProbe({ rendered: false, error: e instanceof Error ? e.message : String(e) })
    }
    })()
  }
}).catch((err) => {
  console.error('[lab] startup failed:', err instanceof Error ? err.message : 'unknown error')
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})
