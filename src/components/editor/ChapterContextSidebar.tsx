/**
 * 本章创作上下文 — 正文写作界面的只读侧栏。
 *
 * 它回答一个问题：**我现在写的这一章，蓝图到底要求了什么？**
 * 因此只呈现四项写作时最需要的信息（本章目标、关键事件/节拍、场景顺序、
 * 章尾悬念），并给出到蓝图与章内场景画布的准确跳转入口。
 *
 * 边界：
 * - 只读。这里没有第二套保存逻辑，不会写草稿、蓝图或画布。
 * - 不猜来源。未绑定蓝图时只说明未绑定并给出绑定入口，不按章号显示别的资料。
 * - 没有数据就说没有数据；绝不生成占位的情节内容。
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Anchor, BookOpen, Compass, Layers, Link2, ListOrdered, Target, Unlink, X } from 'lucide-react'

import type { ChapterContextState } from '../../services/chapter-context'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'

export interface ChapterContextSidebarProps {
  /** 侧栏是否展开。收起时调用方不渲染本组件。 */
  open: boolean
  onCollapse: () => void
  /**
   * 窄屏以抽屉呈现：覆盖在正文之上而不是挤压正文宽度，
   * 并带遮罩、Esc 关闭与焦点回收。
   */
  asDrawer?: boolean
  /** 数据状态；`loading` 时绝不显示上一章或上一项目的内容。 */
  state: ChapterContextState
  onOpenBlueprint: () => void
  onOpenCanvas: () => void
  onOpenBindingDialog: () => void
}

function SectionHeading({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <h3 className="chapter-context-section-heading">
      <span className="chapter-context-section-icon" aria-hidden="true">{icon}</span>
      {label}
    </h3>
  )
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="chapter-context-empty">{children}</p>
}

