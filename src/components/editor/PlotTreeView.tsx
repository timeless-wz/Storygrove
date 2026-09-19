import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Loader2,
  RefreshCw,
  Trash2,
  BookOpen,
  FileText,
  ExternalLink,
  Plus,
} from 'lucide-react'

import type { ModelProfile } from '../../shared/ipc-channels'
import type {
  PlotTreeEvent,
  PlotTreeSnapshot,
  PlotTreeSourceReference,
} from '../../shared/plot-tree'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/Dialog'

const CHAPTER_WIDTH = 136
const CHAPTER_WINDOW_SIZE = 40

interface PlotTreeViewProps {
  snapshot: PlotTreeSnapshot | null
  sourceRevision: string
  currentChapter: number
  models?: ModelProfile[]
  selectedModelId?: string | null
  busy?: boolean
  error?: string
  sourceReady?: boolean
  storedSnapshotInvalid?: boolean
  onModelChange?: (modelId: string) => void
  onGenerate: () => void
  onClear: () => void
  onOpenSource: (source: PlotTreeSourceReference) => void
  onNewStoryline?: () => void
}

function sourceLabel(source: PlotTreeSourceReference, text: (zh: string, en: string) => string): string {
  if (source.type === 'blueprint') {
    return text(`第 ${source.chapterNumber} 章蓝图`, `Chapter ${source.chapterNumber} blueprint`)
  }
  if (source.type === 'finalized-chapter') {
    return text(`第 ${source.chapterNumber} 章定稿`, `Chapter ${source.chapterNumber} finalized draft`)
  }
  return text(`叙事线索 #${source.planId}`, `Narrative thread #${source.planId}`)
}

