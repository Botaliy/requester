const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]
const uid = () => crypto.randomUUID()

const defaultState = () => {
  const connectionId = uid()
  const groupId = uid()
  const environmentId = uid()
  return {
    activeConnectionId: connectionId,
    connections: [{
      id: connectionId,
      name: 'Local socket',
      url: 'ws://localhost:8080',
      headers: '{}',
      triggers: [{
        id: uid(),
        name: 'Ping → Pong',
        enabled: false,
        condition: `message?.type === 'ping' || message === 'ping'`,
        response: `{{ typeof message === 'object' ? JSON.stringify({ type: 'pong', id: message.id }) : 'pong' }}`,
        delayMs: 0
      }]
    }],
    activeEnvironmentId: environmentId,
    environments: [{
      id: environmentId,
      name: 'Default',
      variables: [
        { id: uid(), name: 'token', kind: 'static', value: '' },
        { id: uid(), name: 'timestamp', kind: 'computed', value: 'Date.now()' }
      ]
    }],
    groups: [{ id: groupId, name: 'Examples', messages: [] }],
    scenarios: [],
    composer: '{\n  "type": "subscribe",\n  "channel": "prices",\n  "sentAt": {{ vars.timestamp }}\n}'
  }
}

let state
let composerEditor
let headersEditor
let currentView = 'workspace'
const runtime = {
  statuses: new Map(),
  traffic: new Map(),
  saveTimer: null,
  trafficFilter: 'all',
  trafficSearch: '',
  draggedMessage: null,
  draggedStep: null,
  modal: null
}

const currentConnection = () => state.connections.find((item) => item.id === state.activeConnectionId)
const activeEnvironment = () => state.environments.find((item) => item.id === state.activeEnvironmentId) || state.environments[0]
const currentVariables = () => activeEnvironment()?.variables || []
const runtimeStatus = () => runtime.statuses.get(state.activeConnectionId) || 'disconnected'
const composerValue = () => composerEditor?.getValue() || ''
const setComposerValue = (value) => composerEditor?.setValue(value)
const headersValue = () => headersEditor?.getValue() || '{}'
const setHeadersValue = (value) => headersEditor?.setValue(value)

const showToast = (message) => {
  const toast = $('#toast')
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200)
}

const closeModal = (value) => {
  if (!runtime.modal) return
  const { resolve } = runtime.modal
  runtime.modal = null
  $('#app-modal').classList.add('hidden')
  resolve(value)
}

const requestText = (title, initialValue = '', confirmLabel = 'Create') => new Promise((resolve) => {
  runtime.modal = { type: 'text', resolve }
  $('#modal-title').textContent = title
  $('#modal-message').classList.add('hidden')
  $('#modal-input-label').classList.add('hidden')
  $('#modal-select-label').classList.add('hidden')
  $('#modal-select').classList.add('hidden')
  $('#modal-input').classList.remove('hidden')
  $('#modal-input').value = initialValue
  $('#modal-confirm').textContent = confirmLabel
  $('#app-modal').classList.remove('hidden')
  requestAnimationFrame(() => {
    $('#modal-input').focus()
    $('#modal-input').select()
  })
})

const requestConfirmation = (title, message, confirmLabel = 'Delete') => new Promise((resolve) => {
  runtime.modal = { type: 'confirm', resolve }
  $('#modal-title').textContent = title
  $('#modal-message').textContent = message
  $('#modal-message').classList.remove('hidden')
  $('#modal-input').classList.add('hidden')
  $('#modal-input-label').classList.add('hidden')
  $('#modal-select-label').classList.add('hidden')
  $('#modal-select').classList.add('hidden')
  $('#modal-confirm').textContent = confirmLabel
  $('#app-modal').classList.remove('hidden')
  requestAnimationFrame(() => $('#modal-confirm').focus())
})

const requestMessageDetails = (initialName, preferredGroupId) => new Promise((resolve) => {
  runtime.modal = { type: 'message', resolve }
  $('#modal-title').textContent = 'Save message to library'
  $('#modal-message').classList.add('hidden')
  $('#modal-input-label').classList.remove('hidden')
  $('#modal-input-label').textContent = 'Message name'
  $('#modal-input').classList.remove('hidden')
  $('#modal-input').value = initialName
  $('#modal-select-label').classList.remove('hidden')
  $('#modal-select').classList.remove('hidden')
  const select = $('#modal-select')
  select.replaceChildren()
  for (const group of state.groups) {
    const option = document.createElement('option')
    option.value = group.id
    option.textContent = group.name
    select.append(option)
  }
  select.value = state.groups.some((group) => group.id === preferredGroupId) ? preferredGroupId : state.groups[0].id
  $('#modal-confirm').textContent = 'Save'
  $('#app-modal').classList.remove('hidden')
  requestAnimationFrame(() => {
    $('#modal-input').focus()
    $('#modal-input').select()
  })
})

const persist = () => {
  clearTimeout(runtime.saveTimer)
  runtime.saveTimer = setTimeout(async () => {
    try {
      await window.requester.saveState(state)
    } catch (error) {
      showToast(`Could not save: ${error.message}`)
    }
  }, 250)
}

