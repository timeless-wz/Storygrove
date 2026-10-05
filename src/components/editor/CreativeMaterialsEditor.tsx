import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Save, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { NativeSelect } from '../ui/NativeSelect'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import DocumentEditingSurface from './DocumentEditingSurface'
import { createBusinessFieldDocumentIdentity } from '../../shared/document-editing'
import { useLocaleStore } from '../../stores/locale-store'
import { useLLMStore } from '../../stores/llm-store'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore, registerEditorExitSaveHandler } from '../../stores/editor-store'
import { ipc } from '../../services/ipc-client'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { startBlueprintPlanningWorkflow } from '../../services/workflows/blueprint-planning-workflow'
import { openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'
import { randomUUID } from '../../utils/id'
import {
  CREATIVE_CONTENT_CATEGORIES,
  CREATIVE_MATERIAL_TYPES,
  type CreativeContentCategory,
  type CreativeLegacyOrganizationInput,
  type CreativeMaterialEntry,
  type CreativeMaterialKind,
  type CreativeMaterialSaveInput,
  type CreativeMaterialStatus,
  type CreativeMaterialType,
  type LegacyCreativeSource,
} from '../../shared/creative-content'

type View = 'materials' | 'retired' | 'issues' | 'legacy'
type MaterialDraft = Omit<CreativeMaterialSaveInput, 'expectedRevision'> & { expectedRevision: number | null }

const CATEGORY_LABELS: Record<CreativeContentCategory, string> = {
  'creative-direction': '创作方向', 'writing-rules': '写作规范', premise: '故事前提',
  'world-setting': '世界设定', 'power-system': '力量体系', locations: '地点与区域',
  characters: '人物与关系', 'plot-planning': '剧情规划', 'information-reveal': '信息与揭露',
  materials: '素材与候选', 'retired-and-issues': '废案与问题',
}

const STATUS_LABELS: Record<CreativeMaterialStatus, string> = {
  candidate: '候选', adopted: '已采用', rejected: '未采用', open: '待处理', resolved: '已处理', retired: '已废止',
}

const MATERIAL_TYPE_LABELS: Record<CreativeMaterialType, string> = {
  event: '事件', relic: '遗境 / 遗物', character: '人物', setting: '设定',
  scene: '场景', hook: '爆点', other: '其他',
}

function blankDraft(entryKind: CreativeMaterialKind): MaterialDraft {
  return {
    title: '', entryKind, materialType: 'other',
    status: entryKind === 'material' ? 'candidate' : entryKind === 'retired' ? 'retired' : 'open',
    markdown: '', sourceFileName: '', sourceHeading: '', expectedRevision: null,
  }
}

function fromEntry(entry: CreativeMaterialEntry): MaterialDraft {
  return {
    id: entry.id, title: entry.title, entryKind: entry.entryKind, materialType: entry.materialType,
    status: entry.status, markdown: entry.markdown, sourceFileName: entry.sourceFileName,
    sourceHeading: entry.sourceHeading, expectedRevision: entry.revision,
  }
}

function serializeDraft(draft: MaterialDraft): string {
  return JSON.stringify({ version: 1, draft })
}

function parseDraftSnapshot(value: string): MaterialDraft | null {
  try {
    const parsed = JSON.parse(value) as { version?: unknown; draft?: MaterialDraft }
    if (parsed.version === 1 && parsed.draft && typeof parsed.draft.markdown === 'string') return parsed.draft
  } catch { /* A non-editor tab snapshot is not a draft. */ }
  return null
}

export default function CreativeMaterialsEditor({
  tabId, projectKey, initialView, initialEntryId, initialContent,
}: {
  tabId: string
  projectKey: string
  initialView: View
  initialEntryId?: string
  initialContent: string
}) {
  const text = useLocaleStore(state => state.text)
  const project = useProjectStore(state => state.currentProject)
  const tabDirty = useEditorStore(state => state.tabs.find(tab => tab.id === tabId)?.dirty ?? false)
  const projectSession = captureProjectSession(project)
  const session = projectSession?.projectPath === projectKey ? projectSession : null
  const documentProjectId = session?.projectId ?? `inactive:${projectKey}`
  const [entries, setEntries] = useState<CreativeMaterialEntry[]>([])
  const [legacySources, setLegacySources] = useState<LegacyCreativeSource[]>([])
  const [selectedId, setSelectedId] = useState(initialEntryId ?? '')
  const [newDraftIdentity, setNewDraftIdentity] = useState(() => randomUUID())
  const [draft, setDraftState] = useState<MaterialDraft>(() => blankDraft(
    initialView === 'retired' ? 'retired' : initialView === 'issues' ? 'issue' : 'material',
  ))
  const [legacySelection, setLegacySelection] = useState('')
  const [legacyTargets, setLegacyTargets] = useState<CreativeContentCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [brainstorming, setBrainstorming] = useState(false)
  const [error, setError] = useState('')
  const draftRef = useRef(draft)
  const sessionRef = useRef(session)
  const selectedIdRef = useRef(selectedId)
  const legacySelectionRef = useRef(legacySelection)
  sessionRef.current = session
  selectedIdRef.current = selectedId
  legacySelectionRef.current = legacySelection
  const initialDraftRef = useRef(initialContent && tabDirty ? parseDraftSnapshot(initialContent) : null)

  const entryKind: CreativeMaterialKind = initialView === 'retired' ? 'retired'
    : initialView === 'issues' ? 'issue' : 'material'
  const selectedLegacy = legacySources.find(source => source.sourceField === legacySelection)
  const filteredEntries = useMemo(() => entries.filter(entry => entry.entryKind === entryKind), [entries, entryKind])
  const selectedEntry = filteredEntries.find(entry => entry.id === selectedId)

  const setDraft = useCallback((next: MaterialDraft) => {
    draftRef.current = next
    setDraftState(next)
    useEditorStore.getState().updateTabContent(tabId, serializeDraft(next))
  }, [tabId])

  const load = useCallback(async () => {
    const captured = sessionRef.current
    if (!captured || !isProjectSessionCurrent(captured)) return
    setLoading(true)
    setError('')
    try {
      const [materialRows, sources] = await Promise.all([
        ipc.invokeWithProjectSession(captured, 'db:creative-material-list', undefined, projectKey),
        ipc.invokeWithProjectSession(captured, 'db:creative-legacy-list', projectKey),
      ])
      if (!isProjectSessionCurrent(captured)) return
      setEntries(materialRows)
      setLegacySources(sources)
      if (initialView === 'legacy') {
        const selected = sources.find(source => source.sourceField === legacySelectionRef.current)
          ?? sources.find(source => source.disposition === 'pending') ?? sources[0]
        setLegacySelection(selected?.sourceField ?? '')
        setLegacyTargets(selected?.recommendedCategories ?? [])
      } else {
        const selected = materialRows.find(entry => entry.id === selectedIdRef.current && entry.entryKind === entryKind)
          ?? materialRows.find(entry => entry.entryKind === entryKind)
        if (selected) {
          const base = fromEntry(selected)
          const restored = initialDraftRef.current?.id === selected.id ? initialDraftRef.current : null
          const next = restored ? { ...base, ...restored } : base
          setSelectedId(selected.id)
          draftRef.current = next
          setDraftState(next)
          if (!restored) useEditorStore.getState().markTabSaved(tabId, serializeDraft(next))
        } else if (!initialDraftRef.current) {
          const next = blankDraft(entryKind)
          draftRef.current = next
          setDraftState(next)
          setSelectedId('')
          useEditorStore.getState().markTabSaved(tabId, serializeDraft(next))
        }
      }
    } catch (cause) {
      if (isProjectSessionCurrent(captured)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(captured)) setLoading(false)
    }
  }, [entryKind, initialView, projectKey, tabId])

  useEffect(() => { void load() }, [load, session?.leaseId])

  const save = useCallback(async () => {
    const captured = sessionRef.current
    const current = draftRef.current
    if (!captured || !isProjectSessionCurrent(captured) || saving) return
    if (!current.title.trim()) {
      setError(text('请先填写资料标题。', 'Enter a title before saving.'))
      return
    }
    setSaving(true)
    setError('')
    const snapshotTab = useEditorStore.getState().tabs.find(tab => tab.id === tabId)
    const snapshot = { content: serializeDraft(current), contentRevision: snapshotTab?.contentRevision ?? 0 }
    try {
      const response = await ipc.invokeWithProjectSession(captured, 'db:creative-material-save', {
        ...current, expectedRevision: current.expectedRevision,
      }, projectKey)
      if (!isProjectSessionCurrent(captured)) return
      if (!response.success || !response.entry) throw new Error(response.error ?? '保存资料失败')
      const saved = fromEntry(response.entry)
      setEntries(previous => [response.entry!, ...previous.filter(entry => entry.id !== response.entry!.id)])
      setSelectedId(response.entry.id)
      const latest = draftRef.current
      const changedDuringSave = serializeDraft(latest) !== snapshot.content
      const next = changedDuringSave ? { ...latest, id: response.entry.id, expectedRevision: response.entry.revision } : saved
      draftRef.current = next
      setDraftState(next)
      if (changedDuringSave) {
        useEditorStore.getState().updateTabContent(tabId, serializeDraft(next))
      } else {
        useEditorStore.getState().settleTabSave(tabId, snapshot)
      }
      toast.success(text('资料已保存并回读。', 'Saved and reloaded the material.'))
    } catch (cause) {
      if (isProjectSessionCurrent(captured)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(captured)) setSaving(false)
    }
  }, [projectKey, saving, tabId, text])

  useEffect(() => registerEditorExitSaveHandler({
    tabId, type: 'creative-materials', projectKey, save,
  }), [projectKey, save, tabId])

  const selectEntry = async (entry: CreativeMaterialEntry) => {
    if (tabDirty && !(await confirm(text('当前资料有未保存修改。放弃修改并打开另一条记录？', 'This entry has unsaved changes. Discard them and open another entry?'), { title: text('切换资料', 'Switch entry'), danger: true }))) return
    const next = fromEntry(entry)
    draftRef.current = next
    setDraftState(next)
    setSelectedId(entry.id)
    selectedIdRef.current = entry.id
    useEditorStore.getState().markTabSaved(tabId, serializeDraft(next))
    setError('')
  }

  const createEntry = async () => {
    if (tabDirty && !(await confirm(text('当前资料有未保存修改。放弃修改并新建？', 'This entry has unsaved changes. Discard them and create a new one?'), { title: text('新建资料', 'New entry'), danger: true }))) return
    const next = blankDraft(entryKind)
    setNewDraftIdentity(randomUUID())
    draftRef.current = next
    setDraftState(next)
    setSelectedId('')
    selectedIdRef.current = ''
    setError('')
    useEditorStore.getState().updateTabContent(tabId, serializeDraft(next))
  }

  const organizeLegacy = async (disposition: 'organized' | 'ignored') => {
    const captured = sessionRef.current
    if (!captured || !selectedLegacy || !isProjectSessionCurrent(captured)) return
    if (disposition === 'organized' && legacyTargets.length === 0) {
      setError(text('请选择至少一个已整理到的正式入口。', 'Choose at least one destination where you have organized this material.'))
      return
    }
    const accepted = await confirm(
      disposition === 'organized'
        ? text('确认前请确保旧内容已在相应正式入口保存并回读。本操作只标记整理状态，不复制或删除旧正文。', 'Before confirming, save and reload the content in its formal destination. This records organization status; it does not copy or delete the legacy text.')
        : text('这会将旧内容标为不再用于 AI 参考，原文仍保留在旧字段中。', 'This marks the legacy text as excluded from AI context. The original field remains preserved.'),
      { title: text('确认旧内容整理状态', 'Confirm legacy organization status') },
    )
    if (!accepted || !isProjectSessionCurrent(captured)) return
    try {
      const input: CreativeLegacyOrganizationInput = {
        sourceField: selectedLegacy.sourceField,
        expectedHash: selectedLegacy.contentHash,
        disposition,
        targetCategories: disposition === 'organized' ? legacyTargets : [],
      }
      await ipc.invokeWithProjectSession(captured, 'db:creative-legacy-organize', input, projectKey)
      if (!isProjectSessionCurrent(captured)) return
      toast.success(text('旧内容整理状态已保存。', 'Legacy organization status saved.'))
      await load()
    } catch (cause) {
      if (isProjectSessionCurrent(captured)) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const brainstormFromSelectedMaterial = async () => {
    const captured = sessionRef.current
    const material = entries.find(entry => entry.id === selectedIdRef.current)
    if (!captured || !material || tabDirty || !isProjectSessionCurrent(captured)) return
    const generationModelId = useLLMStore.getState().defaultModelId?.trim()
    if (!generationModelId) {
      setError(text('请先在设置中配置 AI 生成模型。', 'Configure a generation model in Settings first.'))
      return
    }
    setBrainstorming(true)
    setError('')
    try {
      const result = await startBlueprintPlanningWorkflow({
        projectSession: captured,
        generationModelId,
        kind: 'book-outline',
        scope: { kind: 'book' },
        mode: 'generate',
        selectedCreativeMaterialIds: [material.id],
        totalChapters: project?.novelConfig.totalChapters,
        uiLocale: useLocaleStore.getState().locale,
      })
      if (!isProjectSessionCurrent(captured) || !result.accepted) return
      openBuiltinEditor(
        'chapter-card-editor',
        text('章节蓝图', 'Chapter blueprints'),
        'chapter-card',
        undefined,
        undefined,
        undefined,
        { kind: 'book' },
      )
      toast.info(text(
        `已启动基于「${material.title}」的全书总纲候选。候选完成后在章节蓝图中审阅确认。`,
        `Started a whole-book outline candidate using “${material.title}”. Review and confirm it in Chapter blueprints when ready.`,
      ))
    } catch (cause) {
      if (isProjectSessionCurrent(captured)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(captured)) setBrainstorming(false)
    }
  }

  const heading = initialView === 'legacy' ? '待整理旧内容'
    : initialView === 'retired' ? '废案'
      : initialView === 'issues' ? '问题记录' : '素材与候选'
  const description = initialView === 'legacy'
    ? '旧配置原文只在这里追溯。完成正式入口的保存与回读后，再标记归位；内容不自动搬移。'
    : initialView === 'retired'
      ? '保存已废止方案与原因，作为明确的禁用约束。它们不会默认进入写作上下文。'
      : initialView === 'issues'
        ? '记录未解决漏洞、风险和处理结果，供审查工作流使用。'
        : '记录尚未采用的事件、遗境、人物、设定、场景和爆点。候选状态与 AI 生成审批状态分别管理。'

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--color-editor-bg)', color: 'var(--color-text)' }}>
      <header className="shrink-0 px-5 py-4 border-b border-[var(--color-border)] space-y-1">
        <h1 className="text-lg font-semibold">{text(heading, heading)}</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">{text(description, description)}</p>
      </header>
      {initialView === 'legacy' ? (
        <div className="flex-1 min-h-0 flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label={text('选择旧配置来源', 'Choose legacy source')} className="max-w-sm" value={legacySelection} onChange={event => {
              const selected = legacySources.find(source => source.sourceField === event.target.value)
              setLegacySelection(event.target.value)
              setLegacyTargets(selected?.recommendedCategories ?? [])
            }}>
              {legacySources.map(source => <option key={source.sourceField} value={source.sourceField}>
                {source.label} · {source.disposition === 'pending' ? '待整理' : source.disposition === 'organized' ? '已整理' : '已忽略'}
              </option>)}
            </NativeSelect>
            {selectedLegacy && <span className="text-xs text-[var(--color-text-secondary)]">{text(`建议归入：${selectedLegacy.recommendedCategories.map(id => CATEGORY_LABELS[id]).join('、')}`, `Suggested destinations: ${selectedLegacy.recommendedCategories.map(id => CATEGORY_LABELS[id]).join(', ')}`)}</span>}
          </div>
          {selectedLegacy ? <>
            <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-[var(--color-border)]">
              {CREATIVE_CONTENT_CATEGORIES.map(category => <label key={category} className="inline-flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={legacyTargets.includes(category)} onChange={event => setLegacyTargets(previous => event.target.checked ? [...previous, category] : previous.filter(item => item !== category))} />
                {CATEGORY_LABELS[category]}
              </label>)}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span role="status">{selectedLegacy.disposition === 'pending' ? '待整理' : selectedLegacy.disposition === 'organized' ? '已整理' : '已忽略'}</span>
              <Button variant="outline" disabled={loading || saving} onClick={() => void organizeLegacy('organized')}>确认已归位</Button>
              <Button variant="ghost" disabled={loading || saving} onClick={() => void organizeLegacy('ignored')}>标记不再使用</Button>
              <Button variant="ghost" disabled={loading} onClick={() => void load()}><RefreshCw size={14} />重新读取</Button>
            </div>
            <div className="flex-1 min-h-0 min-w-0 rounded-lg border border-[var(--color-border)] overflow-hidden">
              <DocumentEditingSurface
                documentIdentity={createBusinessFieldDocumentIdentity({ projectId: documentProjectId, entityType: 'legacy-creative-source', entityId: selectedLegacy.sourceField, fieldId: 'content' })}
                layout="business-field"
                content={selectedLegacy.content}
                editable={false}
                placeholder={text('旧配置为空', 'Legacy field is empty')}
              />
            </div>
          </> : <div className="flex-1 grid place-items-center text-sm text-[var(--color-text-secondary)]">{loading ? '读取中…' : '没有待整理旧配置内容'}</div>}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <aside className="w-64 shrink-0 border-r border-[var(--color-border)] flex flex-col min-h-0">
            <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-text-secondary)]">{filteredEntries.length} 条记录</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label={text('重新读取', 'Reload')} disabled={loading} onClick={() => void load()}><RefreshCw size={14} /></Button>
                <Button variant="outline" size="sm" onClick={() => void createEntry()}><Plus size={14} />{text('新建', 'New')}</Button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
              {filteredEntries.map(entry => <button key={entry.id} type="button" className={`w-full rounded-md px-2.5 py-2 text-left ${selectedId === entry.id ? 'bg-[var(--color-hover)]' : 'hover:bg-[var(--color-hover)]'}`} onClick={() => void selectEntry(entry)}>
                <span className="block truncate text-sm">{entry.title}</span>
                <span className="block mt-1 text-[11px] text-[var(--color-text-secondary)]">{STATUS_LABELS[entry.status]} · {MATERIAL_TYPE_LABELS[entry.materialType]}</span>
              </button>)}
              {!loading && filteredEntries.length === 0 && <p className="px-2 py-4 text-xs leading-5 text-[var(--color-text-secondary)]">{text('还没有记录。可新建一条，或先按左侧其他入口维护正式事实。', 'No entries yet. Create one here, or use the dedicated pages for formal facts.')}</p>}
            </div>
          </aside>
          <main className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="shrink-0 p-3 border-b border-[var(--color-border)] flex flex-wrap items-center gap-2">
              <Input className="min-w-48 flex-1" aria-label={text('资料标题', 'Entry title')} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder={text('资料标题', 'Entry title')} />
              <NativeSelect aria-label={text('素材用途', 'Material type')} className="w-36" value={draft.materialType ?? 'other'} onChange={event => setDraft({ ...draft, materialType: event.target.value as CreativeMaterialType })}>
                {CREATIVE_MATERIAL_TYPES.map(type => <option key={type} value={type}>{text(MATERIAL_TYPE_LABELS[type], type[0]!.toUpperCase() + type.slice(1))}</option>)}
              </NativeSelect>
              <NativeSelect aria-label={text('素材采用状态', 'Material adoption status')} className="w-32" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as CreativeMaterialStatus })}>
                {(entryKind === 'material' ? ['candidate', 'adopted', 'rejected'] : entryKind === 'retired' ? ['retired'] : ['open', 'resolved']).map(status => <option key={status} value={status}>{STATUS_LABELS[status as CreativeMaterialStatus]}</option>)}
              </NativeSelect>
              <Button disabled={saving || !tabDirty} onClick={() => void save()}><Save size={14} />{saving ? '保存中…' : '保存'}</Button>
              <span role="status" className="text-xs text-[var(--color-text-secondary)]">{tabDirty ? '未保存' : '已保存'}</span>
              {initialView === 'materials' && selectedEntry && ['candidate', 'adopted'].includes(selectedEntry.status) && <Button variant="outline" disabled={saving || tabDirty || brainstorming} onClick={() => void brainstormFromSelectedMaterial()}>{brainstorming ? '启动中…' : '基于此素材生成总纲候选'}</Button>}
            </div>
            <div className="shrink-0 px-3 py-2 grid grid-cols-2 gap-2">
              <Input aria-label={text('来源文件名', 'Source file name')} value={draft.sourceFileName ?? ''} onChange={event => setDraft({ ...draft, sourceFileName: event.target.value })} placeholder={text('来源文件名（用于追溯）', 'Source filename (for provenance)')} />
              <Input aria-label={text('原文标题', 'Source heading')} value={draft.sourceHeading ?? ''} onChange={event => setDraft({ ...draft, sourceHeading: event.target.value })} placeholder={text('原文标题（用于追溯）', 'Original heading (for provenance)')} />
            </div>
            <div className="flex-1 min-h-0 min-w-0 border-t border-[var(--color-border)]">
              <DocumentEditingSurface
                documentIdentity={createBusinessFieldDocumentIdentity({ projectId: documentProjectId, entityType: `creative-material-${entryKind}`, entityId: draft.id ?? `new-${tabId}-${newDraftIdentity}`, fieldId: 'markdown' })}
                layout="business-field"
                showHeadingToc
                content={draft.markdown}
                onChange={markdown => setDraft({ ...draft, markdown })}
                onSave={() => save()}
                placeholder={text('在这里粘贴 Markdown。标题、列表、引用、表格和长篇场景文本都会保留。', 'Paste Markdown here. Headings, lists, quotes, tables, and long scene text are preserved.')}
              />
            </div>
          </main>
        </div>
      )}
      {error && <div role="alert" className="shrink-0 px-4 py-2 text-sm text-[var(--color-danger-text)] border-t border-[var(--color-border)]">{error}</div>}
    </div>
  )
}