/** 侧栏正文：按状态分流；这里的每一种状态都各自说明得清楚，不留猜测空间。 */
function ChapterContextBody({
  state,
  onOpenBindingDialog,
}: {
  state: ChapterContextState
  onOpenBindingDialog: () => void
}) {
  const text = useLocaleStore(s => s.text)

  if (state.status === 'loading') {
    return (
      <p className="chapter-context-status" role="status" data-testid="chapter-context-loading">
        {text('正在读取本章蓝图要点…', 'Loading this chapter’s blueprint…')}
      </p>
    )
  }

  if (state.status === 'session-lost') {
    // 会话已失效（切章 / 切项目）。这里不显示任何章节内容，只说明状态。
    return (
      <p className="chapter-context-status" role="status" data-testid="chapter-context-session-lost">
        {text('项目会话已切换，请重新打开本章草稿。', 'The project session changed. Reopen this draft.')}
      </p>
    )
  }

  if (state.status === 'load-error') {
    return (
      <p className="chapter-context-status" role="status" data-testid="chapter-context-load-error">
        {text('蓝图读取失败。请重新打开本章草稿再试。', 'Could not load the blueprint. Reopen this draft and try again.')}
      </p>
    )
  }

  if (state.status === 'unbound') {
    return (
      <div className="chapter-context-notice" data-testid="chapter-context-unbound">
        <div className="chapter-context-notice-head">
          <Unlink size={13} aria-hidden="true" />
          <span>{text('未绑定蓝图', 'No blueprint linked')}</span>
        </div>
        <p className="chapter-context-empty">
          {text(
            '这份草稿没有关联章节蓝图。绑定后，本章目标、关键事件、场景顺序与章尾悬念会显示在这里。',
            'This draft is not linked to a chapter blueprint. Once linked, its goal, key events, scene order and ending hook appear here.',
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenBindingDialog}
          data-testid="chapter-context-bind"
          className="chapter-context-notice-action"
        >
          <Link2 size={11} aria-hidden="true" />
          {text('绑定章节蓝图', 'Link a blueprint')}
        </Button>
      </div>
    )
  }

  if (state.status === 'target-missing') {
    return (
      <div className="chapter-context-notice" data-testid="chapter-context-target-missing">
        <div className="chapter-context-notice-head">
          <Unlink size={13} aria-hidden="true" />
          <span>{text('绑定目标已不存在', 'Linked blueprint is gone')}</span>
        </div>
        <p className="chapter-context-empty">
          {text(
            `这份草稿绑定的第 ${state.blueprintChapterNumber} 章蓝图已被删除或清理，因此没有可显示的要点。`,
            `The Chapter ${state.blueprintChapterNumber} blueprint this draft points at no longer exists, so there are no notes to show.`,
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenBindingDialog}
          data-testid="chapter-context-rebind"
          className="chapter-context-notice-action"
        >
          <Link2 size={11} aria-hidden="true" />
          {text('重新绑定蓝图', 'Link another blueprint')}
        </Button>
      </div>
    )
  }

  const { blueprint, scenes, scenesLoadFailed } = state
  return (
    <>
      <div className="chapter-context-blueprint-head" data-testid="chapter-context-blueprint-head">
        <span className="chapter-context-chapter-no">
          {text(`第${blueprint.chapterNumber}章`, `Ch. ${blueprint.chapterNumber}`)}
        </span>
        <span className="chapter-context-chapter-title" title={blueprint.title || undefined}>
          {blueprint.title || text('未命名蓝图', 'Untitled blueprint')}
        </span>
      </div>

      {blueprint.role && (
        <div className="chapter-context-tags">
          <span className="chapter-context-tag">{blueprint.role}</span>
        </div>
      )}

      <section className="chapter-context-section">
        <SectionHeading icon={<Target size={12} />} label={text('本章目标', 'Chapter goal')} />
        {blueprint.purpose.trim()
          ? <p className="chapter-context-text" data-testid="chapter-context-purpose">{blueprint.purpose}</p>
          : <EmptyHint>{text('蓝图未填写本章目标。', 'This blueprint has no chapter goal.')}</EmptyHint>}
      </section>

      <section className="chapter-context-section">
        <SectionHeading icon={<ListOrdered size={12} />} label={text('关键事件 / 节拍', 'Key events / beats')} />
        {blueprint.beats.length > 0 ? (
          <ol className="chapter-context-beats" data-testid="chapter-context-beats">
            {blueprint.beats.map((beat, index) => (
              <li key={`${index}-${beat}`} className="chapter-context-beat">{beat}</li>
            ))}
          </ol>
        ) : (
          <EmptyHint>{text('蓝图未填写关键事件。', 'This blueprint has no key events.')}</EmptyHint>
        )}
      </section>

      <section className="chapter-context-section">
        <SectionHeading icon={<Compass size={12} />} label={text('场景顺序', 'Scene order')} />
        {scenesLoadFailed ? (
          <EmptyHint>
            {text('场景画布读取失败，请打开场景画布确认。', 'Could not read the scene canvas. Open it to check.')}
          </EmptyHint>
        ) : scenes.length > 0 ? (
          <ol className="chapter-context-scenes" data-testid="chapter-context-scenes">
            {scenes.map((scene, index) => (
              <li key={scene.id} className="chapter-context-scene">
                <span className="chapter-context-scene-index" aria-hidden="true">{index + 1}</span>
                <span className="chapter-context-scene-main">
                  <span className="chapter-context-scene-title">
                    {scene.title || text('未命名场景', 'Untitled scene')}
                    {scene.role && <span className="chapter-context-scene-role">{scene.role}</span>}
                  </span>
                  {scene.summary && (
                    <span className="chapter-context-scene-summary">{scene.summary}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyHint>
            {text('本章还没有场景卡。', 'No scene cards for this chapter yet.')}
          </EmptyHint>
        )}
      </section>

      <section className="chapter-context-section">
        <SectionHeading icon={<Anchor size={12} />} label={text('章尾悬念', 'Ending hook')} />
        {blueprint.suspenseHook.trim()
          ? <p className="chapter-context-text" data-testid="chapter-context-hook">{blueprint.suspenseHook}</p>
          : <EmptyHint>{text('蓝图未填写章尾悬念。', 'This blueprint has no ending hook.')}</EmptyHint>}
      </section>

      {blueprint.characters.length > 0 && (
        <section className="chapter-context-section">
          <SectionHeading icon={<Layers size={12} />} label={text('出场关键人', 'Key characters')} />
          <div className="chapter-context-tags">
            {blueprint.characters.map(name => (
              <span key={name} className="chapter-context-tag">{name}</span>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

export function ChapterContextSidebar({
  open,
  onCollapse,
  asDrawer = false,
  state,
  onOpenBlueprint,
  onOpenCanvas,
  onOpenBindingDialog,
}: ChapterContextSidebarProps) {
  const text = useLocaleStore(s => s.text)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  // 抽屉打开时把焦点移入侧栏，关闭后还给作者原来的位置。
  useEffect(() => {
    if (!asDrawer || !open) return
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    return () => {
      previouslyFocusedRef.current?.focus?.()
      previouslyFocusedRef.current = null
    }
  }, [asDrawer, open])

  useEffect(() => {
    if (!asDrawer || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCollapse()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [asDrawer, onCollapse, open])

  if (!open) return null

  const content = (
    <>
      <div className="chapter-context-header">
        <div className="chapter-context-header-title">
          <Layers size={13} className="chapter-context-header-icon" aria-hidden="true" />
          <span>{text('本章创作上下文', 'Chapter writing context')}</span>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="chapter-context-icon-btn"
          onClick={onCollapse}
          aria-label={text('收起本章创作上下文', 'Collapse chapter writing context')}
          title={text('收起（Esc）', 'Collapse (Esc)')}
          data-testid="chapter-context-collapse"
        >
          <X size={13} />
        </button>
      </div>

      <div className="chapter-context-body">
        <ChapterContextBody state={state} onOpenBindingDialog={onOpenBindingDialog} />
      </div>

      {state.status === 'ready' && (
        <div className="chapter-context-footer">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenBlueprint}
            className="chapter-context-jump"
            data-testid="chapter-context-open-blueprint"
            title={text(
              `打开第${state.blueprintChapterNumber}章蓝图并定位到该章`,
              `Open the Chapter ${state.blueprintChapterNumber} blueprint`,
            )}
          >
            <BookOpen size={11} aria-hidden="true" />
            {text('打开蓝图', 'Open blueprint')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenCanvas}
            className="chapter-context-jump"
            data-testid="chapter-context-open-canvas"
            title={text(
              `打开第${state.blueprintChapterNumber}章的章内场景画布`,
              `Open the in-chapter scene canvas for Chapter ${state.blueprintChapterNumber}`,
            )}
          >
            <Compass size={11} aria-hidden="true" />
            {text('打开场景画布', 'Open scene canvas')}
          </Button>
        </div>
      )}
    </>
  )

  if (asDrawer) {
    return (
      <>
        <div
          className="chapter-context-backdrop"
          data-testid="chapter-context-backdrop"
          onClick={onCollapse}
          aria-hidden="true"
        />
        <aside
          id="chapter-context-panel"
          className="chapter-context chapter-context--drawer"
          role="dialog"
          aria-modal="true"
          aria-label={text('本章创作上下文', 'Chapter writing context')}
          data-testid="chapter-context-drawer"
        >
          {content}
        </aside>
      </>
    )
  }

  return (
    <aside
      id="chapter-context-panel"
      className="chapter-context chapter-context--inline"
      aria-label={text('本章创作上下文', 'Chapter writing context')}
      data-testid="chapter-context-sidebar"
    >
      {content}
    </aside>
  )
}

export default ChapterContextSidebar