const connectionConfig = (connection = currentConnection()) => ({
  ...connection,
  variables: currentVariables(),
  environmentId: state.activeEnvironmentId,
  environmentName: activeEnvironment()?.name || 'Default',
  triggers: connection.triggers || []
})

const syncConnection = () => {
  const connection = currentConnection()
  if (!connection) return
  window.requester.updateConfig(connectionConfig(connection))
  persist()
}

const syncWorkspaceVariables = () => {
  for (const connection of state.connections) {
    window.requester.updateConfig(connectionConfig(connection))
  }
  persist()
}

const textButton = (label, className = 'button small ghost') => {
  const button = document.createElement('button')
  button.className = className
  button.textContent = label
  return button
}

const updateStatus = () => {
  const status = runtimeStatus()
  const badge = $('#connection-status')
  badge.className = `status ${status}`
  badge.textContent = status[0].toUpperCase() + status.slice(1)
  const button = $('#connect-button')
  button.textContent = status === 'connected'
    ? 'Disconnect'
    : status === 'connecting'
      ? 'Connecting…'
      : status === 'disconnecting'
        ? 'Disconnecting…'
        : 'Connect'
  button.disabled = status === 'connecting' || status === 'disconnecting'
  renderConnections()
}

const renderConnections = () => {
  const list = $('#connection-list')
  list.replaceChildren()
  for (const connection of state.connections) {
    const item = document.createElement('button')
    item.className = `connection-item${connection.id === state.activeConnectionId ? ' active' : ''}`
    const dot = document.createElement('span')
    dot.className = `connection-dot${runtime.statuses.get(connection.id) === 'connected' ? ' connected' : ''}`
    const name = document.createElement('span')
    name.textContent = connection.name
    name.style.flex = '1'
    item.append(dot, name)
    if (state.connections.length > 1) {
      const remove = document.createElement('span')
      remove.textContent = '×'
      remove.title = 'Delete connection'
      remove.addEventListener('click', (event) => {
        event.stopPropagation()
        window.requester.disconnect(connection.id)
        state.connections = state.connections.filter((candidate) => candidate.id !== connection.id)
        if (state.activeConnectionId === connection.id) state.activeConnectionId = state.connections[0].id
        persist()
        renderAll()
      })
      item.append(remove)
    }
    item.addEventListener('click', () => {
      saveEditorFields()
      state.activeConnectionId = connection.id
      persist()
      renderAll()
    })
    list.append(item)
  }
}

const saveEditorFields = () => {
  const connection = currentConnection()
  if (!connection) return
  connection.name = $('#connection-name').value.trim() || 'Untitled connection'
  connection.url = $('#connection-url').value.trim()
  connection.headers = headersValue()
  state.composer = composerValue()
}

const renderWorkspaceFields = () => {
  const connection = currentConnection()
  $('#connection-name').value = connection.name
  $('#connection-url').value = connection.url
  setHeadersValue(connection.headers || '{}')
  setComposerValue(state.composer || '')
  updateHeadersCount()
  updateStatus()
  renderTraffic()
  applyToolLayout()
}

const updateHeadersCount = () => {
  try {
    const headers = JSON.parse(headersValue() || '{}')
    $('#headers-count').textContent = Object.keys(headers).length
  } catch {
    $('#headers-count').textContent = '!'
  }
}

const appendTraffic = (event) => {
  const messages = runtime.traffic.get(event.connectionId) || []
  messages.push(event)
  if (messages.length > 500) messages.shift()
  runtime.traffic.set(event.connectionId, messages)
  if (event.connectionId === state.activeConnectionId) renderTraffic()
}

