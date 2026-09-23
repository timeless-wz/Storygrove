import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Check, Trash2, Edit2, AlertTriangle, ExternalLink, Bookmark, RefreshCw, CheckCircle2,
} from 'lucide-react'

import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { ipc } from '../../services/ipc-client'
import { globalEventBus } from '../../shared/event-bus'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../project-session-gate'
import { openChapterFile } from '../panels/sidebar/sidebar-file-openers'
import { locateForeshadowingInText } from '../../services/foreshadowing-locator'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import type { ForeshadowingRecord } from '../../shared/ipc-channels'

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

export default function ForeshadowingManagementView({ projectKey }: Props) {
  const currentProject = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)

  const [items, setItems] = useState<ForeshadowingRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')

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
    loadData()
  }, [currentProject, projectKey])

  useEffect(() => {
    return globalEventBus.on('FORESHADOWING_UPDATED', (payload) => {
      if (payload.projectPath === projectKey) {
        loadData()
      }
    })
  }, [loadData, projectKey])

  // 筛选伏笔
  const filteredItems = useMemo(() => {
    if (filter === 'pending') return items.filter(i => !i.completed)
    if (filter === 'completed') return items.filter(i => i.completed)
    return items
  }, [items, filter])

  const pendingCount = useMemo(() => items.filter(i => !i.completed).length, [items])
  const completedCount = useMemo(() => items.filter(i => i.completed).length, [items])

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

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* 顶部标题与操作栏 */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-accent)' }}
          >
            <Bookmark size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {text('伏笔管理', 'Foreshadowing Management')}
            </h1>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {text(
                '管理作品各章节埋设的伏笔、暗线线索与呼应回收，支持原文精准定位',
                'Manage chapter setups, clues, and callbacks with precision text anchors'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} title={text('刷新', 'Refresh')}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button variant="default" size="sm" onClick={startCreate}>
            <Plus size={14} className="mr-1" />
            {text('新建伏笔', 'New Foreshadowing')}
          </Button>
        </div>
      </div>

      {/* 状态过滤与看板统计 */}
      <div
        className="flex items-center gap-2 px-6 py-2.5 border-b text-xs flex-shrink-0"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface-subtle, var(--color-bg))' }}
      >
        <button
          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
            filter === 'all'
              ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
          }`}
          onClick={() => setFilter('all')}
        >
          {text('全部', 'All')} ({items.length})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
            filter === 'pending'
              ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
          }`}
          onClick={() => setFilter('pending')}
        >
          {text('待回收 / 未完成', 'Pending')} ({pendingCount})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
            filter === 'completed'
              ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
          }`}
          onClick={() => setFilter('completed')}
        >
          {text('已回收 / 已完成', 'Completed')} ({completedCount})
        </button>
      </div>

      {/* 伏笔列表内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Bookmark size={36} className="text-[var(--color-text-muted)] opacity-40 mb-3" />
            <div className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {filter === 'all'
                ? text('暂无任何伏笔', 'No foreshadowings yet')
                : filter === 'pending'
                ? text('暂无未完成的伏笔', 'No pending foreshadowings')
                : text('暂无已完成的伏笔', 'No completed foreshadowings')}
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-sm">
              {text(
                '可以在草稿或正文中选中文本后点击“标记为伏笔”，也可以直接在此页面点击“新建伏笔”。',
                'You can select text in the editor and click "Mark as Foreshadowing", or click "New Foreshadowing" here.'
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl mx-auto">
            {filteredItems.map(item => {
              // 检测当前正文中是否可安全重定位
              const draftBody = draftBodies[item.draftId]
              let isRelocatedSafe = true
              if (draftBody) {
                const loc = locateForeshadowingInText(draftBody, {
                  selectedText: item.selectedText,
                  startOffset: item.startOffset,
                  endOffset: item.endOffset,
                  contextBefore: item.contextBefore,
                  contextAfter: item.contextAfter,
                })
                isRelocatedSafe = loc.located
              }

              const colorInfo = COLOR_OPTIONS.find(c => c.value === item.color) || COLOR_OPTIONS[0]
              const markerInfo = MARKER_TYPE_OPTIONS.find(m => m.value === item.markerType) || MARKER_TYPE_OPTIONS[0]

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-all ${
                    item.completed ? 'opacity-65 bg-[var(--color-surface)]/50' : 'bg-[var(--color-surface)] shadow-xs'
                  }`}
                  style={{
                    borderColor: item.completed ? 'var(--color-border)' : 'var(--color-border)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* 左侧：完成复选框 + 核心内容 */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleToggleCompleted(item)}
                        className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center border transition-colors flex-shrink-0 ${
                          item.completed
                            ? 'bg-[var(--color-success)] border-[var(--color-success)] text-[var(--color-success-foreground)]'
                            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                        }`}
                        title={item.completed ? text('标记为未完成', 'Mark as pending') : text('标记为已完成', 'Mark as completed')}
                      >
                        {item.completed && <Check size={13} strokeWidth={2.5} />}
                      </button>

                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* 标题栏徽标：章节 + 类型 + 来源 + 颜色 */}
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          {/* 章节与来源链接 */}
                          <button
                            type="button"
                            onClick={() => handleOpenChapter(item)}
                            className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)] hover:underline cursor-pointer"
                            title={text('前往对应章节', 'Go to chapter')}
                          >
                            <span>{text(`第 ${item.chapterNumber} 章`, `Ch. ${item.chapterNumber}`)}</span>
                            <span
                              className="text-[10px] px-1.5 py-0.2 rounded"
                              style={{
                                backgroundColor: item.sourceType === 'manuscript' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                color: item.sourceType === 'manuscript' ? 'var(--color-success-text)' : 'var(--color-category-progress-text)',
                              }}
                            >
                              {item.sourceType === 'manuscript' ? text('正文', 'Prose') : text('草稿', 'Draft')}
                            </span>
                            <ExternalLink size={11} className="opacity-70" />
                          </button>

                          {/* 标注类型 */}
                          <span
                            className="text-[11px] px-2 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor: 'var(--color-hover)',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            {text(markerInfo.label, markerInfo.labelEn)}
                          </span>

                          {/* 颜色标记 */}
                          <span
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: `${colorInfo.bg}15`,
                              color: colorInfo.bg,
                              border: `1px solid ${colorInfo.bg}40`,
                            }}
                          >
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorInfo.bg }} />
                            {colorInfo.label}
                          </span>

                          {/* 重定位异常警示 */}
                          {!isRelocatedSafe && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-[var(--color-warning-text)] bg-[var(--color-hover)]"
                              title={text(
                                '正文修改后未能唯一安全匹配该原文，需要手动核对或重新定位',
                                'Text anchor changed and could not be uniquely relocated.'
                              )}
                            >
                              <AlertTriangle size={12} />
                              {text('原文位置待重新定位', 'Position pending relocation')}
                            </span>
                          )}

                          {/* 完成时间 */}
                          {item.completed && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success-text)]">
                              <CheckCircle2 size={12} />
                              {text('已回收', 'Resolved')}
                            </span>
                          )}
                        </div>

                        {/* 说明内容 */}
                        <div
                          className={`text-sm font-medium leading-relaxed ${
                            item.completed ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'
                          }`}
                        >
                          {item.note || text('(无说明)', '(No note)')}
                        </div>

                        {/* 原文片段引用 */}
                        <div
                          className="text-xs p-2 rounded-lg border leading-relaxed select-text"
                          style={{
                            backgroundColor: 'var(--color-hover)',
                            borderColor: 'var(--color-border)',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          <span className="font-serif italic mr-1 text-[var(--color-accent)]">“</span>
                          <span className="font-mono">{item.selectedText}</span>
                          <span className="font-serif italic ml-1 text-[var(--color-accent)]">”</span>
                        </div>
                      </div>
                    </div>

                    {/* 右侧：编辑与删除操作 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(item)}
                        title={text('编辑说明与标记', 'Edit')}
                      >
                        <Edit2 size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(item)}
                        title={text('删除伏笔', 'Delete')}
                        className="text-[var(--color-error-text)] hover:text-[var(--color-error-text)]"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 新建伏笔弹窗 */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark size={16} className="text-[var(--color-accent)]" />
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
              <Edit2 size={16} className="text-[var(--color-accent)]" />
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
    </div>
  )
}
