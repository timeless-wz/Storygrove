import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Check, Trash2, Edit2, AlertTriangle, ExternalLink, Bookmark, RefreshCw, CheckCircle2, FileText,
} from 'lucide-react'

import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { ipc } from '../../services/ipc-client'
import { globalEventBus } from '../../shared/event-bus'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../project-session-gate'
import { openChapterFile } from '../panels/sidebar/sidebar-file-openers'
import { locateForeshadowingInText } from '../../services/foreshadowing-locator'
import ForeshadowingThreadLinks from './ForeshadowingThreadLinks'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import type { ForeshadowingRecord } from '../../shared/ipc-channels'
import {
  PlanningPageShell,
  PlanningPane,
  PlanningSearch,
  PlanningChipGroup,
  PlanningListRow,
  PlanningEmptyState,
} from '../planning/PlanningPageShell'
import { usePlanningBackPath } from '../planning/planning-navigation'

interface Props {
  projectKey: string
}

interface DraftOption {
  id: number
  chapterNumber: number
  version: number
  status: string
  chapterTitle?: string
}

const MARKER_TYPE_OPTIONS = [
  { value: 'foreshadowing', label: '伏笔 / 悬念', labelEn: 'Foreshadowing' },
  { value: 'deepen', label: '加深 / 推进', labelEn: 'Deepen' },
  { value: 'callback', label: '呼应 / 回收', labelEn: 'Callback / Resolution' },
]

const COLOR_OPTIONS = [
  { value: 'blue', label: '蓝色', bg: '#3b82f6', border: '#2563eb' },
  { value: 'red', label: '红色', bg: '#ef4444', border: '#dc2626' },
  { value: 'yellow', label: '黄色', bg: '#eab308', border: '#ca8a04' },
  { value: 'green', label: '绿色', bg: '#22c55e', border: '#16a34a' },
  { value: 'purple', label: '紫色', bg: '#a855f7', border: '#9333ea' },
]

type ForeshadowingFilter = 'all' | 'pending' | 'completed'

/**
 * 伏笔管理。
 *
 * 数据模型是「正文原文锚定」的伏笔标记（章节 + 原文片段 + 上下文偏移），
 * 与章节蓝图、章节脉络、故事时间线都不共用存储：这里只读写 db:foreshadowing-*。
 * 页面左侧是伏笔清单（搜索 + 回收状态筛选），右侧是选中伏笔的完整详情与操作。
 */