const renderTraffic = () => {
  const traffic = $('#traffic')
  const messages = runtime.traffic.get(state.activeConnectionId) || []
  const filtered = messages.filter((event) => {
    const typeMatch = runtime.trafficFilter === 'all' ||
      event.type === runtime.trafficFilter ||
      (runtime.trafficFilter === 'system' && !['incoming', 'outgoing'].includes(event.type))
    const searchableText = [event.data, event.source, event.environment, event.type]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    const searchMatch = !runtime.trafficSearch || searchableText.includes(runtime.trafficSearch)
    return typeMatch && searchMatch
  })
  $('#message-count').textContent = filtered.length === messages.length
    ? `${messages.length} ${messages.length === 1 ? 'message' : 'messages'}`
    : `${filtered.length} of ${messages.length}`
  traffic.replaceChildren()
  if (!messages.length) {
    traffic.className = 'traffic empty-state'
    const icon = document.createElement('div')
    icon.className = 'empty-icon'
    icon.textContent = '↔'
    const strong = document.createElement('strong')
    strong.textContent = 'No messages yet'
    const span = document.createElement('span')
    span.textContent = 'Connect and send a message to start'
    const actions = document.createElement('div')
    actions.className = 'empty-actions'
    const connect = textButton(runtimeStatus() === 'connected' ? 'Connected' : 'Connect', 'button primary')
    connect.disabled = runtimeStatus() === 'connected' || runtimeStatus() === 'connecting'
    const example = textButton('Load example', 'button ghost')
    connect.addEventListener('click', connectOrDisconnect)
    example.addEventListener('click', loadExample)
    actions.append(connect, example)
    traffic.append(icon, strong, span, actions)
    return
  }
  if (!filtered.length) {
    traffic.className = 'traffic'
    const empty = document.createElement('div')
    empty.className = 'traffic-no-results'
    empty.textContent = 'No messages match this filter'
    traffic.append(empty)
    return
  }
  traffic.className = 'traffic'
  for (const event of filtered) {
    const row = document.createElement('div')
    row.className = `traffic-row ${event.type}`
    const direction = document.createElement('span')
    direction.className = 'direction'
    direction.textContent = event.type === 'incoming' ? '←' : event.type === 'outgoing' ? '→' : event.type === 'open' ? '●' : '!'
    const content = document.createElement('div')
    content.className = 'traffic-content'
    if (event.type === 'open') content.textContent = `Connected to ${event.data}`
    else if (event.type === 'close') content.textContent = `Connection closed · ${event.data}`
    else {
      try {
        content.textContent = JSON.stringify(JSON.parse(event.data), null, 2)
      } catch {
        content.textContent = event.data
      }
    }
    if (content.textContent.split('\n').length > 3 || content.textContent.length > 240) {
      content.classList.add('collapsible')
      content.title = 'Click to expand'
      content.addEventListener('click', () => content.classList.toggle('expanded'))
    }
    const meta = document.createElement('span')
    meta.className = 'traffic-meta'
    meta.textContent = `${event.environment ? `${event.environment} · ` : ''}${event.source ? `${event.source} · ` : ''}${new Date(event.at).toLocaleTimeString([], { hour12: false })}`
    const actions = document.createElement('div')
    actions.className = 'traffic-actions'
    const copy = textButton('Copy', 'traffic-action')
    copy.addEventListener('click', async () => {
      await window.requester.writeClipboard(event.data)
      showToast('Copied')
    })
    actions.append(copy)
    if (event.type === 'incoming' || event.type === 'outgoing') {
      const save = textButton('Save', 'traffic-action')
      save.addEventListener('click', () => saveTrafficMessage(event))
      actions.append(save)
    }
    row.append(direction, content, meta, actions)
    traffic.append(row)
  }
  traffic.scrollTop = traffic.scrollHeight
}

const saveTrafficMessage = async (event) => {
  if (!state.groups.length) state.groups.push({ id: uid(), name: 'Messages', messages: [] })
  let suggested = event.type === 'incoming' ? 'Incoming message' : 'Outgoing message'
  try {
    const parsed = JSON.parse(event.data)
    suggested = parsed.type || parsed.event || parsed.action || suggested
  } catch {}
  const details = await requestMessageDetails(suggested, state.groups[0].id)
  if (!details) return
  const group = state.groups.find((item) => item.id === details.groupId) || state.groups[0]
  group.messages.push({ id: uid(), name: details.name, payload: event.data })
  persist()
  renderLibrary()
  showToast(`Saved to ${group.name}`)
}

const loadExample = () => {
  state.composer = '{\n  "type": "subscribe",\n  "channel": "prices",\n  "requestId": "{{ last.id || vars.timestamp }}"\n}'
  setComposerValue(state.composer)
  setTab('compose')
  persist()
  showToast('Example loaded')
}

const isInsideString = (source, offset) => {
  let inside = false
  let escaped = false
  for (let index = 0; index < offset; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') inside = !inside
  }
  return inside
}

const formatTemplatedJson = (value) => {
  const source = value.trim()
  if (!source) return ''
  const templates = []
  const masked = source.replace(/{{\s*[\s\S]*?\s*}}/g, (token, offset) => {
    const marker = `__REQUESTER_TEMPLATE_${templates.length}__`
    const insideString = isInsideString(source, offset)
    templates.push({ marker, token, insideString })
    return insideString ? marker : JSON.stringify(marker)
  })
  let formatted = JSON.stringify(JSON.parse(masked), null, 2)
  for (const template of templates) {
    formatted = template.insideString
      ? formatted.replaceAll(template.marker, template.token)
      : formatted.replaceAll(JSON.stringify(template.marker), template.token)
  }
  return formatted
}

const formatComposerJson = () => {
  try {
    setComposerValue(formatTemplatedJson(composerValue()))
    $('#template-error').classList.add('hidden')
    showToast('JSON formatted')
  } catch (error) {
    $('#template-error').textContent = `Invalid JSON: ${error.message}`
    $('#template-error').classList.remove('hidden')
  }
}

const formatHeadersJson = () => {
  try {
    setHeadersValue(formatTemplatedJson(headersValue()))
    $('#headers-error').classList.add('hidden')
    updateHeadersCount()
    syncConnection()
    showToast('Headers formatted')
  } catch (error) {
    $('#headers-error').textContent = `Invalid JSON: ${error.message}`
    $('#headers-error').classList.remove('hidden')
  }
}

const applyToolLayout = () => {
  state.ui ||= { toolWidth: 470, toolCollapsed: false }
  const grid = $('.workspace-grid')
  grid.classList.toggle('tool-collapsed', Boolean(state.ui.toolCollapsed))
  $('#show-tools').classList.toggle('hidden', !state.ui.toolCollapsed)
  if (!state.ui.toolCollapsed) {
    const width = Math.max(340, Math.min(Number(state.ui.toolWidth) || 470, Math.max(340, grid.clientWidth - 430)))
    grid.style.gridTemplateColumns = `minmax(420px, 1fr) 5px ${width}px`
  } else {
    grid.style.gridTemplateColumns = ''
  }
}

