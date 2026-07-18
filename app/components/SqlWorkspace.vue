<script setup lang="ts">
import type { ConnectionSafetyMode, SavedQuery, SavedQueryOrganizationPatch, SqlExecutionResult } from '#shared/types'
import { useSqlWorkspace, type SqlTab, type SqlTabContext } from '../stores/sqlWorkspace'
import { useQueryHistory } from '../stores/queryHistory'

const props = withDefaults(defineProps<{
  workspaceId: string
  // history is keyed by connection name so it accumulates across reconnects
  historyLabel: string
  suggestedConnectionId: string
  suggestedDatabase?: string | null
  suggestedSchema?: string | null
  safetyMode?: ConnectionSafetyMode
}>(), { suggestedDatabase: null, suggestedSchema: null, safetyMode: 'normal' })

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

function updateResult(id: string, result: SqlExecutionResult | null) {
  workspace.updateTab(id, { result })
}

function startExecution(id: string) {
  const tab = workspace.state.value.tabs.find((candidate) => candidate.id === id)
  if (!tab) return
  workspace.updateTab(id, {
    result: null,
    previousResult: tab.result ?? tab.previousResult,
  })
}

// --- history / saved queries drawer ---

const history = useQueryHistory(props.historyLabel)
const savedApi = useSavedQueries()
const drawer = ref<'history' | 'saved' | null>(null)
const savedQueries = ref<ReadonlyArray<SavedQuery>>([])
const savedError = ref<string | null>(null)
const savedSearch = ref('')
const savedFolderFilter = ref('')
const savedTagFilter = ref('')
const savedFavoritesOnly = ref(false)
const confirmingDelete = ref<string | null>(null)
const organizingSavedName = ref<string | null>(null)
const organizationFolder = ref('')
const organizationTags = ref('')
const savedBusy = ref<string | null>(null)

const savedFolders = computed(() => [...new Set(savedQueries.value
  .map((query) => query.folder)
  .filter((folder): folder is string => Boolean(folder)))]
  .sort((a, b) => a.localeCompare(b)))
const savedTags = computed(() => [...new Set(savedQueries.value.flatMap((query) => query.tags))]
  .sort((a, b) => a.localeCompare(b)))

const filteredSaved = computed(() => {
  const needle = savedSearch.value.trim().toLowerCase()
  return [...savedQueries.value]
    .filter((query) => !savedFavoritesOnly.value || query.favorite)
    .filter((query) => !savedFolderFilter.value || query.folder === savedFolderFilter.value)
    .filter((query) => !savedTagFilter.value || query.tags.includes(savedTagFilter.value))
    .filter((query) => !needle || [query.name, query.sql, query.folder ?? '', ...query.tags]
      .some((value) => value.toLowerCase().includes(needle)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite)
      || (a.folder ?? '').localeCompare(b.folder ?? '')
      || a.name.localeCompare(b.name))
})

async function loadSaved() {
  const r = await savedApi.list()
  if (r.ok) {
    savedQueries.value = r.data
    savedError.value = null
  } else {
    savedError.value = r.error.message
  }
}

function toggleDrawer(kind: 'history' | 'saved') {
  drawer.value = drawer.value === kind ? null : kind
  confirmingDelete.value = null
  if (drawer.value === 'saved') loadSaved()
}

function onExecuted(outcome: {
  sql: string
  status: 'success' | 'error' | 'cancelled'
  startedAt: number
  durationMs: number
  rowCount: number | null
  affectedRows: number | null
}) {
  const { startedAt, ...entry } = outcome
  history.add({ ...entry, at: startedAt, database: workspace.activeTab.value?.database ?? null })
}

// loading always opens a new tab - a click must never clobber a draft
function openInNewTab(sql: string, title?: string) {
  workspace.addTab(currentContext.value)
  const id = workspace.state.value.activeTabId
  workspace.updateTab(id, { sql })
  if (title) workspace.renameTab(id, title)
}

async function saveActiveTab() {
  const tab = workspace.activeTab.value
  if (!tab) return
  const r = await savedApi.save(tab.title, tab.sql)
  if (r.ok) await loadSaved()
  else savedError.value = r.error.message
}

function replaceSaved(saved: SavedQuery) {
  savedQueries.value = savedQueries.value.map((query) => query.name === saved.name ? saved : query)
}

async function organizeSaved(query: SavedQuery, patch: SavedQueryOrganizationPatch): Promise<boolean> {
  if (savedBusy.value) return false
  savedBusy.value = query.name
  try {
    const response = await savedApi.organize(query.name, patch)
    if (response.ok) {
      replaceSaved(response.data)
      savedError.value = null
      return true
    }
    savedError.value = response.error.message
    return false
  } catch (cause) {
    savedError.value = cause instanceof Error ? cause.message : String(cause)
    return false
  } finally {
    savedBusy.value = null
  }
}

