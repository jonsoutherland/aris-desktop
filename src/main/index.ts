import { app, BrowserWindow, ipcMain, dialog, shell, Notification } from 'electron'
import { join } from 'path'
import { initDb, getDb } from './db'

let lockInActive = false
let allowNextBlur = false
let lastExitAttemptMs = 0

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#181d27',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // needed to load local PDF files
    },
  })

  win.on('blur', () => {
    if (!lockInActive) return
    if (allowNextBlur) {
      allowNextBlur = false
      return
    }
    const now = Date.now()
    if (now - lastExitAttemptMs < 600) return
    lastExitAttemptMs = now
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.restore()
        win.focus()
      }
    }, 80)
    win.webContents.send('window:exitAttempt')
  })

  win.on('leave-full-screen', () => {
    if (!lockInActive) return
    win.setFullScreen(true)
    win.webContents.send('window:exitAttempt')
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

function checkReminders(): void {
  const db = getDb()
  const now = Date.now()
  const nowDate = new Date()

  interface GoalRow {
    id: string
    source_title: string
    finish_by: number
    reminder_frequency: 'daily' | 'weekly'
    reminder_day: number | null
    reminder_time: string
    last_reminded_at: number | null
    current_page: number
    total_pages: number | null
  }

  const goals = db.prepare(`
    SELECT rg.id, rg.finish_by, rg.reminder_frequency, rg.reminder_day,
           rg.reminder_time, rg.last_reminded_at,
           ks.title as source_title, ks.current_page, ks.total_pages
    FROM reading_goals rg
    JOIN knowledge_sources ks ON ks.id = rg.source_id
    WHERE rg.reminder_frequency IS NOT NULL AND rg.reminder_time IS NOT NULL
      AND rg.finish_by > ?
  `).all(now) as GoalRow[]

  for (const goal of goals) {
    const lastAt = goal.last_reminded_at ?? 0
    const elapsed = now - lastAt
    const isDailyDue = goal.reminder_frequency === 'daily' && elapsed > 20 * 3600 * 1000
    const isWeeklyDue =
      goal.reminder_frequency === 'weekly' &&
      nowDate.getDay() === goal.reminder_day &&
      elapsed > 6 * 24 * 3600 * 1000

    if (isDailyDue || isWeeklyDue) {
      const daysLeft = Math.max(0, Math.ceil((goal.finish_by - now) / 86400000))
      const pagesLeft = goal.total_pages ? goal.total_pages - goal.current_page : null
      const body = pagesLeft != null
        ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left · ${pagesLeft} pages remaining`
        : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`
      new Notification({ title: `Reading: ${goal.source_title}`, body }).show()
      db.prepare('UPDATE reading_goals SET last_reminded_at = ? WHERE id = ?').run(now, goal.id)
    }
  }
}

app.whenReady().then(() => {
  initDb()
  createWindow()
  checkReminders()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'Documents', extensions: ['pdf', 'epub'] }],
    properties: ['openFile'],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('shell:openPath', (_e, path: string) => shell.openPath(path))

// Generic SQLite query handler
ipcMain.handle('db:run', (_e, sql: string, params: unknown[]) => {
  const db = getDb()
  return db.prepare(sql).run(...params)
})

ipcMain.handle('db:all', (_e, sql: string, params: unknown[]) => {
  const db = getDb()
  return db.prepare(sql).all(...params)
})

ipcMain.handle('db:get', (_e, sql: string, params: unknown[]) => {
  const db = getDb()
  return db.prepare(sql).get(...params)
})

// Window controls
ipcMain.handle('window:minimize', (e) =>
  BrowserWindow.fromWebContents(e.sender)?.minimize()
)
ipcMain.handle('window:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.handle('window:close', (e) =>
  BrowserWindow.fromWebContents(e.sender)?.close()
)

// Lock-in mode controls
ipcMain.handle('window:setFullscreen', (e, val: boolean) => {
  BrowserWindow.fromWebContents(e.sender)?.setFullScreen(val)
})
ipcMain.handle('window:setLockIn', (_e, active: boolean) => {
  lockInActive = active
  if (!active) allowNextBlur = false
})
ipcMain.handle('window:allowExit', () => {
  allowNextBlur = true
})