const renderVariables = () => {
  renderEnvironmentSelectors()
  const list = $('#variables-list')
  list.replaceChildren()
  const environment = activeEnvironment()
  $('#environment-name').value = environment.name
  $('#delete-environment').disabled = state.environments.length === 1
  for (const variable of environment.variables) {
    const row = document.createElement('div')
    row.className = 'variable-row'
    const name = document.createElement('input')
    name.className = 'text-input'
    name.placeholder = 'name'
    name.value = variable.name
    const kind = document.createElement('select')
    kind.className = 'select-input'
    for (const [value, label] of [['static', 'Static'], ['computed', 'Computed']]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      kind.append(option)
    }
    kind.value = variable.kind
    const value = document.createElement('input')
    value.className = 'text-input'
    value.placeholder = variable.kind === 'computed' ? 'Date.now()' : 'value'
    value.value = variable.value
    const remove = textButton('×', 'icon-button')
    const update = () => {
      variable.name = name.value.trim()
      variable.kind = kind.value
      variable.value = value.value
      value.placeholder = kind.value === 'computed' ? 'Date.now()' : 'value'
      syncWorkspaceVariables()
    }
    name.addEventListener('input', update)
    kind.addEventListener('change', update)
    value.addEventListener('input', update)
    remove.addEventListener('click', () => {
      environment.variables = environment.variables.filter((item) => item.id !== variable.id)
      syncWorkspaceVariables()
      renderVariables()
    })
    row.append(name, kind, value, remove)
    list.append(row)
  }
}

const renderEnvironmentSelectors = () => {
  for (const select of [$('#environment-select'), $('#variables-environment-select')]) {
    select.replaceChildren()
    for (const environment of state.environments) {
      const option = document.createElement('option')
      option.value = environment.id
      option.textContent = environment.name
      select.append(option)
    }
    select.value = state.activeEnvironmentId
  }
}

const selectEnvironment = (environmentId) => {
  if (!state.environments.some((environment) => environment.id === environmentId)) return
  state.activeEnvironmentId = environmentId
  renderEnvironmentSelectors()
  renderVariables()
  syncWorkspaceVariables()
  const suffix = runtimeStatus() === 'connected' ? ' · reconnect to refresh URL/headers' : ''
  showToast(`${activeEnvironment().name} active${suffix}`)
}

const addEnvironment = async (duplicateCurrent = false) => {
  const source = activeEnvironment()
  const suggested = duplicateCurrent ? `${source.name} copy` : 'New environment'
  const name = await requestText(duplicateCurrent ? 'Duplicate environment' : 'Create environment', suggested)
  if (!name) return
  const environment = {
    id: uid(),
    name,
    variables: duplicateCurrent
      ? source.variables.map((variable) => ({ ...variable, id: uid() }))
      : source.variables.map((variable) => ({
          ...variable,
          id: uid(),
          value: variable.kind === 'computed' ? variable.value : ''
        }))
  }
  state.environments.push(environment)
  state.activeEnvironmentId = environment.id
  syncWorkspaceVariables()
  renderVariables()
}

const renderTriggers = () => {
  const list = $('#triggers-list')
  list.replaceChildren()
  const connection = currentConnection()
  $('#automation-connection-name').textContent = connection.name
  connection.triggers ||= []
  if (!connection.triggers.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = 'No triggers for this connection.'
    list.append(empty)
  }
  for (const trigger of connection.triggers) {
    const card = document.createElement('article')
    card.className = 'trigger-card'
    const top = document.createElement('div')
    top.className = 'trigger-top'
    const enabled = document.createElement('input')
    enabled.type = 'checkbox'
    enabled.className = 'toggle'
    enabled.checked = trigger.enabled
    const enabledWrap = document.createElement('label')
    enabledWrap.className = 'trigger-enabled'
    const enabledText = document.createElement('span')
    enabledText.textContent = 'Enabled'
    enabledWrap.append(enabled, enabledText)
    const name = document.createElement('input')
    name.className = 'text-input'
    name.value = trigger.name
    name.placeholder = 'Trigger name'
    const nameControl = document.createElement('div')
    nameControl.className = 'trigger-control'
    const nameLabel = document.createElement('label')
    nameLabel.textContent = 'Name'
    nameControl.append(nameLabel, name)
    const delay = document.createElement('input')
    delay.className = 'text-input'
    delay.type = 'number'
    delay.min = '0'
    delay.value = trigger.delayMs || 0
    delay.placeholder = '0'
    const delayControl = document.createElement('div')
    delayControl.className = 'trigger-control delay-control'
    const delayLabel = document.createElement('label')
    delayLabel.textContent = 'Delay'
    const delayInputWrap = document.createElement('div')
    delayInputWrap.className = 'suffix-input'
    const delaySuffix = document.createElement('span')
    delaySuffix.textContent = 'ms'
    delayInputWrap.append(delay, delaySuffix)
    delayControl.append(delayLabel, delayInputWrap)
    const remove = textButton('Delete', 'button small ghost danger')
    top.append(enabledWrap, nameControl, delayControl, remove)

    const body = document.createElement('div')
    body.className = 'trigger-body'
    const conditionField = document.createElement('div')
    conditionField.className = 'trigger-field'
    const conditionLabel = document.createElement('label')
    conditionLabel.textContent = 'When this JS expression is true'
    const condition = document.createElement('textarea')
    condition.className = 'code-input'
    condition.value = trigger.condition
    const responseField = document.createElement('div')
    responseField.className = 'trigger-field'
    const responseLabel = document.createElement('label')
    responseLabel.textContent = 'Send this template'
    const response = document.createElement('textarea')
    response.className = 'code-input'
    response.value = trigger.response
    conditionField.append(conditionLabel, condition)
    responseField.append(responseLabel, response)
    body.append(conditionField, responseField)
    card.append(top, body)

    const update = () => {
      trigger.enabled = enabled.checked
      trigger.name = name.value
      trigger.delayMs = Number(delay.value) || 0
      trigger.condition = condition.value
      trigger.response = response.value
      syncConnection()
    }
    for (const field of [enabled, name, delay, condition, response]) field.addEventListener('input', update)
    remove.addEventListener('click', () => {
      connection.triggers = connection.triggers.filter((item) => item.id !== trigger.id)
      syncConnection()
      renderTriggers()
    })
    list.append(card)
  }
}

