import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Unlink, X } from 'lucide-react'

import { ipc } from '../../../services/ipc-client'
import { globalEventBus } from '../../../shared/event-bus'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { toast } from '../../ui/Toast'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/Dialog'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../../project-session-gate'
import './blueprint-binding-dialog.css'

export interface BlueprintBindingTarget {
  draftId: number
  chapterNumber: number
  blueprintChapterNumber?: number
  label: string
}

export function BlueprintBindingDialog({
  target,
  open,
  onOpenChange,
}: {
  target: BlueprintBindingTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const [blueprints, setBlueprints] = useState<Array<{ chapterNumber: number; title: string; volumeId?: string }>>([])
  const [volumes, setVolumes] = useState<Array<{ id: string; name: string; sortOrder: number }>>([])
  const [volumeFilter, setVolumeFilter] = useState('all')
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !target) return
    setSelected(target.blueprintChapterNumber ? String(target.blueprintChapterNumber) : '')
    setQuery('')
    setBlueprints([])
    setVolumes([])
    setVolumeFilter('all')
    setLoading(true)
    setLoadError(false)
    setSaving(false)
    let cancelled = false
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) {
      setLoading(false)
      setLoadError(true)
      return
    }
    void Promise.all([
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-list-summary', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-summary-list', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-list', projectSession.projectPath),
    ])
      .then(([items, v2Summaries, volumeRows]) => {
        if (!cancelled && isProjectSessionCurrent(projectSession)) {
          setVolumes([...volumeRows].sort((a, b) => a.sortOrder - b.sortOrder))
          const byChapter = new Map<number, { chapterNumber: number; title: string; volumeId?: string }>(items.map(item => [item.chapterNumber, item]))
          for (const summary of v2Summaries) {
            if (!byChapter.has(summary.chapterNumber)) {
              const sceneHint = summary.sceneTitles[0]
              byChapter.set(summary.chapterNumber, { chapterNumber: summary.chapterNumber, title: sceneHint || `第${summary.chapterNumber}章` })
            }
          }
          setBlueprints([...byChapter.values()].sort((a, b) => a.chapterNumber - b.chapterNumber))
        }
      })
      .catch(() => {
        if (!cancelled && isProjectSessionCurrent(projectSession)) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled && isProjectSessionCurrent(projectSession)) setLoading(false)
      })
    return () => { cancelled = true }
  }, [currentProject, open, target, retry])

  useEffect(() => {
    if (open && !loading) {
      listRef.current?.querySelector<HTMLInputElement>('input:checked')?.closest('label')?.scrollIntoView({ block: 'center' })
    }
  }, [open, loading])

  const current = target?.blueprintChapterNumber ? String(target.blueprintChapterNumber) : ''
  const volumeName = (volumeId?: string) => volumes.find(volume => volume.id === volumeId)?.name || text('未归卷', 'Unassigned')
  const volumeKey = (volumeId?: string) => volumes.some(volume => volume.id === volumeId) ? `volume:${volumeId}` : 'unassigned'
  const chapterLabel = (value: string) => {
    const blueprint = blueprints.find(item => String(item.chapterNumber) === value)
    return `${text(`第${value}章`, `Chapter ${value}`)}${blueprint?.title ? ` · ${blueprint.title}` : ''}`
  }
  const search = query.trim().toLocaleLowerCase()
  const filtered = blueprints.filter(item => (
    (volumeFilter === 'all' || volumeKey(item.volumeId) === volumeFilter)
    && `${item.chapterNumber} 第${item.chapterNumber}章 ${item.title}`.toLocaleLowerCase().includes(search)
  ))
  const canSave = !saving && !loading && !loadError && selected !== current
    && (!selected || blueprints.some(item => String(item.chapterNumber) === selected))

  const save = async () => {
    if (!target || !canSave) return
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectSession.projectPath)) return
    setSaving(true)
    try {
      const selectedChapter = selected ? Number(selected) : null
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-set-blueprint',
        target.draftId,
        selectedChapter,
        projectSession.projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.success) throw new Error(result.error || text('绑定失败', 'Could not bind the blueprint'))
      globalEventBus.emit('REFRESH_RESOURCE', {
        resources: ['drafts', 'fileTree', 'blueprints'],
        blueprintBinding: { draftId: target.draftId, blueprintChapterNumber: selectedChapter },
        projectPath: projectSession.projectPath,
        projectSession,
      })
      toast.success(selectedChapter
        ? text('已绑定章节蓝图', 'Chapter blueprint linked')
        : text('已解绑章节蓝图', 'Chapter blueprint unlinked'))
      onOpenChange(false)
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) {
        toast.error(text(`蓝图绑定失败：${error}`, `Could not bind blueprint: ${error}`))
      }
    } finally {
      if (isProjectSessionCurrent(projectSession)) setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="blueprint-binding" onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }}>
        <DialogHeader>
          <DialogTitle>{text('绑定章节蓝图', 'Link chapter blueprint')}</DialogTitle>
          <DialogDescription>
            {text('选择本章创作依据，发布到正文后仍保留关联。', 'Choose the outline for this chapter. The link remains after publishing.')}
          </DialogDescription>
        </DialogHeader>
        <div className="vela-dialog-body blueprint-binding__body">
          <div className="blueprint-binding__context">
            <p>{text('当前草稿：', 'Draft: ')}<strong>{target?.label}</strong></p>
            <div className="blueprint-binding__current">
              <p>{text('当前绑定：', 'Current link: ')}{current ? chapterLabel(current) : text('未绑定', 'Not linked')}</p>
              {current && <Button variant="ghost" size="sm" disabled={saving || loading || loadError || !selected} onClick={() => setSelected('')}>
                <Unlink size={13} />{text('解除绑定', 'Unlink')}
              </Button>}
            </div>
          </div>
          <div className="blueprint-binding__filters">
          <div className="blueprint-binding__volume-filter">
            <NativeSelect aria-label={text('按卷筛选', 'Filter by volume')} value={volumeFilter} disabled={saving || loading || loadError}
              onChange={event => { setVolumeFilter(event.target.value); listRef.current?.scrollTo({ top: 0 }) }}>
              <option value="all">{text('全部卷', 'All volumes')}</option>
              {volumes.map(volume => <option key={volume.id} value={`volume:${volume.id}`}>{volume.name}</option>)}
              {blueprints.some(item => volumeKey(item.volumeId) === 'unassigned') && <option value="unassigned">{text('未归卷', 'Unassigned')}</option>}
            </NativeSelect>
            <ChevronDown size={14} aria-hidden="true" />
          </div>
          <div className="blueprint-binding__search">
            <Search size={16} aria-hidden="true" />
            <Input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)}
              aria-label={text('搜索章号或标题', 'Search chapter number or title')}
              placeholder={text('搜索章号或标题…', 'Search chapter number or title…')} disabled={saving} />
            {query && <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus() }} disabled={saving} aria-label={text('清空搜索', 'Clear search')}><X size={14} /></button>}
          </div>
          </div>
          <p className="blueprint-binding__count" aria-live="polite">
            {loading ? text('正在读取蓝图…', 'Loading blueprints…') : loadError ? text('读取失败', 'Could not load blueprints') : text(`${filtered.length} / ${blueprints.length} 章蓝图`, `${filtered.length} / ${blueprints.length} blueprints`)}
          </p>
          <div className="blueprint-binding__list" ref={listRef} role="radiogroup" aria-label={text('选择蓝图', 'Choose a blueprint')} aria-busy={loading}>
            {loading ? <p className="blueprint-binding__empty" role="status">{text('正在加载章节列表…', 'Loading chapters…')}</p>
              : loadError ? <div className="blueprint-binding__empty" role="alert">
                <p>{text('蓝图列表读取失败，请重试。', 'Could not load blueprints. Please retry.')}</p>
                <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>{text('重试', 'Retry')}</Button>
              </div> : filtered.length === 0 ? <p className="blueprint-binding__empty">
                {blueprints.length === 0 ? text('暂无章节蓝图，请先在「章节蓝图」中创建。', 'No blueprints yet. Create one in Chapter blueprints first.') : text('没有匹配的章节，试试其他卷、章号或标题。', 'No matching chapters. Try another volume, number or title.')}
              </p> : filtered.map(blueprint => (
                <label key={blueprint.chapterNumber} className="blueprint-binding__row" data-selected={selected === String(blueprint.chapterNumber)}>
                  <input type="radio" name="blueprint-binding" value={blueprint.chapterNumber} checked={selected === String(blueprint.chapterNumber)} disabled={saving} onChange={event => setSelected(event.target.value)} />
                  <span className="blueprint-binding__number">{text(`第 ${blueprint.chapterNumber} 章`, `Ch. ${blueprint.chapterNumber}`)}</span>
                  <span className="blueprint-binding__title"><span>{blueprint.title || text('未命名蓝图', 'Untitled blueprint')}</span><span className="blueprint-binding__volume-name">{volumeName(blueprint.volumeId)}</span></span>
                  {current === String(blueprint.chapterNumber) && <span className="blueprint-binding__badge">{text('当前', 'Current')}</span>}
                  <Check size={16} className="blueprint-binding__check" aria-hidden="true" />
                </label>
              ))}
          </div>
        </div>
        <DialogFooter className="blueprint-binding__footer">
          <p className="blueprint-binding__pending" aria-live="polite">{selected ? text(`待绑定：${chapterLabel(selected)}`, `Link to: ${chapterLabel(selected)}`) : current ? text('待解除当前绑定', 'Ready to unlink') : text('请选择一个章节蓝图', 'Select a chapter blueprint')}</p>
          <div className="blueprint-binding__buttons">
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{text('取消', 'Cancel')}</Button>
            <Button onClick={() => void save()} disabled={!canSave}>{saving ? text('保存中...', 'Saving...') : !selected && current ? text('确认解绑', 'Confirm unlink') : text('确认绑定', 'Confirm link')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