async function toggleSavedFavorite(query: SavedQuery) {
  await organizeSaved(query, { favorite: !query.favorite })
}

function startOrganizingSaved(query: SavedQuery) {
  organizingSavedName.value = query.name
  organizationFolder.value = query.folder ?? ''
  organizationTags.value = query.tags.join(', ')
  confirmingDelete.value = null
}

function cancelOrganizingSaved() {
  organizingSavedName.value = null
}

async function saveOrganization(query: SavedQuery) {
  const tags = organizationTags.value.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean)
  if (await organizeSaved(query, { folder: organizationFolder.value, tags })) {
    organizingSavedName.value = null
  }
}

async function removeSaved(name: string) {
  if (confirmingDelete.value !== name) {
    confirmingDelete.value = name
    return
  }
  confirmingDelete.value = null
  if (organizingSavedName.value === name) cancelOrganizingSaved()
  const r = await savedApi.remove(name)
  if (r.ok) await loadSaved()
  else savedError.value = r.error.message
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="sql-workspace">
    <div class="workspace-title">
      <p class="eyebrow">SQL</p>
      <span v-if="workspace.activeTab.value" data-testid="sql-context" class="context">
        {{ contextLabel(workspace.activeTab.value) }}
      </span>
      <div class="tools">
        <button
          type="button"
          class="ghost"
          :class="{ active: drawer === 'history' }"
          aria-label="查詢歷史"
          @click="toggleDrawer('history')"
        >歷史</button>
        <button
          type="button"
          class="ghost"
          :class="{ active: drawer === 'saved' }"
          aria-label="已存查詢"
          @click="toggleDrawer('saved')"
        >已存</button>
      </div>
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

    <div class="workspace-body">
      <SqlEditor
        v-if="workspace.ready.value && workspace.activeTab.value"
        :key="workspace.activeTab.value.id"
        class="editor-pane"
        :connection-id="workspace.activeTab.value.connectionId"
        :model-value="workspace.activeTab.value.sql"
        :result="workspace.activeTab.value.result"
        :previous-result="workspace.activeTab.value.previousResult"
        :default-schema="workspace.activeTab.value.schema"
        :safety-mode="safetyMode"
        @update:model-value="workspace.updateTab(workspace.activeTab.value!.id, { sql: $event })"
        @update:result="updateResult(workspace.activeTab.value!.id, $event)"
        @execution-started="startExecution(workspace.activeTab.value!.id)"
        @executed="onExecuted"
      />

      <aside v-if="drawer === 'history'" class="drawer" aria-label="查詢歷史面板">
        <div class="drawer-head">
          <span class="drawer-title">歷史</span>
          <button type="button" class="ghost" aria-label="清空歷史" @click="history.clear()">清空</button>
        </div>
        <p v-if="!history.entries.value.length" class="drawer-empty">還沒有執行紀錄。</p>
        <button
          v-for="e in history.entries.value"
          :key="e.id"
          type="button"
          class="entry"
          data-testid="history-entry"
          @click="openInNewTab(e.sql)"
        >
          <span class="entry-meta">
            <i class="dot" :class="e.status === 'success' ? 'ok' : e.status === 'cancelled' ? 'cancel' : 'fail'" />
            {{ timeLabel(e.at) }}<template v-if="e.status === 'cancelled'">・已取消</template><template v-else-if="e.status === 'error'">・失敗</template><template v-if="e.durationMs !== null">・{{ Math.round(e.durationMs) }} ms</template><template v-if="e.rowCount !== null">・{{ e.rowCount }} 列</template><template v-else-if="e.affectedRows !== null">・影響 {{ e.affectedRows }} 列</template><template v-if="e.database">・{{ e.database }}</template>
          </span>
          <code class="entry-sql">{{ e.sql }}</code>
        </button>
      </aside>

      <aside v-else-if="drawer === 'saved'" class="drawer" aria-label="已存查詢面板">
        <div class="drawer-head">
          <span class="drawer-title">已存</span>
          <button type="button" class="ghost" aria-label="儲存目前分頁" @click="saveActiveTab">儲存目前分頁</button>
        </div>
        <input
          v-model="savedSearch"
          class="drawer-search"
          aria-label="搜尋已存查詢"
          placeholder="搜尋名稱、SQL、資料夾或標籤"
        >
        <div class="saved-filters">
          <button
            type="button"
            class="ghost"
            aria-label="只顯示收藏"
            :aria-pressed="savedFavoritesOnly"
            @click="savedFavoritesOnly = !savedFavoritesOnly"
          >★ 收藏</button>
          <select v-model="savedFolderFilter" aria-label="依資料夾篩選">
            <option value="">所有資料夾</option>
            <option v-for="folder in savedFolders" :key="folder" :value="folder">{{ folder }}</option>
          </select>
          <select v-model="savedTagFilter" aria-label="依標籤篩選">
            <option value="">所有標籤</option>
            <option v-for="tag in savedTags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
        </div>
        <p v-if="savedError" role="alert">{{ savedError }}</p>
        <p v-if="!filteredSaved.length" class="drawer-empty">沒有已存查詢。</p>
        <div v-for="q in filteredSaved" :key="q.name" class="saved-item">
          <div class="saved-row">
            <button
              type="button"
              class="favorite"
              :class="{ active: q.favorite }"
              :aria-label="q.favorite ? `取消收藏 ${q.name}` : `收藏 ${q.name}`"
              :aria-pressed="q.favorite"
              :disabled="savedBusy === q.name"
              @click="toggleSavedFavorite(q)"
            >★</button>
            <button
              type="button"
              class="entry"
              data-testid="saved-entry"
              @click="openInNewTab(q.sql, q.name)"
            >
              <span class="entry-meta">{{ q.name }}</span>
              <span v-if="q.folder || q.tags.length" class="saved-meta">
                <span v-if="q.folder">{{ q.folder }}</span>
                <i v-for="tag in q.tags" :key="tag">#{{ tag }}</i>
              </span>
              <code class="entry-sql">{{ q.sql }}</code>
            </button>
            <div class="saved-actions">
              <button type="button" class="ghost" :aria-label="`整理 ${q.name}`" @click="startOrganizingSaved(q)">整理</button>
              <button
                v-if="confirmingDelete === q.name"
                type="button"
                class="confirm-delete"
                :aria-label="`確認刪除 ${q.name}`"
                @click="removeSaved(q.name)"
              >確認刪除</button>
              <button
                v-else
                type="button"
                class="ghost"
                :aria-label="`刪除 ${q.name}`"
                @click="removeSaved(q.name)"
              >刪除</button>
            </div>
          </div>
          <form
            v-if="organizingSavedName === q.name"
            class="organization-editor"
            @submit.prevent="saveOrganization(q)"
          >
            <label>
              資料夾
              <input v-model="organizationFolder" :aria-label="`資料夾 ${q.name}`" maxlength="100" list="saved-folders">
            </label>
            <label>
              標籤
              <input v-model="organizationTags" :aria-label="`標籤 ${q.name}`" placeholder="以逗號分隔">
            </label>
            <div class="organization-actions">
              <button type="button" class="ghost" @click="cancelOrganizingSaved">取消</button>
              <button type="submit" :disabled="savedBusy === q.name">儲存整理</button>
            </div>
          </form>
        </div>
        <datalist id="saved-folders">
          <option v-for="folder in savedFolders" :key="folder" :value="folder" />
        </datalist>
      </aside>
    </div>
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
.tools { display: flex; gap: 4px; margin-left: auto; }
.tools .active { color: var(--brass); }

.workspace-body { display: flex; align-items: flex-start; gap: 12px; }
.editor-pane { flex: 1; min-width: 0; }
.drawer {
  display: flex;
  flex: 0 0 360px;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  overflow-y: auto;
}
.drawer-head { display: flex; align-items: center; justify-content: space-between; }
.drawer-title { color: var(--glass); font: 11px var(--font-data); text-transform: uppercase; }
.drawer-empty { margin: 0; color: var(--muted); font-size: 12px; }
.drawer-search { width: 100%; }
.saved-filters { display: grid; grid-template-columns: auto 1fr 1fr; gap: 5px; }
.saved-filters button[aria-pressed="true"] { border-color: var(--brass); color: var(--brass); }
.saved-filters select { min-width: 0; padding: 5px; }

.entry {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--ink);
  text-align: left;
}
.entry:hover { border-color: var(--brass); background: var(--ink); }
.entry-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font: 11px var(--font-data);
}
.entry-sql {
  display: -webkit-box;
  overflow: hidden;
  width: 100%;
  color: var(--text);
  font: 12px var(--font-data);
  white-space: pre-wrap;
  word-break: break-all;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; }
.dot.ok { background: #86b98d; }
.dot.cancel { background: var(--brass); }
.dot.fail { background: var(--danger); }

.saved-item { display: flex; flex-direction: column; gap: 5px; }
.saved-row { display: flex; align-items: stretch; gap: 4px; }
.favorite { padding: 4px 7px; color: var(--muted); }
.favorite.active { border-color: var(--brass); color: var(--brass); }
.saved-actions { display: flex; flex-direction: column; gap: 4px; }
.saved-meta { display: flex; flex-wrap: wrap; gap: 5px; color: var(--glass); font: 10px var(--font-data); }
.saved-meta i { color: var(--brass); font-style: normal; }
.organization-editor { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); }
.organization-editor label { display: grid; gap: 3px; color: var(--muted); font-size: 11px; }
.organization-actions { display: flex; justify-content: flex-end; gap: 5px; }
.confirm-delete { color: var(--danger); border-color: var(--danger); }

@media (max-width: 900px) {
  .workspace-body { flex-direction: column; }
  .drawer { width: 100%; flex-basis: auto; }
}
</style>