const allMessages = () => state.groups.flatMap((group) => group.messages.map((message) => ({ ...message, groupName: group.name })))

const renderLibrary = () => {
  const list = $('#library-list')
  list.replaceChildren()
  for (const group of state.groups) {
    const card = document.createElement('article')
    card.className = 'group-card'
    const head = document.createElement('div')
    head.className = 'card-head'
    const name = document.createElement('input')
    name.className = 'text-input'
    name.value = group.name
    const count = document.createElement('span')
    count.className = 'muted group-count'
    count.textContent = `${group.messages.length}`
    count.title = `${group.messages.length} messages`
    const add = textButton('+ Message')
    const remove = textButton('×', 'icon-button')
    head.append(name, count, add, remove)
    card.append(head)
    for (const message of group.messages) {
      const item = document.createElement('div')
      item.className = 'message-item'
      item.draggable = true
      const summary = document.createElement('div')
      summary.className = 'message-summary'
      const title = document.createElement('strong')
      title.textContent = message.name
      const payload = document.createElement('span')
      payload.textContent = message.payload.replace(/\s+/g, ' ')
      summary.append(title, payload)
      const actions = document.createElement('div')
      const send = textButton('Send')
      const del = textButton('×', 'icon-button')
      actions.append(send, del)
      summary.addEventListener('click', () => {
        state.composer = message.payload
        setComposerValue(message.payload)
        setTab('compose')
        persist()
      })
      send.addEventListener('click', () => sendMessage(message.payload, `library:${message.name}`).catch(() => {}))
      del.addEventListener('click', () => {
        group.messages = group.messages.filter((item) => item.id !== message.id)
        for (const scenario of state.scenarios) scenario.steps = scenario.steps.filter((step) => step.messageId !== message.id)
        persist()
        renderLibrary()
        renderScenarios()
      })
      item.addEventListener('dragstart', () => {
        runtime.draggedMessage = { groupId: group.id, messageId: message.id }
        item.classList.add('dragging')
      })
      item.addEventListener('dragend', () => {
        runtime.draggedMessage = null
        item.classList.remove('dragging')
        $$('.drag-over').forEach((candidate) => candidate.classList.remove('drag-over'))
      })
      item.addEventListener('dragover', (event) => {
        event.preventDefault()
        if (runtime.draggedMessage?.messageId !== message.id) item.classList.add('drag-over')
      })
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'))
      item.addEventListener('drop', (event) => {
        event.preventDefault()
        event.stopPropagation()
        item.classList.remove('drag-over')
        moveLibraryMessage(runtime.draggedMessage, group.id, message.id)
      })
      item.append(summary, actions)
      card.append(item)
    }
    name.addEventListener('input', () => { group.name = name.value; persist() })
    add.addEventListener('click', () => saveComposerToLibrary(group.id))
    remove.addEventListener('click', () => {
      const removedIds = new Set(group.messages.map((message) => message.id))
      state.groups = state.groups.filter((item) => item.id !== group.id)
      for (const scenario of state.scenarios) scenario.steps = scenario.steps.filter((step) => !removedIds.has(step.messageId))
      persist(); renderLibrary(); renderScenarios()
    })
    card.addEventListener('dragover', (event) => {
      if (!runtime.draggedMessage) return
      event.preventDefault()
      card.classList.add('drag-over-group')
    })
    card.addEventListener('dragleave', (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove('drag-over-group')
    })
    card.addEventListener('drop', (event) => {
      event.preventDefault()
      card.classList.remove('drag-over-group')
      moveLibraryMessage(runtime.draggedMessage, group.id)
    })
    list.append(card)
  }
}

