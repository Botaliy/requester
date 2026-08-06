const vm = require('node:vm')

const clone = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const evaluate = (expression, context = {}) => {
  const sandbox = Object.create(null)
  Object.assign(sandbox, clone(context), {
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object
  })
  return new vm.Script(`(${expression})`).runInNewContext(sandbox, { timeout: 50 })
}

const resolveVariables = (definitions = [], context = {}) => {
  const vars = Object.create(null)

  for (const definition of definitions.filter((item) => item.name && item.kind !== 'computed')) {
    vars[definition.name] = definition.value
  }

  for (const definition of definitions.filter((item) => item.name && item.kind === 'computed')) {
    try {
      vars[definition.name] = evaluate(definition.value || 'undefined', { ...context, vars })
    } catch (error) {
      throw new Error(`Variable "${definition.name}": ${error.message}`)
    }
  }

  return vars
}

const renderTemplate = (template, context = {}, definitions = []) => {
  const vars = resolveVariables(definitions, context)
  return String(template ?? '').replace(/{{\s*([\s\S]*?)\s*}}/g, (_match, expression) => {
    const value = evaluate(expression, { ...context, vars })
    if (value === undefined || value === null) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

const parseMessage = (data) => {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
  try {
    return { text, value: JSON.parse(text), isJson: true }
  } catch {
    return { text, value: text, isJson: false }
  }
}

module.exports = { evaluate, parseMessage, renderTemplate, resolveVariables }
