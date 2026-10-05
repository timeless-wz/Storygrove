import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Plus, RefreshCw, Save } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { NativeSelect } from '../ui/NativeSelect'
import { confirm } from '../ui/Confirm'
import DocumentEditingSurface from './DocumentEditingSurface'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { createBusinessFieldDocumentIdentity } from '../../shared/document-editing'
import { useEditorStore, registerEditorExitSaveHandler } from '../../stores/editor-store'
import { ipc } from '../../services/ipc-client'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { randomUUID } from '../../utils/id'
import {
  WORLD_MAP_NODE_TYPE_LABELS,
  type WorldMapAtlas,
  type WorldMapNode,
  type WorldMapNodeType,
} from '../../shared/world-map'

interface LocationDraft {
  id: string
  name: string
  type: WorldMapNodeType
  mapId: string
  markdown: string
  expectedUpdatedAt: string | null
  parentId: string | null
  markerIcon?: WorldMapNode['markerIcon']
  x: number
  y: number
  sourceRefs: string[]
  createdAt?: string
}

function blankDraft(): LocationDraft {
  return {
    id: randomUUID(), name: '', type: 'region', mapId: '', markdown: '', expectedUpdatedAt: null,
    parentId: null, x: 0, y: 0, sourceRefs: [],
  }
}

function fromNode(node: WorldMapNode): LocationDraft {
  return {
    id: node.id, name: node.name, type: node.type, mapId: node.mapId, markdown: node.description,
    expectedUpdatedAt: node.updatedAt ?? null, parentId: node.parentId, markerIcon: node.markerIcon,
    x: node.x, y: node.y, sourceRefs: node.sourceRefs, createdAt: node.createdAt,
  }
}

function serialize(draft: LocationDraft): string { return JSON.stringify({ version: 1, draft }) }

function parseSnapshot(value: string): LocationDraft | null {
  try {
    const parsed = JSON.parse(value) as { version?: unknown; draft?: LocationDraft }
    return parsed.version === 1 && parsed.draft && typeof parsed.draft.markdown === 'string' ? parsed.draft : null
  } catch { return null }
}

