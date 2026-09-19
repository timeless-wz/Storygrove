/**
 * ProjectDocumentPreview — 项目文档的安全 Markdown 预览
 *
 * 预览按“渲染结果永远可信”设计：
 * - 不启用 `rehype-raw`，原始 HTML 与脚本被完全忽略，永不进入 DOM；
 * - 链接与图片都经过显式 URL 转换，`javascript:`、`data:` 等被清空；
 * - 图片只能来自当前项目受控目录内的 `assets/`，缺失或越界时给出提示
 *   而不是让预览崩溃。
 */

import { useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ImageOff, TriangleAlert } from 'lucide-react'

import {
  analyzeProjectDocumentMarkdown,
  resolveProjectDocumentAssetReference,
} from '../../shared/project-documents'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { readProjectDocumentAsset } from '../../services/project-documents-service'
import {
  captureProjectSession,
  isProjectSessionPath,
} from '../project-session-gate'
import { ErrorBoundary } from '../ErrorBoundary'

const REMOTE_LINK_PROTOCOL = /^(?:https?|mailto|tel):/i

export interface ProjectDocumentPreviewProps {
  markdown: string
  documentPath: string
  projectKey: string
  /** 让标题锚点可被点击跳转；未提供时预览仍可正常渲染。 */
  onHeadingActivate?: (headingId: string) => void
  className?: string
}

/** 图片只能解析到受控目录内的 assets/，其余引用一律视为不可用。 */
function ProjectDocumentImage({
  source,
  alt,
  documentPath,
  projectKey,
}: {
  source: unknown
  alt: string
  documentPath: string
  projectKey: string
}) {
  const text = useLocaleStore(s => s.text)
  const assetReference = useMemo(
    () => resolveProjectDocumentAssetReference(documentPath, source),
    [documentPath, source],
  )
  const requestKey = assetReference ? `${documentPath}\u0000${assetReference}` : null
  // 只保存“最近一次完成的结果”，状态由渲染时派生，effect 里不做同步 setState。
  const [result, setResult] = useState<{ key: string; dataUrl: string | null } | null>(null)

  useEffect(() => {
    if (!assetReference || !requestKey) return
    let cancelled = false
    // 结果只在异步回调里落地，effect 本体不做同步 setState。
    void (async () => {
      const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
      if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) {
        if (!cancelled) setResult({ key: requestKey, dataUrl: null })
        return
      }
      try {
        const response = await readProjectDocumentAsset(projectSession, documentPath, assetReference)
        if (cancelled) return
        setResult({
          key: requestKey,
          dataUrl: response.success && response.dataUrl ? response.dataUrl : null,
        })
      } catch {
        if (!cancelled) setResult({ key: requestKey, dataUrl: null })
      }
    })()
    return () => { cancelled = true }
  }, [assetReference, documentPath, projectKey, requestKey])

  const status: 'unavailable' | 'loading' | 'ready' = !requestKey
    ? 'unavailable'
    : result?.key !== requestKey
      ? 'loading'
      : result.dataUrl ? 'ready' : 'unavailable'

  if (status === 'unavailable') {
    return (
      <span
        role="img"
        data-project-document-image="unavailable"
        aria-label={alt
          ? text(`图片不可用：${alt}`, `Image unavailable: ${alt}`)
          : text('图片不可用', 'Image unavailable')}
        className="my-2 inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-xs"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-hover)',
          color: 'var(--color-text-muted)',
        }}
        title={text(
          '图片路径不在当前项目的受控文档目录内，或文件不存在；预览不会加载它。',
          'The image path is outside this project’s managed documents directory, or the file is missing; it will not be loaded.',
        )}
      >
        <ImageOff size={13} aria-hidden="true" />
        <span className="truncate">{alt || text('图片', 'Image')}</span>
        <span className="flex-shrink-0 opacity-80">{text('不可用', 'unavailable')}</span>
      </span>
    )
  }

  if (status !== 'ready' || !result?.dataUrl) {
    return (
      <span
        className="my-2 inline-block text-xs"
        style={{ color: 'var(--color-text-muted)' }}
        aria-busy="true"
      >
        {text('图片加载中…', 'Loading image…')}
      </span>
    )
  }

  return (
    <img
      src={result.dataUrl}
      alt={alt}
      className="my-2 max-w-full rounded-md border"
      style={{ borderColor: 'var(--color-border)' }}
    />
  )
}

