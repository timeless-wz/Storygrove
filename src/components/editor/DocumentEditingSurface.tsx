import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, List } from 'lucide-react'

import { analyzeProjectDocumentMarkdown } from '../../shared/project-documents'
import { useLocaleStore } from '../../stores/locale-store'
import { cn } from '../../lib/utils'
import VditorProseEditor, { type VditorProseEditorProps } from './VditorProseEditor'
import './document-editing-surface.css'

export type DocumentEditingLayout = 'long-document' | 'business-field'

export interface DocumentEditingSurfaceProps {
  /** Stable identity that changes when project, entity, field, or document changes. */
  documentIdentity: string
  layout: DocumentEditingLayout
  content: string
  onChange?: VditorProseEditorProps['onChange']
  onSave?: VditorProseEditorProps['onSave']
  editable?: VditorProseEditorProps['editable']
  placeholder?: VditorProseEditorProps['placeholder']
  /** Defaults on for long documents and off for business fields. */
  showHeadingToc?: boolean
  /** Reports the heading currently at the editor's reading position. */
  onActiveHeadingChange?: VditorProseEditorProps['onActiveHeadingChange']
  /** Kept for existing page-level character counters. */
  onCharCountChange?: VditorProseEditorProps['onCharCountChange']
  /** Kept for existing page navigation and selection integrations. */
  editorRef?: VditorProseEditorProps['editorRef']
  jumpTarget?: VditorProseEditorProps['jumpTarget']
  insertRequest?: VditorProseEditorProps['insertRequest']
  className?: string
}

/**
 * Shared controlled Markdown editing entry point. It owns only editor chrome,
 * an optional outline, and Markdown interaction; persistence stays with callers.
 */
export default function DocumentEditingSurface(props: DocumentEditingSurfaceProps) {
  return <DocumentEditingSurfaceSession key={props.documentIdentity} {...props} />
}

