const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('requester', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  connect: (config) => ipcRenderer.invoke('ws:connect', config),
  disconnect: (id) => ipcRenderer.invoke('ws:disconnect', id),
  updateConfig: (config) => ipcRenderer.invoke('ws:update-config', config),
  send: (request) => ipcRenderer.invoke('ws:send', request),
  previewTemplate: (request) => ipcRenderer.invoke('template:preview', request),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  onEvent: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('ws:event', handler)
    return () => ipcRenderer.removeListener('ws:event', handler)
  }
})
