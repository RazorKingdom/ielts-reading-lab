import type { LabAPI } from './core/runtime'

interface HostInfo {
  kind: 'electron'
  dbPath: string
  electron: string
  node: string
  platform: string
  dev: boolean
}

declare global {
  interface Window {
    /** Injected only by the Electron preload via contextBridge. */
    labAPI?: LabAPI
    labHost?: { getInfo(): Promise<HostInfo> }
  }
}

export {}
