const { app, BrowserWindow, clipboard, ipcMain } = require('electron/main')
const path = require('node:path')
const fs = require('node:fs/promises')
const WebSocket = require('ws')
const { evaluate, parseMessage, renderTemplate, resolveVariables } = require('./engine')

const sockets = new Map()
let mainWindow

const statePath = () => path.join(app.getPath('userData'), 'workspace.json')

const sendEvent = (connectionId, event) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('ws:event', {
    connectionId,
    at: new Date().toISOString(),
    ...event
  })
}

const contextFor = (entry, message) => ({
  message: message?.value,
  raw: message?.text,
  last: entry.history.at(-1)?.value,
  history: entry.history.map((item) => item.value),
  now: new Date().toISOString()
})

const sendPayload = (entry, payload, source = 'manual', message) => {
  if (entry.socket.readyState !== WebSocket.OPEN) throw new Error('Connection is not open')
  const rendered = renderTemplate(payload, contextFor(entry, message), entry.config.variables)
  entry.socket.send(rendered)
  sendEvent(entry.id, { type: 'outgoing', data: rendered, source, environment: entry.config.environmentName })
  return rendered
}

const runTriggers = (entry, message) => {
  for (const trigger of entry.config.triggers || []) {
    if (!trigger.enabled) continue
    try {
      const context = contextFor(entry, message)
      const vars = resolveVariables(entry.config.variables, context)
      if (!evaluate(trigger.condition || 'false', { ...context, vars })) continue
      const delay = Math.max(0, Number(trigger.delayMs) || 0)
      setTimeout(() => {
        try {
          sendPayload(entry, trigger.response, `trigger:${trigger.name || 'Untitled'}`, message)
        } catch (error) {
          sendEvent(entry.id, { type: 'error', data: error.message })
        }
      }, delay)
    } catch (error) {
      sendEvent(entry.id, { type: 'error', data: `Trigger "${trigger.name}": ${error.message}` })
    }
  }
}

const registerIpc = () => {
  ipcMain.handle('state:load', async () => {
    try {
      return JSON.parse(await fs.readFile(statePath(), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  })

  ipcMain.handle('state:save', async (_event, state) => {
    await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
    return true
  })

  ipcMain.handle('ws:connect', async (_event, config) => {
    const existing = sockets.get(config.id)
    if (existing) existing.socket.close()

    const baseContext = { message: null, raw: '', last: null, history: [], now: new Date().toISOString() }
    const url = renderTemplate(config.url, baseContext, config.variables)
    let headers = {}
    if (config.headers?.trim()) {
      const renderedHeaders = renderTemplate(config.headers, baseContext, config.variables)
      headers = JSON.parse(renderedHeaders)
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const socket = new WebSocket(url, { headers, handshakeTimeout: 10000 })
      const entry = { id: config.id, socket, config, history: [] }
      sockets.set(config.id, entry)

      socket.once('open', () => {
        settled = true
        sendEvent(config.id, { type: 'open', data: url })
        resolve(true)
      })
      socket.on('message', (data, isBinary) => {
        const parsed = parseMessage(data)
        entry.history.push(parsed)
        if (entry.history.length > 200) entry.history.shift()
        sendEvent(config.id, { type: 'incoming', data: parsed.text, isJson: parsed.isJson, isBinary, environment: entry.config.environmentName })
        runTriggers(entry, parsed)
      })
      socket.on('close', (code, reason) => {
        sendEvent(config.id, { type: 'close', data: `${code}${reason ? ` · ${reason}` : ''}` })
        if (sockets.get(config.id)?.socket === socket) sockets.delete(config.id)
      })
      socket.on('error', (error) => {
        sendEvent(config.id, { type: 'error', data: error.message })
        if (!settled) {
          settled = true
          reject(error)
        }
      })
    })
  })

  ipcMain.handle('ws:disconnect', (_event, id) => {
    const entry = sockets.get(id)
    if (!entry) return true
    sockets.delete(id)
    return new Promise((resolve) => {
      let resolved = false
      const finish = () => {
        if (resolved) return
        resolved = true
        resolve(true)
      }
      entry.socket.once('close', finish)
      try {
        entry.socket.close(1000, 'Disconnected by user')
      } catch {
        entry.socket.terminate()
        finish()
        return
      }
      setTimeout(() => {
        if (entry.socket.readyState !== WebSocket.CLOSED) entry.socket.terminate()
        finish()
      }, 600)
    })
  })

  ipcMain.handle('ws:update-config', (_event, config) => {
    const entry = sockets.get(config.id)
    if (entry) entry.config = config
    return Boolean(entry)
  })

  ipcMain.handle('ws:send', (_event, { id, payload, source, config }) => {
    const entry = sockets.get(id)
    if (!entry) throw new Error('Connect before sending a message')
    if (config) entry.config = config
    return sendPayload(entry, payload, source)
  })

  ipcMain.handle('template:preview', (_event, { template, variables }) => {
    return renderTemplate(template, {
      message: { type: 'example', id: 42 },
      raw: '{"type":"example","id":42}',
      last: { type: 'example', id: 42 },
      history: [],
      now: new Date().toISOString()
    }, variables)
  })

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text))
    return true
  })
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.loadFile('index.html')
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock.setIcon(path.join(__dirname, 'build/icon.png'))
  }
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
