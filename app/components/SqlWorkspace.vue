<script setup lang="ts">
import type { QueryResult } from '#shared/types'
import { useSqlWorkspace, type SqlTab, type SqlTabContext } from '../stores/sqlWorkspace'

const props = withDefaults(defineProps<{
  workspaceId: string
  suggestedConnectionId: string
  suggestedDatabase?: string | null
  suggestedSchema?: string | null
}>(), { suggestedDatabase: null, suggestedSchema: null })

const currentContext = computed<SqlTabContext>(() => ({
  connectionId: props.suggestedConnectionId,
  database: props.suggestedDatabase,
  schema: props.suggestedSchema,
}))
const workspace = useSqlWorkspace(props.workspaceId, currentContext.value)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const draggingId = ref<string | null>(null)

// Selecting a table changes only the active SQL tab's execution context. Other
// tabs keep their own database/schema binding and every draft remains intact.
watch(
  () => [props.suggestedConnectionId, props.suggestedDatabase, props.suggestedSchema] as const,
  () => workspace.setActiveContext(currentContext.value),
)

function contextLabel(tab: SqlTab): string {
  if (tab.database && tab.schema) return `${tab.database} / ${tab.schema}`
  if (tab.database) return tab.database
  return tab.connectionId === props.workspaceId ? 'root' : tab.connectionId.slice(0, 8)
}

function startRename(tab: SqlTab) {
  renamingId.value = tab.id
  renameValue.value = tab.title
}

function commitRename() {
  if (!renamingId.value) return
  workspace.renameTab(renamingId.value, renameValue.value)
  renamingId.value = null
}

function cancelRename() {
  renamingId.value = null
}

function closeTab(id: string) {
  if (renamingId.value === id) cancelRename()
  workspace.closeTab(id, currentContext.value)
}

function startDrag(event: DragEvent, id: string) {
  draggingId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function dropOn(targetId: string) {
  if (draggingId.value) workspace.moveTab(draggingId.value, targetId)
  draggingId.value = null
}

function updateResult(id: string, result: QueryResult | null) {
  workspace.updateTab(id, { result })
}
</script>

<template>
  <div class="sql-workspace">
    <div class="workspace-title">
      <p class="eyebrow">SQL</p>
      <span v-if="workspace.activeTab.value" data-testid="sql-context" class="context">
        {{ contextLabel(workspace.activeTab.value) }}
      </span>
    </div>

    <div class="tabbar" role="tablist" aria-label="SQL 分頁">
      <div
        v-for="tab in workspace.state.value.tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.id === workspace.state.value.activeTabId }"
        draggable="true"
        @dragstart="startDrag($event, tab.id)"
        @dragover.prevent
        @drop="dropOn(tab.id)"
      >
        <input
          v-if="renamingId === tab.id"
          v-model="renameValue"
          class="rename"
          aria-label="重新命名 SQL 分頁"
          autofocus
          @blur="commitRename"
          @keyup.enter="commitRename"
          @keyup.escape="cancelRename"
        >
        <button
          v-else
          type="button"
          role="tab"
          :aria-selected="tab.id === workspace.state.value.activeTabId"
          :aria-label="`${tab.title} (${contextLabel(tab)})`"
          class="tab-button"
          @click="workspace.activateTab(tab.id)"
          @dblclick="startRename(tab)"
        >
          <span>{{ tab.title }}</span>
          <small>{{ contextLabel(tab) }}</small>
        </button>
        <button type="button" class="close" :aria-label="`關閉 ${tab.title}`" @click.stop="closeTab(tab.id)">×</button>
      </div>
      <button
        type="button"
        class="add"
        aria-label="新增 SQL 分頁"
        title="新增 SQL 分頁"
        @click="workspace.addTab(currentContext)"
      >+</button>
    </div>

    <SqlEditor
      v-if="workspace.ready.value && workspace.activeTab.value"
      :key="workspace.activeTab.value.id"
      :connection-id="workspace.activeTab.value.connectionId"
      :model-value="workspace.activeTab.value.sql"
      :result="workspace.activeTab.value.result"
      @update:model-value="workspace.updateTab(workspace.activeTab.value!.id, { sql: $event })"
      @update:result="updateResult(workspace.activeTab.value!.id, $event)"
    />
  </div>
</template>

<style scoped>
.sql-workspace { display: flex; flex-direction: column; gap: 10px; }
.workspace-title { display: flex; align-items: baseline; gap: 10px; }
.workspace-title .eyebrow { margin: 0; }
.context {
  color: var(--glass);
  font: 11px var(--font-data);
}
.tabbar {
  display: flex;
  align-items: stretch;
  gap: 3px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.tab-item {
  display: flex;
  align-items: stretch;
  min-width: 130px;
  max-width: 220px;
  border: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  background: var(--ink);
}
.tab-item.active { border-color: var(--brass); background: var(--panel-2); }
.tab-button {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 5px 8px;
  border: none;
  background: transparent;
  text-align: left;
}
.tab-button:hover { border: none; background: transparent; }
.tab-button span {
  width: 100%;
  overflow: hidden;
  color: var(--text);
  font: 12px var(--font-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-button small { color: var(--muted); font: 10px var(--font-data); }
.close {
  align-self: stretch;
  padding: 2px 7px;
  border: none;
  background: transparent;
  color: var(--muted);
}
.close:hover { border: none; background: transparent; color: var(--danger); }
.add { flex: 0 0 auto; padding: 5px 11px; }
.rename {
  width: 100px;
  min-width: 0;
  margin: 4px;
  padding: 3px 5px;
  font: 12px var(--font-data);
}
</style>
