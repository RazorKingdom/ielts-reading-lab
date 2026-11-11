import { createRuntime } from './core/runtime'
import type { LabAPI } from './core/runtime'
import { createProvider } from './core/diagnose'
import { OpenAICompatibleProvider } from './core/apiProvider'
import type { AIProvider } from './core/types'
import { createBrowserStore } from './store/browserStore'

/**
 * One interface, two backends:
 *  - Electron: preload-injected IPC -> main process -> SQLite + safeStorage
 *  - Browser preview: identical runtime, localStorage + in-memory key.
 * The browser fallback never persists credentials and is explicitly labelled
 * as a preview, not the shipping data layer. Cross-origin requests may be
 * blocked by the API provider's CORS policy; the desktop build has no such
 * restriction because the request originates in the main process.
 */
export function getBackend(): LabAPI {
  if (typeof window !== 'undefined' && window.labAPI) return window.labAPI
  const store = createBrowserStore()
  return createRuntime({
    store,
    backendKind: 'browser-localstorage',
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
}

export const api: LabAPI = getBackend()
