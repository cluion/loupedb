<script setup lang="ts">
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; run: [] }>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null

// loupe palette - hex mirrors the tokens in assets/css/main.css
const loupeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#d9a441', fontWeight: '600' }, // brass
  { tag: tags.string, color: '#86b98d' },
  { tag: tags.number, color: '#7fb4c9' }, // glass
  { tag: tags.typeName, color: '#7fb4c9' },
  { tag: tags.comment, color: '#8b93a1', fontStyle: 'italic' },
  { tag: tags.operator, color: '#d8dbe2' },
])

const loupeTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--ink)',
    color: 'var(--text)',
    fontSize: '13px',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius)',
  },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--brass)' },
  '.cm-content': {
    fontFamily: 'var(--font-data)',
    caretColor: 'var(--brass)',
    minHeight: '120px',
    padding: '8px 0',
  },
  '.cm-cursor': { borderLeftColor: 'var(--brass)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(217, 164, 65, 0.18)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(217, 164, 65, 0.05)' },
  '.cm-gutters': {
    backgroundColor: 'var(--panel)',
    color: 'var(--muted)',
    border: 'none',
    borderRight: '1px solid var(--line)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--brass)' },
}, { dark: true })

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        // before basicSetup so Mod-Enter wins over the default insert-newline
        keymap.of([{ key: 'Mod-Enter', run: () => { emit('run'); return true } }]),
        basicSetup,
        sql({ dialect: PostgreSQL }),
        syntaxHighlighting(loupeHighlight),
        loupeTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
        }),
      ],
    }),
  })
})

watch(() => props.modelValue, (v) => {
  if (view && v !== view.state.doc.toString()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
  }
})

onUnmounted(() => view?.destroy())
</script>

<template>
  <div ref="host" />
</template>