const moveLibraryMessage = (source, targetGroupId, beforeMessageId) => {
  if (!source || source.messageId === beforeMessageId) return
  const sourceGroup = state.groups.find((group) => group.id === source.groupId)
  const targetGroup = state.groups.find((group) => group.id === targetGroupId)
  const sourceIndex = sourceGroup?.messages.findIndex((message) => message.id === source.messageId) ?? -1
  if (!sourceGroup || !targetGroup || sourceIndex < 0) return
  const [message] = sourceGroup.messages.splice(sourceIndex, 1)
  const targetIndex = targetGroup.messages.findIndex((candidate) => candidate.id === beforeMessageId)
  targetGroup.messages.splice(targetIndex < 0 ? targetGroup.messages.length : targetIndex, 0, message)
  persist()
  renderLibrary()
}

const saveComposerToLibrary = async (preferredGroupId) => {
  saveEditorFields()
  if (!state.groups.length) state.groups.push({ id: uid(), name: 'Messages', messages: [] })
  const group = state.groups.find((item) => item.id === preferredGroupId) || state.groups[0]
  const details = await requestMessageDetails('New message', group.id)
  if (!details) return
  const targetGroup = state.groups.find((item) => item.id === details.groupId) || group
  targetGroup.messages.push({ id: uid(), name: details.name, payload: state.composer })
  persist()
  renderLibrary()
  showToast(`Saved to ${targetGroup.name}`)
}

const renderScenarios = () => {
  const list = $('#scenario-list')
  list.replaceChildren()
  const messages = allMessages()
  for (const scenario of state.scenarios) {
    const card = document.createElement('article')
    card.className = 'scenario-card'
    const head = document.createElement('div')
    head.className = 'card-head'
    const name = document.createElement('input')
    name.className = 'text-input'
    name.value = scenario.name
    const run = textButton('▶ Run', 'button small primary')
    const add = textButton('+ Step')
    const remove = textButton('×', 'icon-button')
    head.append(name, run, add, remove)
    card.append(head)
    for (const step of scenario.steps) {
      const row = document.createElement('div')
      row.className = 'scenario-step'
      row.draggable = true
      const fields = document.createElement('div')
      fields.style.display = 'grid'
      fields.style.gridTemplateColumns = '1fr 90px'
      fields.style.gap = '7px'
      const select = document.createElement('select')
      select.className = 'select-input'
      for (const message of messages) {
        const option = document.createElement('option')
        option.value = message.id
        option.textContent = `${message.groupName} / ${message.name}`
        select.append(option)
      }
      select.value = step.messageId
      const delay = document.createElement('input')
      delay.className = 'text-input'
      delay.type = 'number'
      delay.min = '0'
      delay.value = step.delayMs || 0
      delay.title = 'Delay before sending, ms'
      fields.append(select, delay)
      const del = textButton('×', 'icon-button')
      select.addEventListener('change', () => { step.messageId = select.value; persist() })
      delay.addEventListener('input', () => { step.delayMs = Number(delay.value) || 0; persist() })
      del.addEventListener('click', () => { scenario.steps = scenario.steps.filter((item) => item.id !== step.id); persist(); renderScenarios() })
      row.addEventListener('dragstart', () => {
        runtime.draggedStep = { scenarioId: scenario.id, stepId: step.id }
        row.classList.add('dragging')
      })
      row.addEventListener('dragend', () => {
        runtime.draggedStep = null
        row.classList.remove('dragging')
        $$('.drag-over').forEach((candidate) => candidate.classList.remove('drag-over'))
      })
      row.addEventListener('dragover', (event) => {
        if (runtime.draggedStep?.scenarioId !== scenario.id || runtime.draggedStep.stepId === step.id) return
        event.preventDefault()
        row.classList.add('drag-over')
      })
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'))
      row.addEventListener('drop', (event) => {
        event.preventDefault()
        row.classList.remove('drag-over')
        moveScenarioStep(scenario, runtime.draggedStep?.stepId, step.id)
      })
      row.append(fields, del)
      card.append(row)
    }
    name.addEventListener('input', () => { scenario.name = name.value; persist() })
    run.disabled = !scenario.steps.length
    run.addEventListener('click', () => runScenario(scenario, run))
    add.disabled = !messages.length
    add.title = messages.length ? '' : 'Save a library message first'
    add.addEventListener('click', () => {
      scenario.steps.push({ id: uid(), messageId: messages[0].id, delayMs: 0 })
      persist(); renderScenarios()
    })
    remove.addEventListener('click', () => { state.scenarios = state.scenarios.filter((item) => item.id !== scenario.id); persist(); renderScenarios() })
    list.append(card)
  }
}

