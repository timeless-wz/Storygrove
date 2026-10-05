import { cn } from '../../lib/utils'
import VditorProseEditor, { type VditorProseEditorProps } from './VditorProseEditor'

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
  /** Kept for existing page-level character counters. */
  onCharCountChange?: VditorProseEditorProps['onCharCountChange']
  /** Kept for existing editor navigation and selection integrations. */
  editorRef?: VditorProseEditorProps['editorRef']
  jumpTarget?: VditorProseEditorProps['jumpTarget']
  insertRequest?: VditorProseEditorProps['insertRequest']
  className?: string
}

/**
 * Shared controlled Markdown editing entry point. This thin preparation wrapper
 * deliberately delegates persistence to its caller and the editing kernel to
 * VditorProseEditor; the core owner will add the outline shell behind this API.
 */
export default function DocumentEditingSurface({
  documentIdentity,
  layout,
  content,
  onChange,
  onSave,
  editable,
  placeholder,
  showHeadingToc,
  onCharCountChange,
  editorRef,
  jumpTarget,
  insertRequest,
  className,
}: DocumentEditingSurfaceProps) {
  const headingTocEnabled = showHeadingToc ?? layout === 'long-document'

  return (
    <div
      key={documentIdentity}
      className={cn('document-editing-surface h-full min-h-0 min-w-0 w-full overflow-hidden', className)}
      data-document-layout={layout}
      data-heading-toc={headingTocEnabled ? 'enabled' : 'disabled'}
    >
      <VditorProseEditor
        content={content}
        onChange={onChange}
        onSave={onSave}
        editable={editable}
        placeholder={placeholder}
        onCharCountChange={onCharCountChange}
        editorRef={editorRef}
        jumpTarget={jumpTarget}
        insertRequest={insertRequest}
        className="h-full min-h-0"
      />
    </div>
  )
}