export default function PlotTreeView({
  snapshot,
  sourceRevision,
  currentChapter,
  busy = false,
  error = '',
  sourceReady = true,
  storedSnapshotInvalid = false,
  onGenerate,
  onClear,
  onOpenSource,
  onNewStoryline,
}: PlotTreeViewProps) {
  const text = useLocaleStore(state => state.text)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [selectedEvent, setSelectedEvent] = useState<PlotTreeEvent | null>(null)
  const [requestedWindowStart, setRequestedWindowStart] = useState<number | null>(null)

  const allChapters = useMemo(() => {
    const values = new Set<number>()
    const add = (chapter: number) => {
      if (Number.isSafeInteger(chapter) && chapter >= 1) values.add(chapter)
    }
    add(currentChapter)
    for (const track of snapshot?.tracks ?? []) {
      add(track.startChapter)
      add(track.endChapter)
      for (const event of track.events) add(event.chapterNumber)
    }
    return [...values].sort((left, right) => left - right)
  }, [currentChapter, snapshot])

  const currentIndex = allChapters.findIndex(chapter => chapter >= currentChapter)
  const centeredWindowStart = Math.max(0, currentIndex - Math.floor(CHAPTER_WINDOW_SIZE / 2))
  const maximumWindowStart = Math.max(0, allChapters.length - CHAPTER_WINDOW_SIZE)
  const chapterWindowStart = Math.min(requestedWindowStart ?? centeredWindowStart, maximumWindowStart)
  const chapters = allChapters.slice(chapterWindowStart, chapterWindowStart + CHAPTER_WINDOW_SIZE)
  const stale = Boolean(snapshot && snapshot.sourceRevision !== sourceRevision)

  useEffect(() => {
    if (!viewportRef.current) return
    const curIdx = chapters.indexOf(currentChapter)
    viewportRef.current.scrollLeft = Math.max(0, (curIdx - 1) * CHAPTER_WIDTH)
  }, [chapters, currentChapter])

  return (
    <section className="space-y-4">
      {/* Top Toolbar */}
      <div
        className="rounded-lg border p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch size={16} style={{ color: 'var(--color-accent)' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {text('剧情树与时间线可视化', 'Plot Tree & Timeline')}
              </h3>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              {text(
                '确定性算法构建：直接由全部章节蓝图、正文定稿与叙事线索实时投影，第 1—58 章自动聚合成第一卷主线，完全不依赖任何大模型。',
                'Deterministic projection: directly derived from blueprints, finalized chapters, and narrative threads without calling AI models.',
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onNewStoryline && (
              <Button variant="outline" size="sm" onClick={onNewStoryline}>
                <Plus size={13} />
                {text('新建故事线/支线', 'New Storyline')}
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={onGenerate}
              disabled={busy || !sourceReady}
              title={text('重新从蓝图与正文计算剧情树', 'Rebuild plot tree from blueprints and drafts')}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              <span>{snapshot ? text('重建剧情树', 'Rebuild Plot Tree') : text('生成剧情树', 'Build Plot Tree')}</span>
            </Button>

            {snapshot && (
              <Button variant="outline" size="sm" onClick={onClear} disabled={busy}>
                <Trash2 size={13} />
                {text('清除剧情树', 'Clear Plot Tree')}
              </Button>
            )}
          </div>
        </div>

        {stale && (
          <p role="status" className="text-xs text-[var(--color-warning-text)] bg-[var(--color-hover)] px-2.5 py-1.5 rounded flex items-center justify-between">
            <span>{text('章节蓝图或正文资料已更新，可点击「重建剧情树」刷新时间线。', 'Sources have changed. Click “Rebuild Plot Tree” to refresh.')}</span>
            <button
              type="button"
              className="text-[11px] underline font-medium hover:opacity-80"
              onClick={onGenerate}
            >
              {text('立即重建', 'Rebuild now')}
            </button>
          </p>
        )}

        {!sourceReady && (
          <p role="status" className="text-xs text-[var(--color-warning-text)]">
            {text('请先添加章节蓝图、定稿或叙事线索，再构建剧情树。', 'Add a chapter blueprint, finalized chapter, or narrative thread before generating a plot tree.')}
          </p>
        )}

        {storedSnapshotInvalid && (
          <p role="alert" className="text-xs text-[var(--color-warning-text)]">
            {text('旧剧情树快照无法安全显示，已隔离；作者资料未被修改，请点击「重建剧情树」。', 'The stored plot-tree snapshot could not be displayed safely. Click “Rebuild Plot Tree” to recreate it.')}
          </p>
        )}

        {error && <p role="alert" className="text-xs text-[var(--color-error-text)]">{error}</p>}
      </div>

      {!snapshot && (
        <div
          className="rounded-lg border px-4 py-12 text-center text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
        >
          <GitBranch size={32} className="mx-auto mb-2 opacity-40" />
          <p>{text('尚未生成剧情树', 'No plot tree built yet')}</p>
          <Button variant="default" size="sm" className="mt-3" onClick={onGenerate} disabled={busy || !sourceReady}>
            <RefreshCw size={13} />
            {text('从蓝图与正文立即生成剧情树', 'Build Plot Tree Now')}
          </Button>
        </div>
      )}

      {snapshot && (
        <div className="space-y-2">
          {allChapters.length > CHAPTER_WINDOW_SIZE && (
            <div className="flex items-center justify-end gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <Button
                size="sm"
                variant="outline"
                disabled={chapterWindowStart === 0}
                onClick={() => setRequestedWindowStart(Math.max(0, chapterWindowStart - CHAPTER_WINDOW_SIZE))}
              >
                <ChevronLeft size={13} />{text('上一组章节', 'Previous chapters')}
              </Button>
              <span>{text(
                `显示 ${chapters[0]}–${chapters.at(-1)} 章（共 ${allChapters.length} 个章节）`,
                `Showing Chapters ${chapters[0]}–${chapters.at(-1)} (${allChapters.length} chapters)`,
              )}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={chapterWindowStart + CHAPTER_WINDOW_SIZE >= allChapters.length}
                onClick={() => setRequestedWindowStart(Math.min(
                  maximumWindowStart,
                  chapterWindowStart + CHAPTER_WINDOW_SIZE,
                ))}
              >
                {text('下一组章节', 'Next chapters')}<ChevronRight size={13} />
              </Button>
            </div>
          )}

          <div
            ref={viewportRef}
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <table
              className="border-collapse text-xs"
              style={{ minWidth: 208 + chapters.length * CHAPTER_WIDTH, tableLayout: 'fixed' }}
            >
              <thead>
                <tr style={{ background: 'var(--color-panel)' }}>
                  <th
                    className="sticky left-0 z-10 w-52 border-b border-r px-3 py-2 text-left"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
                  >
                    {text('主线 / 故事线', 'Main / Subplot')}
                  </th>
                  {chapters.map(chapter => (
                    <th
                      key={chapter}
                      className="border-b border-r px-2 py-2 text-center font-medium"
                      style={{
                        width: CHAPTER_WIDTH,
                        borderColor: 'var(--color-border)',
                        color: chapter === currentChapter ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      }}
                    >
                      <div className="text-[11px] font-semibold">第 {chapter} 章</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.tracks.map(track => (
                  <tr key={track.id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <th
                      className="sticky left-0 z-10 border-r px-3 py-2.5 text-left font-normal"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
                    >
                      <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--color-text)' }}>
                        <GitBranch size={13} className={track.role === 'main' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'} />
                        <span className="truncate">{track.title}</span>
                      </div>
                      <div className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5">
                        {track.role === 'main' ? text('主线轨道', 'Main Track') : text('支线/暗线', 'Subplot')} · {track.startChapter}–{track.endChapter} 章
                      </div>
                    </th>

                    {chapters.map(chapter => {
                      const events = track.events.filter(event => event.chapterNumber === chapter)
                      return (
                        <td
                          key={chapter}
                          className="border-r p-1.5 align-top"
                          style={{
                            borderColor: 'var(--color-border)',
                            background: chapter < track.startChapter || chapter > track.endChapter
                              ? 'var(--color-bg)'
                              : 'transparent',
                          }}
                        >
                          {events.map((event, index) => {
                            const isOccurred = event.status === 'occurred'
                            return (
                              <button
                                key={index}
                                type="button"
                                className="w-full text-left p-1.5 rounded text-[11px] border transition-all hover:scale-[1.02]"
                                style={{
                                  borderColor: isOccurred ? 'rgba(34, 197, 94, 0.4)' : 'rgba(99, 102, 241, 0.4)',
                                  backgroundColor: isOccurred ? 'rgba(34, 197, 94, 0.08)' : 'rgba(99, 102, 241, 0.08)',
                                  color: 'var(--color-text)',
                                }}
                                onClick={() => setSelectedEvent(event)}
                                title={text('点击查看事件详情与回跳入口', 'Click to view event details and jump links')}
                              >
                                <div className="flex items-center justify-between gap-1 mb-0.5">
                                  <span
                                    className="text-[9px] px-1 py-0.2 rounded font-semibold"
                                    style={{
                                      backgroundColor: isOccurred ? 'rgba(34, 197, 94, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                                      color: isOccurred ? 'rgb(34, 197, 94)' : 'rgb(99, 102, 241)',
                                    }}
                                  >
                                    {isOccurred ? text('已定稿', 'Finalized') : text('蓝图规划', 'Planned')}
                                  </span>
                                </div>
                                <p className="line-clamp-2 leading-tight">
                                  {event.summary}
                                </p>
                              </button>
                            )
                          })}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Event Details & Jump Dialog */}
      {selectedEvent && (
        <Dialog open={Boolean(selectedEvent)} onOpenChange={v => !v && setSelectedEvent(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <BookOpen size={16} style={{ color: 'var(--color-accent)' }} />
                <span>
                  {text(`第 ${selectedEvent.chapterNumber} 章 剧情事件`, `Chapter ${selectedEvent.chapterNumber} Plot Event`)}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div>
                <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                  {text('事件状态', 'Event Status')}
                </span>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-medium"
                  style={{
                    backgroundColor: selectedEvent.status === 'occurred' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                    color: selectedEvent.status === 'occurred' ? 'rgb(34, 197, 94)' : 'rgb(99, 102, 241)',
                  }}
                >
                  {selectedEvent.status === 'occurred' ? text('已定稿发生', 'Occurred (Finalized)') : text('蓝图规划中', 'Planned in Blueprint')}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                  {text('事件概要 / 核心内容', 'Summary')}
                </span>
                <p className="p-2.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] leading-5 text-[var(--color-text-secondary)]">
                  {selectedEvent.summary}
                </p>
              </div>

              <div>
                <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                  {text('来源引用与回跳入口', 'Source Citations & Quick Jumps')}
                </span>
                <div className="space-y-1.5">
                  {selectedEvent.sources.map((source, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="w-full flex items-center justify-between p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors text-left"
                      onClick={() => {
                        onOpenSource(source)
                        setSelectedEvent(null)
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {source.type === 'blueprint' && <BookOpen size={13} className="text-[var(--color-accent)]" />}
                        {source.type === 'finalized-chapter' && <FileText size={13} className="text-[var(--color-success-text)]" />}
                        {source.type === 'narrative-thread' && <GitBranch size={13} className="text-[var(--color-info)]" />}
                        <span className="font-medium text-[var(--color-text)]">
                          {sourceLabel(source, text)}
                        </span>
                      </div>
                      <ExternalLink size={12} className="text-[var(--color-text-muted)]" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(null)}>
                {text('关闭', 'Close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
