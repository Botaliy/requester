import { basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'
import { EditorView, keymap } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'

const requesterTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#0d1016',
    color: '#d8dce5',
    fontSize: '12px'
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '12px 0',
    caretColor: '#a99cff',
    outline: 'none',
    cursor: 'text',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.6'
  },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: '#171b254d' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#6657c966' },
  '.cm-cursor': { borderLeftColor: '#a99cff' },
  '.cm-foldPlaceholder': { backgroundColor: '#242a36', border: '0', color: '#9da5b4' },
  '.cm-scroller': { height: '100%', overflow: 'auto', cursor: 'text' },
  '&.cm-focused': { outline: 'none' }
}, { dark: true })

export const createComposerEditor = (parent, options = {}) => {
  const view = new EditorView({
    doc: options.value || '',
    parent,
    extensions: [
      basicSetup,
      json(),
      oneDark,
      requesterTheme,
      EditorView.lineWrapping,
      keymap.of([{
        key: 'Mod-Enter',
        run: () => {
          options.onSend?.()
          return true
        }
      }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onChange?.(update.state.doc.toString())
      })
    ]
  })

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value) => {
      const nextValue = String(value ?? '')
      if (nextValue === view.state.doc.toString()) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: nextValue } })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy()
  }
}
