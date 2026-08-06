const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluate, parseMessage, renderTemplate, resolveVariables } = require('./engine')

test('renders static and computed variables', () => {
  const variables = [
    { name: 'token', kind: 'static', value: 'secret' },
    { name: 'nextId', kind: 'computed', value: 'last.id + 1' }
  ]
  const result = renderTemplate('{"token":"{{ vars.token }}","id":{{ vars.nextId }}}', { last: { id: 4 } }, variables)
  assert.equal(result, '{"token":"secret","id":5}')
})

test('renders object expressions as JSON', () => {
  assert.equal(renderTemplate('{{ message.payload }}', { message: { payload: { ok: true } } }), '{"ok":true}')
})

test('evaluates trigger expressions', () => {
  assert.equal(evaluate(`message?.type === 'ping'`, { message: { type: 'ping' } }), true)
  assert.equal(evaluate(`message?.type === 'ping'`, { message: 'hello' }), false)
})

test('parses JSON and preserves plain text', () => {
  assert.deepEqual(parseMessage(Buffer.from('{"id":7}')), { text: '{"id":7}', value: { id: 7 }, isJson: true })
  assert.deepEqual(parseMessage('pong'), { text: 'pong', value: 'pong', isJson: false })
})

test('computed variables can use earlier variables', () => {
  const variables = [
    { name: 'base', kind: 'static', value: 'orders' },
    { name: 'topic', kind: 'computed', value: '`private:${vars.base}`' }
  ]
  assert.deepEqual({ ...resolveVariables(variables) }, { base: 'orders', topic: 'private:orders' })
})

test('wraps computed variable errors with its name', () => {
  assert.throws(
    () => resolveVariables([{ name: 'broken', kind: 'computed', value: 'missing.value' }]),
    /Variable "broken"/
  )
})