export default function ProjectDocumentPreview({
  markdown,
  documentPath,
  projectKey,
  onHeadingActivate,
  className,
}: ProjectDocumentPreviewProps) {
  const text = useLocaleStore(s => s.text)
  const analysis = useMemo(() => analyzeProjectDocumentMarkdown(markdown), [markdown])

  const components = useMemo(() => ({
    img: ({ src, alt }: { src?: unknown; alt?: string }) => (
      <ProjectDocumentImage
        source={src}
        alt={alt ?? ''}
        documentPath={documentPath}
        projectKey={projectKey}
      />
    ),
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="mt-6 mb-3 text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="mt-6 mb-2 text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="mt-5 mb-2 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{children}</h3>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="mt-4 mb-1.5 text-base font-semibold" style={{ color: 'var(--color-text)' }}>{children}</h4>
    ),
    h5: ({ children }: { children?: React.ReactNode }) => (
      <h5 className="mt-4 mb-1.5 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{children}</h5>
    ),
    h6: ({ children }: { children?: React.ReactNode }) => (
      <h6 className="mt-4 mb-1.5 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{children}</h6>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="my-2 leading-7" style={{ color: 'var(--color-text)' }}>{children}</p>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const activate = onHeadingActivate
      if (href?.startsWith('#') && activate) {
        return (
          <button
            type="button"
            className="underline"
            style={{ color: 'var(--color-accent)' }}
            onClick={() => activate(href.slice(1))}
          >
            {children}
          </button>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
          style={{ color: 'var(--color-accent)' }}
        >
          {children}
        </a>
      )
    },
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote
        className="my-3 border-l-2 pl-3 italic"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
      >
        {children}
      </blockquote>
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="my-3 overflow-x-auto">
        <table
          className="w-full border-collapse text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          {children}
        </table>
      </div>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th
        className="border px-2 py-1 text-left font-semibold"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-hover)' }}
      >
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="border px-2 py-1" style={{ borderColor: 'var(--color-border)' }}>{children}</td>
    ),
    ul: ({ children, className: listClass }: { children?: React.ReactNode; className?: string }) => (
      <ul
        className={`my-2 list-disc pl-6 leading-7 ${listClass?.includes('contains-task-list') ? 'list-none pl-1' : ''}`}
        style={{ color: 'var(--color-text)' }}
      >
        {children}
      </ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="my-2 list-decimal pl-6 leading-7" style={{ color: 'var(--color-text)' }}>{children}</ol>
    ),
    li: ({ children, className: itemClass }: { children?: React.ReactNode; className?: string }) => (
      <li className={itemClass?.includes('task-list-item') ? 'list-none' : undefined}>{children}</li>
    ),
    input: ({ checked, type }: { checked?: boolean; type?: string }) => (
      type === 'checkbox'
        ? <input type="checkbox" checked={!!checked} readOnly disabled className="mr-2 align-middle" />
        : null
    ),
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre
        className="my-3 overflow-x-auto rounded-md border p-3 text-xs leading-6"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-hover)',
          color: 'var(--color-text)',
        }}
      >
        {children}
      </pre>
    ),
    code: ({ children, className: codeClass }: { children?: React.ReactNode; className?: string }) => {
      const isBlock = typeof codeClass === 'string' && codeClass.startsWith('language-')
      if (isBlock) return <code className={codeClass}>{children}</code>
      return (
        <code
          className="rounded px-1 py-0.5 text-[0.9em]"
          style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)' }}
        >
          {children}
        </code>
      )
    },
  }), [documentPath, onHeadingActivate, projectKey])

  return (
    <div className={className} data-project-document-preview={documentPath}>
      {analysis.issues.length > 0 && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-hover)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <TriangleAlert size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            {text('Markdown 结构提示：', 'Markdown structure notice: ')}
            {analysis.issues.map(issue => issue.message).join(' ')}
          </span>
        </div>
      )}
      <ErrorBoundary fallbackLabel={text('预览渲染出错', 'Preview failed to render')}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          // 原始 HTML 直接忽略：预览中不存在可执行的嵌入内容。
          skipHtml
          urlTransform={(url, key) => {
            if (key === 'src') {
              // 只有解析到受控目录 assets/ 的相对引用才放行；图片组件随后按项目会话读取。
              return resolveProjectDocumentAssetReference(documentPath, url) ? url : ''
            }
            if (REMOTE_LINK_PROTOCOL.test(url)) return url
            if (url.startsWith('#')) return url
            return ''
          }}
          components={components}
        >
          {markdown}
        </Markdown>
      </ErrorBoundary>
    </div>
  )
}