function DocumentEditingSurfaceSession({
  documentIdentity,
  layout,
  content,
  onChange,
  onSave,
  editable,
  placeholder,
  showHeadingToc,
  onActiveHeadingChange,
  onCharCountChange,
  editorRef,
  jumpTarget,
  insertRequest,
  className,
}: DocumentEditingSurfaceProps) {
  const text = useLocaleStore(s => s.text)
  const rootRef = useRef<HTMLDivElement>(null)
  const navId = useId()
  const headingTocEnabled = showHeadingToc ?? layout === 'long-document'
  const canEdit = editable ?? true

  // Mirror the editor's live value for the outline without feeding each keystroke
  // back through Vditor's external-content synchronization path.
  const [outlineContent, setOutlineContent] = useState(content)
  const previousContentPropRef = useRef(content)
  useLayoutEffect(() => {
    if (previousContentPropRef.current === content) return
    previousContentPropRef.current = content
    setOutlineContent(content)
  }, [content])

  const analysis = useMemo(() => analyzeProjectDocumentMarkdown(outlineContent), [outlineContent])
  const [outlineOpen, setOutlineOpen] = useState(headingTocEnabled)
  const previousTocEnabledRef = useRef(headingTocEnabled)
  const lastCompactRef = useRef<boolean | null>(null)
  const jumpSequenceRef = useRef(0)
  const lastExternalJumpRequestRef = useRef<number | null>(null)
  const [activeJumpTarget, setActiveJumpTarget] = useState<VditorProseEditorProps['jumpTarget']>(null)
  const [activeHeading, setActiveHeading] = useState<{ line: number; index: number; text: string } | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

  const headingGroupIds = useMemo(() => {
    return analysis.headings.map((heading, index) => {
      if (heading.level <= 2) return heading.level === 2 ? `${heading.line}:${heading.id}` : null

      let previousIndex = index - 1
      while (previousIndex >= 0 && analysis.headings[previousIndex].level > 2) previousIndex -= 1
      const parent = analysis.headings[previousIndex]
      return parent?.level === 2 ? `${parent.line}:${parent.id}` : null
    })
  }, [analysis.headings])

  const headingsWithChildren = useMemo(() => {
    const groups = new Set<string>()
    analysis.headings.forEach((heading, index) => {
      if (heading.level !== 2) return
      let hasH3 = false
      for (const next of analysis.headings.slice(index + 1)) {
        if (next.level <= 2) break
        if (next.level === 3) { hasH3 = true; break }
      }
      if (hasH3) groups.add(`${heading.line}:${heading.id}`)
    })
    return groups
  }, [analysis.headings])

  useLayoutEffect(() => {
    if (previousTocEnabledRef.current !== headingTocEnabled) {
      previousTocEnabledRef.current = headingTocEnabled
      setOutlineOpen(headingTocEnabled)
    }
  }, [headingTocEnabled])

  useLayoutEffect(() => {
    if (!headingTocEnabled) return
    const root = rootRef.current
    if (!root) return

    const syncResponsiveDefault = (width: number) => {
      if (width <= 0) return
      const compact = width <= 768
      if (lastCompactRef.current === null || lastCompactRef.current !== compact) {
        lastCompactRef.current = compact
        setOutlineOpen(!compact)
      }
    }

    syncResponsiveDefault(root.getBoundingClientRect().width || root.clientWidth)

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(entries => {
        const entry = entries[0]
        if (entry) syncResponsiveDefault(entry.contentRect.width)
      })
      observer.observe(root)
      return () => observer.disconnect()
    }

    const handleResize = () => syncResponsiveDefault(root.getBoundingClientRect().width || root.clientWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [headingTocEnabled])

  const handleChange = useCallback((markdown: string) => {
    if (!canEdit) return
    setOutlineContent(markdown)
    onChange?.(markdown)
  }, [canEdit, onChange])

  const handleHeadingClick = useCallback((heading: { line: number; text: string }, index: number) => {
    jumpSequenceRef.current += 1
    setActiveJumpTarget({
      line: heading.line,
      index,
      text: heading.text,
      requestId: jumpSequenceRef.current,
    })
  }, [])

  const handleActiveHeadingChange = useCallback((heading: { line: number; index: number; text: string } | null) => {
    setActiveHeading(heading)
    onActiveHeadingChange?.(heading)
  }, [onActiveHeadingChange])

  useLayoutEffect(() => {
    if (!jumpTarget || lastExternalJumpRequestRef.current === jumpTarget.requestId) return
    lastExternalJumpRequestRef.current = jumpTarget.requestId
    jumpSequenceRef.current += 1
    setActiveJumpTarget({ ...jumpTarget, requestId: jumpSequenceRef.current })
  }, [jumpTarget])

  return (
    <div
      ref={rootRef}
      className={cn('document-editing-surface', className)}
      data-document-layout={layout}
      data-document-identity={documentIdentity}
      data-heading-toc={headingTocEnabled ? 'enabled' : 'disabled'}
      data-outline-open={outlineOpen ? 'true' : 'false'}
      data-editable={canEdit ? 'true' : 'false'}
    >
      <div className="document-editing-surface__body">
        {headingTocEnabled && (
          <aside
            className={cn('document-editing-surface__outline', outlineOpen && 'is-open')}
            data-outline-panel={outlineOpen ? 'open' : 'collapsed'}
          >
            <div className="document-editing-surface__outline-header">
              {outlineOpen && (
                <span className="document-editing-surface__outline-title">
                  {text('文档目录', 'Document outline')}
                </span>
              )}
              <button
                type="button"
                className="document-editing-surface__outline-toggle"
                aria-expanded={outlineOpen}
                aria-controls={navId}
                aria-label={outlineOpen
                  ? text('收起文档目录', 'Collapse document outline')
                  : text('展开文档目录', 'Expand document outline')}
                title={outlineOpen
                  ? text('收起文档目录', 'Collapse document outline')
                  : text('展开文档目录', 'Expand document outline')}
                onClick={() => setOutlineOpen(open => !open)}
              >
                <List size={14} aria-hidden="true" />
              </button>
            </div>
            <nav
              id={navId}
              aria-label={text('文档目录', 'Document outline')}
              className="document-editing-surface__outline-nav"
              hidden={!outlineOpen}
            >
              {analysis.headings.length === 0 ? (
                <div className="document-editing-surface__outline-empty">
                  {text('使用 # 至 ###### 添加标题后即可生成目录。', 'Add headings with # through ###### to build an outline.')}
                </div>
              ) : analysis.headings.map((heading, index) => {
                const groupId = headingGroupIds[index]
                const headingKey = `${heading.line}:${heading.id}`
                const isHidden = heading.level >= 3 && !!groupId && collapsedGroups.has(groupId)
                const hasChildren = headingsWithChildren.has(headingKey)
                const isActive = activeHeading?.line === heading.line && activeHeading.index === index
                if (isHidden) return null
                return (
                  <div
                    key={headingKey}
                    className={`document-editing-surface__heading-row document-editing-surface__heading-row--h${heading.level}`}
                    data-heading-level={heading.level}
                  >
                    <button
                      type="button"
                      onClick={() => handleHeadingClick(heading, index)}
                      className={`document-editing-surface__heading${heading.level === 2 ? ' is-primary' : ''}${isActive ? ' is-active' : ''}`}
                      style={{ paddingInlineStart: `${6 + (heading.level - 1) * 10}px` }}
                      title={heading.text}
                      aria-current={isActive ? 'location' : undefined}
                    >
                      {heading.text}
                    </button>
                    {hasChildren && (
                      <button
                        type="button"
                        className="document-editing-surface__group-toggle"
                        aria-label={collapsedGroups.has(headingKey)
                          ? text(`展开「${heading.text}」下的小标题`, `Expand subsections under “${heading.text}”`)
                          : text(`折叠「${heading.text}」下的小标题`, `Collapse subsections under “${heading.text}”`)}
                        aria-expanded={!collapsedGroups.has(headingKey)}
                        onClick={() => setCollapsedGroups(previous => {
                          const next = new Set(previous)
                          if (next.has(headingKey)) next.delete(headingKey)
                          else next.add(headingKey)
                          return next
                        })}
                      >
                        {collapsedGroups.has(headingKey)
                          ? <ChevronRight size={12} aria-hidden="true" />
                          : <ChevronDown size={12} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                )
              })}
            </nav>
          </aside>
        )}

        <div className="document-editing-surface__editor">
          <VditorProseEditor
            key={documentIdentity}
            content={content}
            onChange={canEdit ? handleChange : undefined}
            onSave={canEdit ? onSave : undefined}
            editable={editable}
            placeholder={placeholder}
            onCharCountChange={onCharCountChange}
            onActiveHeadingChange={handleActiveHeadingChange}
            editorRef={editorRef}
            jumpTarget={activeJumpTarget}
            insertRequest={canEdit ? insertRequest : undefined}
            className="h-full min-h-0"
          />
        </div>
      </div>
    </div>
  )
}