const moveScenarioStep = (scenario, stepId, beforeStepId) => {
  if (!stepId || stepId === beforeStepId) return
  const sourceIndex = scenario.steps.findIndex((step) => step.id === stepId)
  if (sourceIndex < 0) return
  const [step] = scenario.steps.splice(sourceIndex, 1)
  const targetIndex = scenario.steps.findIndex((candidate) => candidate.id === beforeStepId)
  scenario.steps.splice(targetIndex < 0 ? scenario.steps.length : targetIndex, 0, step)
  persist()
  renderScenarios()
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const runScenario = async (scenario, button) => {
  button.disabled = true
  button.textContent = 'Running…'
  try {
    for (const step of scenario.steps) {
      await wait(Math.max(0, Number(step.delayMs) || 0))
      const message = allMessages().find((item) => item.id === step.messageId)
      if (!message) throw new Error('A scenario message no longer exists')
      await sendMessage(message.payload, `scenario:${scenario.name}`)
    }
    showToast(`Scenario “${scenario.name}” completed`)
  } catch (error) {
    showToast(error.message)
  } finally {
    button.disabled = false
    button.textContent = '▶ Run'
  }
}

const setTab = (tabName) => {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName))
  $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${tabName}-tab`))
}

const setView = (viewName) => {
  currentView = viewName
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${viewName}-view`))
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === viewName))
  if (viewName === 'variables') renderVariables()
  if (viewName === 'triggers') renderTriggers()
}

const connectOrDisconnect = async () => {
  const connection = currentConnection()
  if (runtimeStatus() === 'connected') {
    runtime.statuses.set(connection.id, 'disconnecting')
    updateStatus()
    try {
      await window.requester.disconnect(connection.id)
    } finally {
      runtime.statuses.set(connection.id, 'disconnected')
      updateStatus()
    }
    return
  }
  saveEditorFields()
  persist()
  runtime.statuses.set(connection.id, 'connecting')
  updateStatus()
  try {
    await window.requester.connect(connectionConfig(connection))
  } catch (error) {
    runtime.statuses.set(connection.id, 'disconnected')
    updateStatus()
    showToast(error.message)
  }
}

const sendMessage = async (payload = composerValue(), source = 'manual') => {
  saveEditorFields()
  syncConnection()
  $('#template-error').classList.add('hidden')
  try {
    await window.requester.send({ id: state.activeConnectionId, payload, source, config: connectionConfig() })
    return true
  } catch (error) {
    $('#template-error').textContent = error.message
    $('#template-error').classList.remove('hidden')
    showToast(error.message)
    throw error
  }
}

const renderAll = () => {
  renderConnections()
  renderWorkspaceFields()
  renderLibrary()
  renderScenarios()
  renderVariables()
  renderTriggers()
  setView(currentView)
}