export default function LocationManagementEditor({
  projectKey, tabId, initialContent,
}: { projectKey: string; tabId: string; initialContent: string }) {
  const text = useLocaleStore(state => state.text)
  const project = useProjectStore(state => state.currentProject)
  const dirty = useEditorStore(state => state.tabs.find(tab => tab.id === tabId)?.dirty ?? false)
  const captured = captureProjectSession(project)
  const session = captured?.projectPath === projectKey ? captured : null
  const documentProjectId = session?.projectId ?? `inactive:${projectKey}`
  const [atlas, setAtlas] = useState<WorldMapAtlas | null>(null)
  const [draftState, setDraftState] = useState<LocationDraft>(() => parseSnapshot(initialContent) ?? blankDraft())
  const [selectedId, setSelectedId] = useState(parseSnapshot(initialContent)?.id ?? '')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const draftRef = useRef(draftState)
  const sessionRef = useRef(session)
  const selectedIdRef = useRef(selectedId)
  const draftSnapshotAtOpen = useRef(initialContent && dirty ? parseSnapshot(initialContent) : null)
  sessionRef.current = session
  selectedIdRef.current = selectedId
  const locations = useMemo(() => atlas?.nodes ?? [], [atlas])
  const mapNameById = useMemo(() => new Map((atlas?.maps ?? []).map(map => [map.id, map.name])), [atlas])

  const setDraft = useCallback((next: LocationDraft) => {
    draftRef.current = next
    setDraftState(next)
    useEditorStore.getState().updateTabContent(tabId, serialize(next))
  }, [tabId])

  const load = useCallback(async () => {
    const frozen = sessionRef.current
    if (!frozen || !isProjectSessionCurrent(frozen)) return
    setLoading(true)
    setError('')
    try {
      const result = await ipc.invokeWithProjectSession(frozen, 'db:map-get-all', projectKey)
      if (!isProjectSessionCurrent(frozen)) return
      setAtlas(result)
      const selected = result.nodes.find(node => node.id === selectedIdRef.current) ?? result.nodes[0]
      if (selected) {
        const remote = fromNode(selected)
        const restored = draftSnapshotAtOpen.current?.id === selected.id ? draftSnapshotAtOpen.current : null
        const next = restored ? { ...remote, ...restored } : remote
        setSelectedId(selected.id)
        selectedIdRef.current = selected.id
        draftRef.current = next
        setDraftState(next)
        if (!restored) useEditorStore.getState().markTabSaved(tabId, serialize(next))
      } else if (!draftSnapshotAtOpen.current) {
        const next = blankDraft()
        draftRef.current = next
        setDraftState(next)
        setSelectedId('')
        selectedIdRef.current = ''
        useEditorStore.getState().markTabSaved(tabId, serialize(next))
      }
    } catch (cause) {
      if (isProjectSessionCurrent(frozen)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(frozen)) setLoading(false)
    }
  }, [projectKey, tabId])

  useEffect(() => { void load() }, [load, session?.leaseId])

  const save = useCallback(async () => {
    const frozen = sessionRef.current
    const current = draftRef.current
    if (!frozen || !isProjectSessionCurrent(frozen) || saving) return
    if (!current.name.trim()) { setError(text('请先填写地点名称。', 'Enter a location name before saving.')); return }
    setSaving(true)
    setError('')
    const currentTab = useEditorStore.getState().tabs.find(tab => tab.id === tabId)
    const snapshot = { content: serialize(current), contentRevision: currentTab?.contentRevision ?? 0 }
    const node: WorldMapNode = {
      id: current.id, name: current.name, type: current.type, description: current.markdown,
      mapId: current.mapId, parentId: current.parentId, markerIcon: current.markerIcon,
      x: current.x, y: current.y, sourceRefs: current.sourceRefs, createdAt: current.createdAt,
      expectedUpdatedAt: current.expectedUpdatedAt,
    }
    try {
      const response = await ipc.invokeWithProjectSession(frozen, 'db:map-node-upsert', node, projectKey)
      if (!isProjectSessionCurrent(frozen)) return
      if (!response.success || !response.node) throw new Error(response.error ?? '保存地点失败')
      const saved = fromNode(response.node)
      setAtlas(previous => previous ? {
        ...previous, nodes: [response.node!, ...previous.nodes.filter(item => item.id !== response.node!.id)],
      } : previous)
      setSelectedId(saved.id)
      selectedIdRef.current = saved.id
      const latest = draftRef.current
      const changedDuringSave = serialize(latest) !== snapshot.content
      const next = changedDuringSave
        ? { ...latest, expectedUpdatedAt: saved.expectedUpdatedAt, createdAt: saved.createdAt }
        : saved
      draftRef.current = next
      setDraftState(next)
      if (changedDuringSave) useEditorStore.getState().updateTabContent(tabId, serialize(next))
      else useEditorStore.getState().settleTabSave(tabId, snapshot)
    } catch (cause) {
      if (isProjectSessionCurrent(frozen)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(frozen)) setSaving(false)
    }
  }, [projectKey, saving, tabId, text])

  useEffect(() => registerEditorExitSaveHandler({ tabId, type: 'locations', projectKey, save }), [projectKey, save, tabId])

  const switchLocation = async (node: WorldMapNode) => {
    if (dirty && !(await confirm(text('当前地点有未保存修改。放弃修改并切换？', 'This location has unsaved changes. Discard them and switch?'), { title: text('切换地点', 'Switch location'), danger: true }))) return
    const next = fromNode(node)
    draftRef.current = next
    setDraftState(next)
    setSelectedId(node.id)
    selectedIdRef.current = node.id
    useEditorStore.getState().markTabSaved(tabId, serialize(next))
    setError('')
  }

  const newLocation = async () => {
    if (dirty && !(await confirm(text('当前地点有未保存修改。放弃修改并新建？', 'This location has unsaved changes. Discard them and create a new one?'), { title: text('新建地点', 'New location'), danger: true }))) return
    const next = blankDraft()
    draftRef.current = next
    setDraftState(next)
    setSelectedId('')
    selectedIdRef.current = ''
    setError('')
    useEditorStore.getState().updateTabContent(tabId, serialize(next))
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--color-editor-bg)', color: 'var(--color-text)' }}>
      <header className="shrink-0 px-5 py-4 border-b border-[var(--color-border)] space-y-1">
        <h1 className="text-lg font-semibold">{text('地点与区域', 'Locations and regions')}</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">{text('地点资料可独立保存；地图和坐标是可选视图。把空间、生态、资源、危险、通行与关系写在 Markdown 中。', 'Location records save independently. A map and coordinates are optional views. Describe space, ecology, resources, hazards, access, and relationships in Markdown.')}</p>
      </header>
      <div className="flex-1 min-h-0 flex">
        <aside className="w-64 shrink-0 border-r border-[var(--color-border)] flex flex-col min-h-0">
          <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between gap-2"><span className="text-xs text-[var(--color-text-secondary)]">{locations.length} 处地点</span><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={text('重新读取', 'Reload')} disabled={loading} onClick={() => void load()}><RefreshCw size={14} /></Button><Button variant="outline" size="sm" onClick={() => void newLocation()}><Plus size={14} />新建</Button></div></div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {locations.map(node => <button key={node.id} type="button" onClick={() => void switchLocation(node)} className={`w-full rounded-md px-2.5 py-2 text-left ${selectedId === node.id ? 'bg-[var(--color-hover)]' : 'hover:bg-[var(--color-hover)]'}`}><span className="block truncate text-sm">{node.name}</span><span className="block mt-1 text-[11px] text-[var(--color-text-secondary)]">{mapNameById.get(node.mapId) ?? '未关联地图'}</span></button>)}
            {!loading && locations.length === 0 && <p className="px-2 py-4 text-xs leading-5 text-[var(--color-text-secondary)]">尚无地点资料。可以先新建记录，地图视图稍后再补。</p>}
          </div>
        </aside>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto">
          <div className="shrink-0 p-3 border-b border-[var(--color-border)] flex flex-wrap items-center gap-2">
            <Input className="min-w-40 flex-1" aria-label={text('地点名称', 'Location name')} value={draftState.name} onChange={event => setDraft({ ...draftRef.current, name: event.target.value })} placeholder={text('地点名称', 'Location name')} />
            <NativeSelect className="w-36" aria-label={text('地点类型', 'Location type')} value={draftState.type} onChange={event => setDraft({ ...draftRef.current, type: event.target.value as WorldMapNodeType })}>{Object.entries(WORLD_MAP_NODE_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{text(label.zh, label.en)}</option>)}</NativeSelect>
            <NativeSelect className="w-44" aria-label={text('关联地图', 'Associated map')} value={draftState.mapId} onChange={event => setDraft({ ...draftRef.current, mapId: event.target.value })}><option value="">{text('不关联地图', 'No map')}</option>{(atlas?.maps ?? []).map(map => <option key={map.id} value={map.id}>{map.name}</option>)}</NativeSelect>
            <Button disabled={saving || !dirty} onClick={() => void save()}><Save size={14} />{saving ? '保存中…' : '保存'}</Button><span role="status" className="text-xs text-[var(--color-text-secondary)]">{dirty ? '未保存' : '已保存'}</span>
          </div>
          <div className="shrink-0 min-w-0 border-t border-[var(--color-border)]">
            <DocumentEditingSurface
              documentIdentity={createBusinessFieldDocumentIdentity({ projectId: documentProjectId, entityType: 'location', entityId: draftState.id ?? `new-${tabId}`, fieldId: 'markdown' })}
              layout="business-field"
              ariaLabel={text('地点详细说明', 'Location details')}
              content={draftState.markdown}
              onChange={markdown => setDraft({ ...draftRef.current, markdown })}
              onSave={() => save()}
              placeholder={text('粘贴或编写 Markdown 地点资料。此处内容同时作为该地点的正式详细说明。', 'Paste or write Markdown about this location. This is the authoritative detailed description for the location.')}
            />
          </div>
        </main>
      </div>
      {error && <div role="alert" className="shrink-0 px-4 py-2 text-sm text-[var(--color-danger-text)] border-t border-[var(--color-border)]"><MapPin size={14} className="inline mr-1" />{error}</div>}
    </div>
  )
}