export default function ForeshadowingManagementView({ projectKey }: Props) {
  const currentProject = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)
  const backPath = usePlanningBackPath()

  const [items, setItems] = useState<ForeshadowingRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<ForeshadowingFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 可用草稿及正文缓存（用于重定位检查和新建）
  const [drafts, setDrafts] = useState<DraftOption[]>([])
  const [draftBodies, setDraftBodies] = useState<Record<number, string>>({})

  // 弹窗状态
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraftId, setCreateDraftId] = useState<number | null>(null)
  const [createSelectedText, setCreateSelectedText] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [createMarkerType, setCreateMarkerType] = useState('foreshadowing')
  const [createColor, setCreateColor] = useState('blue')
  const [createSubmitting, setCreateSubmitting] = useState(false)

  // 编辑弹窗
  const [editingItem, setEditingItem] = useState<ForeshadowingRecord | null>(null)
  const [editNote, setEditNote] = useState('')
  const [editMarkerType, setEditMarkerType] = useState('foreshadowing')
  const [editColor, setEditColor] = useState('blue')

  const loadData = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    setLoading(true)
    try {
      const [fshList, allDrafts] = await Promise.all([
        ipc.invokeWithProjectSession(projectSession, 'db:foreshadowing-list', undefined, projectKey),
        ipc.invokeWithProjectSession(projectSession, 'db:draft-list-all', projectKey),
      ])

      if (!isProjectSessionCurrent(projectSession)) return
      setItems(fshList)
      setDrafts(allDrafts || [])

      // 异步载入涉及到的章节正文用于重定位检测
      const neededDraftIds = [...new Set(fshList.map(item => item.draftId))]
      for (const draftId of neededDraftIds) {
        if (!draftBodies[draftId]) {
          const fullDraft = await ipc.invokeWithProjectSession(projectSession, 'db:draft-get-full', draftId, projectKey)
          if (fullDraft?.content) {
            setDraftBodies(prev => ({ ...prev, [draftId]: fullDraft.content }))
          }
        }
      }
    } finally {
      if (isProjectSessionCurrent(projectSession)) {
        setLoading(false)
      }
    }
  }, [currentProject, projectKey, draftBodies])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData() }, 0)
    return () => window.clearTimeout(timer)
  }, [currentProject, projectKey]) // eslint-disable-line react-hooks/exhaustive-deps -- 与既有行为一致：仅在项目切换时全量读取

  useEffect(() => {
    return globalEventBus.on('FORESHADOWING_UPDATED', (payload) => {
      if (payload.projectPath === projectKey) {
        loadData()
      }
    })
  }, [loadData, projectKey])

  const pendingCount = useMemo(() => items.filter(i => !i.completed).length, [items])
  const completedCount = useMemo(() => items.filter(i => i.completed).length, [items])

  /** 搜索与状态筛选共同决定左侧清单内容。 */
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const searched = query
      ? items.filter(item => (
          item.selectedText.toLowerCase().includes(query)
          || item.note.toLowerCase().includes(query)
          || String(item.chapterNumber) === query
        ))
      : items
    if (filter === 'pending') return searched.filter(i => !i.completed)
    if (filter === 'completed') return searched.filter(i => i.completed)
    return searched
  }, [items, filter, searchQuery])

  /**
   * 详情始终跟随当前清单：筛选后如果原先选中的伏笔已经不在列表里，
   * 自动落到清单第一条，不会把被筛掉的伏笔继续显示在右侧。
   */
  const selectedItem = useMemo(
    () => filteredItems.find(item => item.id === selectedId) ?? filteredItems[0] ?? null,
    [filteredItems, selectedId],
  )

  // 切换完成状态
  const handleToggleCompleted = async (item: ForeshadowingRecord) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    const nextCompleted = !item.completed
    // 乐观更新
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: nextCompleted } : i))

    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:foreshadowing-toggle-completed',
      item.id,
      nextCompleted,
      projectKey,
    )

    if (!result.success) {
      toast.error(result.error || text('更新失败', 'Update failed'))
      loadData()
    } else {
      globalEventBus.emit('FORESHADOWING_UPDATED', { projectPath: projectKey, projectSession, draftId: item.draftId })
    }
  }

  // 删除伏笔
  const handleDelete = async (item: ForeshadowingRecord) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    const ok = await confirm(
      text(`确定要删除此伏笔吗？\n\n“${item.selectedText}”`, `Delete this foreshadowing?\n\n“${item.selectedText}”`),
      { title: text('删除伏笔', 'Delete foreshadowing'), confirmText: text('删除', 'Delete') }
    )
    if (!ok) return

    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:foreshadowing-delete',
      item.id,
      projectKey,
    )

    if (!result.success) {
      toast.error(result.error || text('删除失败', 'Delete failed'))
    } else {
      toast.success(text('已删除伏笔', 'Foreshadowing deleted'))
      globalEventBus.emit('FORESHADOWING_UPDATED', { projectPath: projectKey, projectSession, draftId: item.draftId })
      loadData()
    }
  }

  // 打开编辑弹窗
  const startEdit = (item: ForeshadowingRecord) => {
    setEditingItem(item)
    setEditNote(item.note)
    setEditMarkerType(item.markerType)
    setEditColor(item.color)
  }

  // 提交编辑
  const handleSaveEdit = async () => {
    if (!editingItem) return
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:foreshadowing-update',
      editingItem.id,
      {
        note: editNote,
        markerType: editMarkerType,
        color: editColor,
      },
      projectKey,
    )

    if (!result.success) {
      toast.error(result.error || text('保存失败', 'Save failed'))
    } else {
      toast.success(text('伏笔已更新', 'Foreshadowing updated'))
      setEditingItem(null)
      globalEventBus.emit('FORESHADOWING_UPDATED', { projectPath: projectKey, projectSession, draftId: editingItem.draftId })
      loadData()
    }
  }

  // 打开新建弹窗
  const startCreate = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    // 默认选中第一个草稿
    if (drafts.length > 0 && createDraftId === null) {
      const first = drafts[0]
      setCreateDraftId(first.id)
      if (!draftBodies[first.id]) {
        const fullDraft = await ipc.invokeWithProjectSession(projectSession, 'db:draft-get-full', first.id, projectKey)
        if (fullDraft?.content) {
          setDraftBodies(prev => ({ ...prev, [first.id]: fullDraft.content }))
        }
      }
    }
    setCreateSelectedText('')
    setCreateNote('')
    setCreateMarkerType('foreshadowing')
    setCreateColor('blue')
    setCreateOpen(true)
  }

  // 切换选中草稿时拉取正文
  const handleDraftChange = async (draftId: number) => {
    setCreateDraftId(draftId)
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return

    if (!draftBodies[draftId]) {
      const fullDraft = await ipc.invokeWithProjectSession(projectSession, 'db:draft-get-full', draftId, projectKey)
      if (fullDraft?.content) {
        setDraftBodies(prev => ({ ...prev, [draftId]: fullDraft.content }))
      }
    }
  }

  // 提交新建
  const handleSaveCreate = async () => {
    if (!createDraftId) {
      toast.warning(text('请选择归属章节', 'Please select a chapter'))
      return
    }
    const cleanText = createSelectedText.trim()
    if (!cleanText) {
      toast.warning(text('必须指定章节正文中的有效原文片段，不能创建无法定位的空标记', 'Must select or input valid text from the chapter.'))
      return
    }
    if (!createNote.trim()) {
      toast.warning(text('请填写伏笔说明', 'Please enter a note'))
      return
    }

    const draftText = draftBodies[createDraftId] ?? ''
    const matches: number[] = []
    let pos = 0
    while (pos <= draftText.length - cleanText.length) {
      const idx = draftText.indexOf(cleanText, pos)
      if (idx === -1) break
      matches.push(idx)
      pos = idx + 1
    }

    if (matches.length === 0) {
      toast.error(text('所填原文在选中的章节正文中不存在，不能创建无法定位的空标记', 'The text does not exist in the selected chapter.'))
      return
    }

    if (matches.length > 1) {
      toast.warning(text('原文有多个匹配位置，请在正文编辑器中选中文字后创建', 'The text appears in multiple locations. Please select it in the prose editor to create.'))
      return
    }

    const startOffset = matches[0]
    const endOffset = startOffset + cleanText.length
    const contextBefore = draftText.slice(Math.max(0, startOffset - 100), startOffset)
    const contextAfter = draftText.slice(endOffset, Math.min(draftText.length, endOffset + 100))

    const currentDraft = drafts.find(d => d.id === createDraftId)
    const chapterNumber = currentDraft?.chapterNumber ?? 1

    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    setCreateSubmitting(true)
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:foreshadowing-create',
        {
          draftId: createDraftId,
          chapterNumber,
          selectedText: cleanText,
          startOffset,
          endOffset,
          contextBefore,
          contextAfter,
          note: createNote.trim(),
          markerType: createMarkerType,
          color: createColor,
        },
        projectKey,
      )

      if (!result.success) {
        toast.error(result.error || text('创建伏笔失败', 'Could not create foreshadowing'))
      } else {
        toast.success(text('伏笔已创建', 'Foreshadowing created'))
        setCreateOpen(false)
        globalEventBus.emit('FORESHADOWING_UPDATED', { projectPath: projectKey, projectSession, draftId: createDraftId })
        loadData()
      }
    } finally {
      setCreateSubmitting(false)
    }
  }

  // 点击章节打开编辑器
  const handleOpenChapter = (item: ForeshadowingRecord) => {
    const isManuscript = item.sourceType === 'manuscript'
    const path = isManuscript ? `vela://manuscript/${item.draftId}` : `vela://draft/${item.draftId}`
    const title = text(`第 ${item.chapterNumber} 章`, `Chapter ${item.chapterNumber}`)
    openChapterFile(path, title)
  }

  const markerLabel = (value: string) => {
    const option = MARKER_TYPE_OPTIONS.find(m => m.value === value) ?? MARKER_TYPE_OPTIONS[0]
    return text(option.label, option.labelEn)
  }

  const relocationSafe = (item: ForeshadowingRecord): boolean => {
    const draftBody = draftBodies[item.draftId]
    if (!draftBody) return true
    return locateForeshadowingInText(draftBody, {
      selectedText: item.selectedText,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      contextBefore: item.contextBefore,
      contextAfter: item.contextAfter,
    }).located
  }

  const detailColor = selectedItem
    ? (COLOR_OPTIONS.find(c => c.value === selectedItem.color) ?? COLOR_OPTIONS[0])
    : COLOR_OPTIONS[0]

  return (
    <>
      <PlanningPageShell
        breadcrumb={[
          { label: backPath.overviewLabel, onClick: backPath.openOverview },
          { label: backPath.planLabel, onClick: backPath.revealWritingPlan },
          { label: text('伏笔管理', 'Foreshadowing') },
        ]}
        icon={<Bookmark size={15} />}
        title={text('伏笔管理', 'Foreshadowing')}
        description={text(
          '正文原文锚定的伏笔标记：每一条都绑定具体章节与原文片段，用来追踪埋设、加深与回收。它是“已写下的正文里埋了什么”，与章节蓝图、章节脉络的计划不共用数据。',
          'Prose-anchored foreshadowing markers: each one binds a concrete chapter and passage to track setup, deepening, and payoff. This tracks what was actually written, separate from blueprints and chapter threads.',
        )}
        meta={text(
          `${items.length} 条 · ${pendingCount} 条待回收`,
          `${items.length} items · ${pendingCount} pending`,
        )}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={loadData} disabled={loading} title={text('重新读取伏笔清单', 'Reload foreshadowing list')}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {text('刷新', 'Refresh')}
            </Button>
            <Button variant="default" size="sm" onClick={() => void startCreate()}>
              <Plus size={14} />
              {text('新建伏笔', 'New foreshadowing')}
            </Button>
          </>
        }
      >
        <PlanningPane
          title={text('伏笔清单', 'Foreshadowing list')}
          icon={<FileText size={12} />}
          width={300}
          actions={
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => void startCreate()}
              title={text('新建伏笔', 'New foreshadowing')}
              aria-label={text('新建伏笔', 'New foreshadowing')}
            >
              <Plus size={13} />
            </Button>
          }
          filters={
            <>
              <PlanningSearch
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={text('搜索说明或原文…', 'Search notes or prose…')}
              />
              <PlanningChipGroup
                value={filter}
                onChange={setFilter}
                ariaLabel={text('伏笔回收状态筛选', 'Foreshadowing status filter')}
                options={[
                  { value: 'all', label: text('全部', 'All'), count: items.length },
                  { value: 'pending', label: text('待回收 / 未完成', 'Pending'), count: pendingCount },
                  { value: 'completed', label: text('已回收 / 已完成', 'Completed'), count: completedCount },
                ]}
              />
            </>
          }
          footer={text(
            `显示 ${filteredItems.length} / ${items.length} 条`,
            `Showing ${filteredItems.length} of ${items.length}`,
          )}
        >
          {filteredItems.length === 0 ? (
            <PlanningEmptyState
              icon={<Bookmark size={20} />}
              title={items.length === 0
                ? text('还没有伏笔', 'No foreshadowing yet')
                : text('没有符合条件的伏笔', 'No matching foreshadowing')}
              description={items.length === 0
                ? text(
                    '伏笔必须锚定在已经写下的正文上，因此要先有草稿或正文章节。',
                    'Foreshadowing must anchor to text you have already written, so a draft or chapter must exist first.',
                  )
                : text('可以调整搜索词或切换回收状态筛选。', 'Adjust the search term or switch the status filter.')}
              steps={items.length === 0 ? [
                text('在正文编辑器里选中一句话，点「标记为伏笔」；', 'Select a passage in the prose editor and click “Mark as foreshadowing”.'),
                text('或者点下面的「新建伏笔」，指定章节并粘贴原文片段。', 'Or click “New foreshadowing” to pick a chapter and paste the passage.'),
              ] : undefined}
              actions={items.length === 0 ? (
                <Button variant="default" size="sm" onClick={() => void startCreate()}>
                  <Plus size={14} />
                  {text('新建伏笔', 'New foreshadowing')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => { setSearchQuery(''); setFilter('all') }}>
                  {text('清除筛选', 'Clear filters')}
                </Button>
              )}
            />
          ) : (
            filteredItems.map(item => {
              const colorInfo = COLOR_OPTIONS.find(c => c.value === item.color) ?? COLOR_OPTIONS[0]
              const needsRelocation = !relocationSafe(item)
              return (
                <PlanningListRow
                  key={item.id}
                  selected={selectedItem?.id === item.id}
                  onSelect={() => setSelectedId(item.id)}
                  icon={<span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colorInfo.bg }} />}
                  title={item.note || text('(无说明)', '(No note)')}
                  subtitle={`“${item.selectedText}”`}
                  titleAttr={text('查看这条伏笔的详情', 'View this foreshadowing')}
                  trailing={
                    <>
                      <span className="planning-tag is-muted">{text(`第 ${item.chapterNumber} 章`, `Ch. ${item.chapterNumber}`)}</span>
                      {item.completed
                        ? <span className="planning-tag is-success">{text('已回收', 'Resolved')}</span>
                        : needsRelocation
                          ? <span className="planning-tag is-warning"><AlertTriangle size={10} />{text('待重定位', 'Relocate')}</span>
                          : <span className="planning-tag">{text('待回收', 'Pending')}</span>}
                    </>
                  }
                />
              )
            })
          )}
        </PlanningPane>

        <main className="planning-page__main planning-page__scroll">
          {selectedItem ? (
            <div className="mx-auto max-w-3xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {selectedItem.note || text('(无说明)', '(No note)')}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleOpenChapter(selectedItem)}
                      className="inline-flex items-center gap-1 font-semibold"
                      style={{ color: 'var(--color-accent)' }}
                      title={text('前往对应章节', 'Go to chapter')}
                    >
                      <span>{text(`第 ${selectedItem.chapterNumber} 章`, `Ch. ${selectedItem.chapterNumber}`)}</span>
                      <span className="planning-tag is-muted">
                        {selectedItem.sourceType === 'manuscript' ? text('正文', 'Prose') : text('草稿', 'Draft')}
                      </span>
                      <ExternalLink size={11} className="opacity-70" />
                    </button>
                    <span className="planning-tag">{markerLabel(selectedItem.markerType)}</span>
                    <span
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 planning-tag"
                      style={{ backgroundColor: `${detailColor.bg}15`, color: detailColor.bg, border: `1px solid ${detailColor.bg}40` }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: detailColor.bg }} />
                      {detailColor.label}
                    </span>
                    {selectedItem.completed && (
                      <span className="inline-flex items-center gap-1 planning-tag is-success">
                        <CheckCircle2 size={12} />
                        {text('已回收', 'Resolved')}
                      </span>
                    )}
                    {!relocationSafe(selectedItem) && (
                      <span className="inline-flex items-center gap-1 planning-tag is-warning" title={text(
                        '正文修改后未能唯一安全匹配该原文，需要手动核对或重新定位',
                        'Text anchor changed and could not be uniquely relocated.',
                      )}>
                        <AlertTriangle size={12} />
                        {text('原文位置待重新定位', 'Position pending relocation')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <Button
                    variant={selectedItem.completed ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => void handleToggleCompleted(selectedItem)}
                    title={selectedItem.completed
                      ? text('标记为未完成', 'Mark as pending')
                      : text('标记为已完成', 'Mark as completed')}
                  >
                    <Check size={13} />
                    {selectedItem.completed ? text('标记为未完成', 'Mark as pending') : text('标记为已回收', 'Mark as resolved')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleOpenChapter(selectedItem)}>
                    <ExternalLink size={12} />
                    {text('前往章节', 'Open chapter')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => startEdit(selectedItem)} title={text('编辑说明与标记', 'Edit note and marker')}>
                    <Edit2 size={13} />
                    {text('编辑', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(selectedItem)}
                    title={text('删除伏笔', 'Delete foreshadowing')}
                    style={{ color: 'var(--color-error-text)' }}
                  >
                    <Trash2 size={13} />
                    {text('删除', 'Delete')}
                  </Button>
                </div>
              </div>

              <section className="mt-4">
                <h3 className="planning-section-label">{text('被标记的原文章节片段', 'Anchored passage')}</h3>
                <blockquote
                  className="mt-2 rounded-lg border p-3 text-xs leading-relaxed"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
                >
                  {selectedItem.contextBefore && <span className="opacity-60">{selectedItem.contextBefore}</span>}
                  <span className="font-mono" style={{ color: 'var(--color-text)' }}>{selectedItem.selectedText}</span>
                  {selectedItem.contextAfter && <span className="opacity-60">{selectedItem.contextAfter}</span>}
                </blockquote>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  {text(
                    `原文位置：第 ${selectedItem.startOffset}–${selectedItem.endOffset} 字符。正文被修改后，系统会用这段上下文重新定位，无法唯一匹配时在上方提示。`,
                    `Anchor offsets: ${selectedItem.startOffset}–${selectedItem.endOffset}. After prose edits the context is used to relocate the anchor; a warning appears above when it cannot be matched uniquely.`,
                  )}
                </p>
              </section>

              <section className="mt-5">
                <h3 className="planning-section-label">{text('伏笔说明', 'Note')}</h3>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
                  {selectedItem.note || text('(无说明)', '(No note)')}
                </p>
              </section>

              <ForeshadowingThreadLinks projectKey={projectKey} marker={selectedItem} />
            </div>
          ) : (
            <PlanningEmptyState
              icon={<Bookmark size={20} />}
              title={text('从左侧选择一条伏笔', 'Select a foreshadowing on the left')}
              description={text(
                '右侧会显示这条伏笔的章节、原文片段与说明，并提供回收、编辑与删除操作。',
                'The detail pane shows its chapter, anchored passage, and note, with resolve, edit, and delete actions.',
              )}
            />
          )}
        </main>
      </PlanningPageShell>

      {/* 新建伏笔弹窗 */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark size={16} style={{ color: 'var(--color-accent)' }} />
              {text('新建伏笔', 'Create Foreshadowing')}
            </DialogTitle>
            <DialogDescription>
              {text(
                '伏笔必须关联具体章节正文中的一段文字；系统会自动提取上下文用于后续编辑后的安全定位。',
                'Foreshadowing must associate with a passage in the chapter prose.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="p-5 space-y-4 text-xs">
            {/* 章节选择 */}
            <div className="space-y-1">
              <label className="font-medium text-[var(--color-text)]">
                {text('归属章节', 'Chapter')} *
              </label>
              <select
                className="w-full px-3 py-2 rounded-md border text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-accent)]"
                style={{ borderColor: 'var(--color-border)' }}
                value={createDraftId ?? ''}
                onChange={(e) => handleDraftChange(Number(e.target.value))}
              >
                {drafts.map(d => (
                  <option key={d.id} value={d.id}>
                    {text(`第 ${d.chapterNumber} 章 — ${d.chapterTitle || '无标题'} (${d.status === 'finalized' ? '正文' : `草稿 v${d.version}`})`,
                          `Ch. ${d.chapterNumber} — ${d.chapterTitle || 'Untitled'} (${d.status === 'finalized' ? 'Manuscript' : `Draft v${d.version}`})`)}
                  </option>
                ))}
              </select>
            </div>

            {/* 被标记原文片段 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-medium text-[var(--color-text)]">
                  {text('被标记原文片段', 'Selected Prose Fragment')} *
                </label>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {text('必须与选定章节正文一致', 'Must match chapter text')}
                </span>
              </div>
              <textarea
                className="w-full px-3 py-2 rounded-md border text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-accent)] leading-relaxed resize-none"
                style={{ borderColor: 'var(--color-border)' }}
                rows={3}
                placeholder={text('输入或粘贴该章节正文中的原文片段…', 'Enter text snippet from the chapter…')}
                value={createSelectedText}
                onChange={(e) => setCreateSelectedText(e.target.value)}
              />
            </div>

            {/* 伏笔说明 */}
            <div className="space-y-1">
              <label className="font-medium text-[var(--color-text)]">
                {text('伏笔说明 / 设定备忘', 'Foreshadowing Note')} *
              </label>
              <textarea
                className="w-full px-3 py-2 rounded-md border text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-accent)] leading-relaxed resize-none"
                style={{ borderColor: 'var(--color-border)' }}
                rows={3}
                placeholder={text('例如：第十章揭晓信物来历；此物能抵挡一次致命攻击…', 'e.g., Reveal the token origin in chapter 10…')}
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
              />
            </div>

            {/* 标注类型与颜色 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium text-[var(--color-text)]">
                  {text('标注类型', 'Marker Type')}
                </label>
                <select
                  className="w-full px-3 py-2 rounded-md border text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-accent)]"
                  style={{ borderColor: 'var(--color-border)' }}
                  value={createMarkerType}
                  onChange={(e) => setCreateMarkerType(e.target.value)}
                >
                  {MARKER_TYPE_OPTIONS.map(m => (
                    <option key={m.value} value={m.value}>
                      {text(m.label, m.labelEn)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-[var(--color-text)]">
                  {text('标记颜色', 'Color')}
                </label>
                <div className="flex items-center gap-2 pt-1">
                  {COLOR_OPTIONS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform ${
                        createColor === c.value ? 'scale-125 ring-2 ring-[var(--color-accent)] ring-offset-2' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c.bg }}
                      onClick={() => setCreateColor(c.value)}
                      title={c.label}
                    >
                      {createColor === c.value && <Check size={12} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-5 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              {text('取消', 'Cancel')}
            </Button>
            <Button variant="default" size="sm" onClick={handleSaveCreate} disabled={createSubmitting}>
              {createSubmitting ? text('保存中...', 'Saving...') : text('保存伏笔', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑弹窗 */}
      <Dialog open={editingItem !== null} onOpenChange={(v) => !v && setEditingItem(null)}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 size={16} style={{ color: 'var(--color-accent)' }} />
              {text('编辑伏笔', 'Edit Foreshadowing')}
            </DialogTitle>
            <DialogDescription>
              {text('修改伏笔说明、类型或高亮颜色。', 'Modify note, type, or color.')}
            </DialogDescription>
          </DialogHeader>

          <div className="p-5 space-y-4 text-xs">
            {/* 原文只读展示 */}
            {editingItem && (
              <div className="space-y-1">
                <label className="font-medium text-[var(--color-text-muted)]">
                  {text('标记原文', 'Marked text')}
                </label>
                <div className="p-2.5 rounded border bg-[var(--color-hover)] text-xs text-[var(--color-text-secondary)]">
                  “{editingItem.selectedText}”
                </div>
              </div>
            )}

            {/* 伏笔说明 */}
            <div className="space-y-1">
              <label className="font-medium text-[var(--color-text)]">
                {text('伏笔说明', 'Note')} *
              </label>
              <textarea
                className="w-full px-3 py-2 rounded-md border text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-accent)] leading-relaxed resize-none"
                style={{ borderColor: 'var(--color-border)' }}
                rows={3}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </div>

            {/* 标注类型与颜色 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium text-[var(--color-text)]">
                  {text('标注类型', 'Marker Type')}
                </label>
                <select
                  className="w-full px-3 py-2 rounded-md border text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-hidden focus:ring-1 focus:ring-[var(--color-accent)]"
                  style={{ borderColor: 'var(--color-border)' }}
                  value={editMarkerType}
                  onChange={(e) => setEditMarkerType(e.target.value)}
                >
                  {MARKER_TYPE_OPTIONS.map(m => (
                    <option key={m.value} value={m.value}>
                      {text(m.label, m.labelEn)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-[var(--color-text)]">
                  {text('标记颜色', 'Color')}
                </label>
                <div className="flex items-center gap-2 pt-1">
                  {COLOR_OPTIONS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform ${
                        editColor === c.value ? 'scale-125 ring-2 ring-[var(--color-accent)] ring-offset-2' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c.bg }}
                      onClick={() => setEditColor(c.value)}
                      title={c.label}
                    >
                      {editColor === c.value && <Check size={12} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-5 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <Button variant="outline" size="sm" onClick={() => setEditingItem(null)}>
              {text('取消', 'Cancel')}
            </Button>
            <Button variant="default" size="sm" onClick={handleSaveEdit}>
              {text('保存更改', 'Save changes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