const bindEvents = () => {
  $('#modal-cancel').addEventListener('click', () => closeModal(runtime.modal?.type === 'confirm' ? false : null))
  $('#modal-confirm').addEventListener('click', () => {
    if (runtime.modal?.type === 'confirm') {
      closeModal(true)
      return
    }
    const value = $('#modal-input').value.trim()
    if (!value) {
      $('#modal-input').focus()
      return
    }
    closeModal(runtime.modal?.type === 'message'
      ? { name: value, groupId: $('#modal-select').value }
      : value)
  })
  $('#modal-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      $('#modal-confirm').click()
    }
  })
  $('#app-modal').addEventListener('click', (event) => {
    if (event.target === $('#app-modal')) closeModal(runtime.modal?.type === 'confirm' ? false : null)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && runtime.modal) closeModal(runtime.modal.type === 'confirm' ? false : null)
    if (!event.metaKey || event.ctrlKey || event.altKey || runtime.modal) return
    const view = { '1': 'workspace', '2': 'triggers', '3': 'variables' }[event.key]
    if (!view) return
    event.preventDefault()
    saveEditorFields()
    setView(view)
  })
  $('#add-connection').addEventListener('click', () => {
    saveEditorFields()
    const connection = { id: uid(), name: 'New connection', url: 'ws://localhost:8080', headers: '{}', triggers: [] }
    state.connections.push(connection)
    state.activeConnectionId = connection.id
    persist(); renderAll()
  })
  $('#connection-name').addEventListener('input', () => { saveEditorFields(); syncConnection(); renderConnections() })
  $('#connection-url').addEventListener('input', () => { saveEditorFields(); syncConnection() })
  $('#format-message').addEventListener('click', formatComposerJson)
  $('#copy-composer').addEventListener('click', async () => {
    await window.requester.writeClipboard(composerValue())
    showToast('Message copied')
  })
  $('#clear-composer').addEventListener('click', () => {
    setComposerValue('')
    composerEditor.focus()
    showToast('Editor cleared')
  })
  $('#format-headers').addEventListener('click', formatHeadersJson)
  $('#copy-headers').addEventListener('click', async () => {
    await window.requester.writeClipboard(headersValue())
    showToast('Headers copied')
  })
  $('#clear-headers').addEventListener('click', () => {
    setHeadersValue('{}')
    headersEditor.focus()
    showToast('Headers cleared')
  })
  $('#headers-toggle').addEventListener('click', () => $('#headers-panel').classList.toggle('hidden'))
  $('#connect-button').addEventListener('click', connectOrDisconnect)
  $('#send-message').addEventListener('click', () => sendMessage().catch(() => {}))
  $('#save-message').addEventListener('click', () => saveComposerToLibrary())
  $('#clear-log').addEventListener('click', () => { runtime.traffic.set(state.activeConnectionId, []); renderTraffic() })
  $('#traffic-search').addEventListener('input', (event) => {
    runtime.trafficSearch = event.target.value.trim().toLowerCase()
    $('#clear-search').classList.toggle('hidden', !runtime.trafficSearch)
    renderTraffic()
  })
  $('#clear-search').addEventListener('click', () => {
    runtime.trafficSearch = ''
    $('#traffic-search').value = ''
    $('#clear-search').classList.add('hidden')
    renderTraffic()
    $('#traffic-search').focus()
  })
  $$('#traffic-filters .segment').forEach((button) => button.addEventListener('click', () => {
    runtime.trafficFilter = button.dataset.filter
    $$('#traffic-filters .segment').forEach((candidate) => candidate.classList.toggle('active', candidate === button))
    renderTraffic()
  }))
  $('#hide-tools').addEventListener('click', () => {
    state.ui.toolCollapsed = true
    persist()
    applyToolLayout()
  })
  $('#show-tools').addEventListener('click', () => {
    state.ui.toolCollapsed = false
    persist()
    applyToolLayout()
  })
  $('#tool-resizer').addEventListener('pointerdown', (event) => {
    event.preventDefault()
    const resizer = $('#tool-resizer')
    resizer.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (moveEvent) => {
      const grid = $('.workspace-grid')
      state.ui.toolWidth = Math.max(340, Math.min(grid.getBoundingClientRect().right - moveEvent.clientX, grid.clientWidth - 430))
      applyToolLayout()
    }
    const end = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
      resizer.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      persist()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
  })
  $('#add-group').addEventListener('click', () => { state.groups.push({ id: uid(), name: 'New group', messages: [] }); persist(); renderLibrary() })
  $('#add-scenario').addEventListener('click', () => { state.scenarios.push({ id: uid(), name: 'New scenario', steps: [] }); persist(); renderScenarios() })
  $('#environment-select').addEventListener('change', (event) => selectEnvironment(event.target.value))
  $('#variables-environment-select').addEventListener('change', (event) => selectEnvironment(event.target.value))
  $('#add-environment').addEventListener('click', () => addEnvironment(false))
  $('#duplicate-environment').addEventListener('click', () => addEnvironment(true))
  $('#environment-name').addEventListener('input', (event) => {
    activeEnvironment().name = event.target.value.trimStart() || 'Untitled environment'
    renderEnvironmentSelectors()
    persist()
  })
  $('#delete-environment').addEventListener('click', async () => {
    if (state.environments.length === 1) return
    const environment = activeEnvironment()
    const confirmed = await requestConfirmation(
      'Delete environment?',
      `“${environment.name}” and all of its variable values will be removed.`
    )
    if (!confirmed) return
    state.environments = state.environments.filter((item) => item.id !== environment.id)
    state.activeEnvironmentId = state.environments[0].id
    syncWorkspaceVariables()
    renderVariables()
  })
  $('#add-variable').addEventListener('click', () => {
    activeEnvironment().variables.push({ id: uid(), name: '', kind: 'static', value: '' })
    syncWorkspaceVariables()
    renderVariables()
  })
  $('#add-trigger').addEventListener('click', () => {
    currentConnection().triggers.push({ id: uid(), name: 'New trigger', enabled: true, condition: `message?.type === 'ping'`, response: `{"type":"pong"}`, delayMs: 0 })
    syncConnection(); renderTriggers()
  })
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.tab)))
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)))
  window.requester.onEvent((event) => {
    if (event.type === 'open') runtime.statuses.set(event.connectionId, 'connected')
    if (event.type === 'close' || event.type === 'error') runtime.statuses.set(event.connectionId, 'disconnected')
    appendTraffic(event)
    if (event.connectionId === state.activeConnectionId) updateStatus()
  })
  window.addEventListener('resize', applyToolLayout)
}

const init = async () => {
  try {
    state = await window.requester.loadState() || defaultState()
  } catch (error) {
    state = defaultState()
    showToast(`Started with defaults: ${error.message}`)
  }
  if (!Array.isArray(state.environments) || !state.environments.length) {
    const environmentId = uid()
    state.environments = [{ id: environmentId, name: 'Default', variables: Array.isArray(state.variables) ? state.variables : [] }]
    state.activeEnvironmentId = environmentId
    delete state.variables
    persist()
  }
  for (const environment of state.environments) environment.variables ||= []
  if (!state.environments.some((environment) => environment.id === state.activeEnvironmentId)) {
    state.activeEnvironmentId = state.environments[0].id
  }
  state.groups ||= []
  state.scenarios ||= []
  state.ui ||= { toolWidth: 470, toolCollapsed: false }
  for (const connection of state.connections) connection.triggers ||= []
  if (!state.connections.some((item) => item.id === state.activeConnectionId)) state.activeConnectionId = state.connections[0].id
  composerEditor = window.RequesterCodeEditor.createComposerEditor($('#composer'), {
    value: state.composer || '',
    onChange: (value) => {
      state.composer = value
      persist()
    },
    onSend: () => sendMessage().catch(() => {})
  })
  headersEditor = window.RequesterCodeEditor.createComposerEditor($('#connection-headers'), {
    value: currentConnection().headers || '{}',
    onChange: (value) => {
      currentConnection().headers = value
      updateHeadersCount()
      syncConnection()
    }
  })
  bindEvents()
  renderAll()
}

void init()
