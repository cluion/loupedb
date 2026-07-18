<script setup lang="ts">
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { formatPostgresSql } from '../utils/sqlFormatter'
import { listSqlStatements, resolveRunnableSql, type RunnableSql } from '../utils/sqlStatements'
import type { SqlNamespace } from '../utils/sqlCompletion'

const props = withDefaults(defineProps<{
  modelValue: string
  schema?: SqlNamespace | null
  defaultSchema?: string
}>(), { schema: null, defaultSchema: 'public' })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:runnable': [runnable: RunnableSql | null]
  run: [runnable: RunnableSql | null]
  formatted: [target: 'selection' | 'document']
  'format-error': [message: string]
}>()

function runnableOf(state: EditorState): RunnableSql | null {
  const sel = state.selection.main
  return resolveRunnableSql(state.doc.toString(), sel.from, sel.to)
}

// the sql() extension lives in a compartment so completion metadata arriving
// after mount (or a database rebind) reconfigures the live editor in place
const langCompartment = new Compartment()
function sqlExtension() {
  return sql({
    dialect: PostgreSQL,
    schema: props.schema ?? undefined,
    defaultSchema: props.defaultSchema,
  })
}

// with several statements in the draft, show which one ⌘⏎ would execute
const currentStatement = Decoration.mark({ class: 'cm-current-statement' })
function highlightCurrent(state: EditorState): DecorationSet {
  const sel = state.selection.main
  if (!sel.empty) return Decoration.none
  const doc = state.doc.toString()
  if (listSqlStatements(doc).length < 2) return Decoration.none
  const r = resolveRunnableSql(doc, sel.from, sel.to)
  return r ? Decoration.set([currentStatement.range(r.from, r.to)]) : Decoration.none
}
const statementHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = highlightCurrent(view.state) }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet) this.decorations = highlightCurrent(u.state)
  }
}, { decorations: (v) => v.decorations })

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null

function nonWhitespaceOffset(source: string, position: number): number {
  let count = 0
  for (let i = 0; i < position; i++) {
    if (!/\s/u.test(source[i]!)) count++
  }
  return count
}

function positionAtNonWhitespaceOffset(source: string, offset: number): number {
  if (offset === 0) return 0
  let count = 0
  for (let i = 0; i < source.length; i++) {
    if (!/\s/u.test(source[i]!) && ++count === offset) return i + 1
  }
  return source.length
}

async function applyFormatSql(editor: EditorView) {
  const state = editor.state
  const selection = state.selection.main
  const target = selection.empty ? 'document' : 'selection'
  const from = target === 'selection' ? selection.from : 0
  const to = target === 'selection' ? selection.to : state.doc.length
  const source = state.doc.sliceString(from, to)

  try {
    const formatted = await formatPostgresSql(source)
    if (view !== editor) return
    const currentSelection = editor.state.selection.main
    if (
      editor.state.doc.sliceString(from, to) !== source
      || currentSelection.anchor !== selection.anchor
      || currentSelection.head !== selection.head
    ) return
    if (formatted !== source) {
      let nextSelection: EditorSelection
      if (target === 'selection') {
        const start = from
        const end = from + formatted.length
        nextSelection = EditorSelection.single(
          selection.anchor <= selection.head ? start : end,
          selection.anchor <= selection.head ? end : start,
        )
      } else {
        const position = positionAtNonWhitespaceOffset(
          formatted,
          nonWhitespaceOffset(source, selection.head),
        )
        nextSelection = EditorSelection.single(position)
      }
      editor.dispatch({
        changes: { from, to, insert: formatted },
        selection: nextSelection,
        scrollIntoView: true,
      })
    }
    editor.focus()
    emit('formatted', target)
  } catch (error) {
    if (view !== editor || editor.state.doc.sliceString(from, to) !== source) return
    emit('format-error', error instanceof Error ? error.message : String(error))
    editor.focus()
  }
}

function formatSql(): boolean {
  if (!view) return false
  void applyFormatSql(view)
  return true
}

function formatShortcut(editor: EditorView, event: KeyboardEvent): boolean {
  if (
    event.code !== 'KeyF'
    || !event.shiftKey
    || !event.altKey
    || event.ctrlKey
    || event.metaKey
  ) return false

  void applyFormatSql(editor)
  return true
}

defineExpose({ formatSql })

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
  '.cm-current-statement': {
    backgroundColor: 'rgba(127, 180, 201, 0.14)',
    boxShadow: 'inset 2px 0 var(--glass)',
  },
}, { dark: true })

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        // before basicSetup so Mod-Enter wins over the default insert-newline
        keymap.of([
          { key: 'Mod-Enter', run: (v) => { emit('run', runnableOf(v.state)); return true } },
          { any: formatShortcut },
        ]),
        basicSetup,
        langCompartment.of(sqlExtension()),
        syntaxHighlighting(loupeHighlight),
        loupeTheme,
        statementHighlighter,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
          if (u.docChanged || u.selectionSet) emit('update:runnable', runnableOf(u.state))
        }),
      ],
    }),
  })
  emit('update:runnable', runnableOf(view.state))
})

watch(() => props.modelValue, (v) => {
  if (view && v !== view.state.doc.toString()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
  }
})

watch(() => [props.schema, props.defaultSchema] as const, () => {
  view?.dispatch({ effects: langCompartment.reconfigure(sqlExtension()) })
})

onUnmounted(() => view?.destroy())
</script>

<template>
  <div ref="host" />
</template>
