import { contextBridge, ipcRenderer } from 'electron'
import type { LabAPI } from '../src/core/runtime'
import { LAB_API_METHODS } from './apiMethods'

/**
 * Minimal-privilege bridge. No fs, no ipcRenderer, no Node, no tokens are
 * exposed. Every call goes through a single whitelisted IPC channel.
 */
const api: Partial<LabAPI> = {}
for (const method of LAB_API_METHODS) {
  ;(api as Record<string, unknown>)[method] = (...args: unknown[]) =>
    ipcRenderer.invoke('lab:invoke', method, args)
}

contextBridge.exposeInMainWorld('labAPI', api)
contextBridge.exposeInMainWorld('labHost', {
  getInfo: () => ipcRenderer.invoke('lab:hostInfo'),
})
