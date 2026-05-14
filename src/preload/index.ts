import { contextBridge, ipcRenderer } from 'electron'

// Module-level callbacks for push events from main process
let exitAttemptCb: (() => void) | null = null

ipcRenderer.on('window:exitAttempt', () => exitAttemptCb?.())

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),

  db: {
    run: (sql: string, params: unknown[] = []) =>
      ipcRenderer.invoke('db:run', sql, params),
    all: (sql: string, params: unknown[] = []) =>
      ipcRenderer.invoke('db:all', sql, params),
    get: (sql: string, params: unknown[] = []) =>
      ipcRenderer.invoke('db:get', sql, params),
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setFullscreen: (val: boolean) => ipcRenderer.invoke('window:setFullscreen', val),
    setLockIn: (active: boolean) => ipcRenderer.invoke('window:setLockIn', active),
    allowExit: () => ipcRenderer.invoke('window:allowExit'),
    onExitAttempt: (cb: () => void) => { exitAttemptCb = cb },
    offExitAttempt: () => { exitAttemptCb = null },
  },
})
