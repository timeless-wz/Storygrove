/**
 * project-documents — 项目 Markdown 文档的共享契约
 *
 * 作者的自由 Markdown 资料只属于当前项目，存放在项目受控目录
 * `<项目目录>/.vela/documents/`。本模块只做路径与文本的纯计算：
 * 任何真实文件系统访问都必须经过主进程的项目会话与边界校验。
 */

/** 自由 Markdown 文档的受控目录（项目相对，posix 分隔符）。 */
export const PROJECT_DOCUMENTS_DIRECTORY = '.vela/documents'

/** 文档内图片等附件的受控目录。 */
export const PROJECT_DOCUMENT_ASSETS_DIRECTORY = '.vela/documents/assets'

/** Markdown 图片引用相对文档根的前缀。 */
export const PROJECT_DOCUMENT_ASSETS_REFERENCE_PREFIX = 'assets/'

export const PROJECT_DOCUMENT_TITLE_MAX_LENGTH = 120

export const MARKDOWN_DOCUMENT_EXTENSIONS = ['.md', '.markdown'] as const

/** 预览允许的图片扩展名；其它类型按“图片不可用”处理。 */
export const PROJECT_DOCUMENT_IMAGE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg',
] as const

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

/** 单张图片进入预览的体积上限；超过则提示而不加载。 */
export const PROJECT_DOCUMENT_ASSET_MAX_BYTES = 8 * 1024 * 1024

const MAX_DOCUMENT_PATH_LENGTH = 1024
const MAX_DOCUMENT_PATH_SEGMENTS = 16
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
/** `scheme:` 前缀，用于拒绝 http:/data:/javascript:/file: 等外部引用。 */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f
}

/** 路径与图片引用里出现控制字符一律视为不可信。 */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && isControlCodePoint(codePoint)) return true
  }
  return false
}

/** 去掉控制字符；用于把作者输入的标题变成安全文件名。 */
export function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter(character => {
      const codePoint = character.codePointAt(0)
      return codePoint === undefined || !isControlCodePoint(codePoint)
    })
    .join('')
}

export interface ProjectDocumentEntry {
  /** 项目相对的 posix 路径，例如 `.vela/documents/卷纲.md`。 */
  relativePath: string
  /**
   * 受控目录内的 posix 路径，例如 `卷纲.md` 或 `notes/卷一.md`。
   * 它同时是标签页标识与知识检索映射键。
   */
  documentPath: string
  fileName: string
  /** 展示标题（文件名去掉扩展名）。 */
  title: string
  size: number
  modifiedAt: string
}

export interface ProjectDocumentImportOutcome {
  sourceName: string
  relativePath: string
  documentPath: string
}

export interface ProjectDocumentImportFailure {
  sourceName: string
  error: string
}

export interface MarkdownHeading {
  level: number
  text: string
  /** 0 基行号，供编辑器跳转。 */
  line: number
  /** 稳定锚点标识；同文重复标题会追加序号。 */
  id: string
}

export interface MarkdownIssue {
  kind: 'unclosed-code-fence'
  /** 1 基行号。 */
  line: number
  message: string
}

export interface ProjectDocumentAnalysis {
  headings: MarkdownHeading[]
  issues: MarkdownIssue[]
}

export function isMarkdownDocumentFileName(fileName: string): boolean {
  const lower = fileName.toLocaleLowerCase('en-US')
  return MARKDOWN_DOCUMENT_EXTENSIONS.some(extension => lower.endsWith(extension))
}

export function isProjectDocumentImageFileName(fileName: string): boolean {
  const lower = fileName.toLocaleLowerCase('en-US')
  return PROJECT_DOCUMENT_IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension))
}

export function imageMimeTypeForFileName(fileName: string): string {
  const lower = fileName.toLocaleLowerCase('en-US')
  const extension = PROJECT_DOCUMENT_IMAGE_EXTENSIONS.find(item => lower.endsWith(item))
  return extension ? IMAGE_MIME_TYPES[extension] : 'application/octet-stream'
}

function hasTrailingDotOrSpace(segment: string): boolean {
  return segment.endsWith(' ') || segment.endsWith('.')
}

/**
 * 校验并规范化受控目录内的相对路径（可含图片附件）。
 *
 * 返回 `null` 表示路径不被接受：绝对路径、盘符、UNC、`..`、空段、
 * 控制字符与 Windows 保留名都在拒绝之列。校验不通过时调用方不得触碰文件系统。
 */
export function normalizeManagedDocumentsPath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') return null
  const trimmed = rawPath.trim()
  if (!trimmed || trimmed.length > MAX_DOCUMENT_PATH_LENGTH) return null
  if (hasControlCharacter(trimmed)) return null

  const unified = trimmed.replace(/\\/g, '/')
  if (unified.startsWith('/')) return null
  if (/^[a-zA-Z]:/.test(unified)) return null

  const segments = unified.split('/')
  if (segments.length === 0 || segments.length > MAX_DOCUMENT_PATH_SEGMENTS) return null

  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return null
    if (hasTrailingDotOrSpace(segment)) return null
    // `:` 在 Windows 上不是合法文件名字符；提前拒绝可避免平台间行为分叉。
    if (segment.includes(':')) return null
    if (WINDOWS_RESERVED_SEGMENT.test(segment)) return null
    normalized.push(segment)
  }

  return normalized.join('/')
}

/**
 * 校验并规范化受控目录内的 Markdown 文档路径。
 *
 * 在受控目录相对路径之上再要求扩展名属于 Markdown，并且不落在
 * `assets/` 图片目录内——文档与附件在边界上不混用。
 */
export function normalizeProjectDocumentPath(rawPath: unknown): string | null {
  const managed = normalizeManagedDocumentsPath(rawPath)
  if (!managed) return null
  if (!isMarkdownDocumentFileName(managed)) return null
  if (managed.split('/').some(segment => segment.toLocaleLowerCase('en-US') === 'assets')) return null
  return managed
}

/** 受控目录内的路径 → 项目相对路径。 */
export function toProjectDocumentRelativePath(documentPath: unknown): string | null {
  const normalized = normalizeProjectDocumentPath(documentPath)
  return normalized ? `${PROJECT_DOCUMENTS_DIRECTORY}/${normalized}` : null
}

/** 项目相对路径 → 受控目录内的路径；不在受控目录内时返回 null。 */
export function documentPathFromRelativePath(relativePath: unknown): string | null {
  if (typeof relativePath !== 'string') return null
  if (hasControlCharacter(relativePath)) return null
  const unified = relativePath.replace(/\\/g, '/')
  const prefix = `${PROJECT_DOCUMENTS_DIRECTORY}/`
  if (!unified.startsWith(prefix)) return null
  return normalizeProjectDocumentPath(unified.slice(prefix.length))
}

/** 文档展示标题：路径最后一段去掉扩展名。 */
export function documentTitleFromPath(documentPath: string): string {
  const segment = documentPath.split('/').pop() ?? documentPath
  return segment.replace(/\.(md|markdown)$/i, '')
}

/**
 * 知识检索里代表一份项目文档的稳定名称。
 *
 * 知识库自身以文件名去重，而受控目录允许不同子目录存在同名文件，因此这里
 * 使用受控目录内的项目相对路径作为索引名称与状态键：它既唯一，又仍是作者
 * 看得懂的路径（`卷一/设定.md`）。只有合法的文档路径才会返回名称。
 */
export function projectDocumentKnowledgeName(documentPath: unknown): string | null {
  return normalizeProjectDocumentPath(documentPath)
}

/**
 * 把作者输入的标题转成安全的 Markdown 文件名。
 * `taken` 中的名字（大小写不敏感）会被跳过，追加 ` 2`、` 3` 等序号。
 */
export function sanitizeProjectDocumentFileName(
  title: string,
  taken?: Iterable<string>,
): string {
  const cleaned = stripControlCharacters(String(title ?? ''))
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.(md|markdown)$/i, '')
    // 分隔符替换与截断都可能留下多余的连字符，成稿名要看起来像人写的。
    .replace(/^[\s.-]+/, '')
    .replace(/[\s.-]+$/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, PROJECT_DOCUMENT_TITLE_MAX_LENGTH)
    .replace(/[\s.-]+$/, '')
    .trim()

  const stem = (cleaned || 'untitled').replace(/[\s.]+$/, '').trim()
  const safeStem = WINDOWS_RESERVED_SEGMENT.test(stem) ? `_${stem}` : (stem || 'untitled')

  const used = new Set<string>()
  for (const name of taken ?? []) used.add(String(name).toLocaleLowerCase('en-US'))

  let candidate = `${safeStem}.md`
  let suffix = 2
  while (used.has(candidate.toLocaleLowerCase('en-US'))) {
    candidate = `${safeStem} ${suffix}.md`
    suffix += 1
  }
  return candidate
}

/** 去掉 Markdown 行内标记，得到目录可读文本。 */
export function markdownHeadingPlainText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim()
}

function createHeadingId(text: string, used: Set<string>): string {
  const base = text
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section'

  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

/**
 * 从 Markdown 生成文档目录，并报告会破坏预览可信度的结构问题
 * （目前只有未闭合的代码围栏）。两者都不改写原文。
 */
export function analyzeProjectDocumentMarkdown(markdown: string): ProjectDocumentAnalysis {
  const headings: MarkdownHeading[] = []
  const issues: MarkdownIssue[] = []
  const usedIds = new Set<string>()

  const lines = String(markdown ?? '').split(/\r\n|\r|\n/)
  let fence: { marker: string; length: number; line: number } | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = { marker: marker[0], length: marker.length, line: index + 1 }
      } else if (marker[0] === fence.marker && marker.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fence) continue

    const headingMatch = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line)
    if (!headingMatch) continue
    const text = markdownHeadingPlainText(
      (headingMatch[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim(),
    )
    headings.push({
      level: headingMatch[1].length,
      text: text || headingMatch[1],
      line: index,
      id: createHeadingId(text, usedIds),
    })
  }

  if (fence) {
    issues.push({
      kind: 'unclosed-code-fence',
      line: fence.line,
      message: `第 ${fence.line} 行的代码围栏未闭合，后续内容会按代码块预览。`,
    })
  }

  return { headings, issues }
}

/** 只取目录的便捷入口。 */
export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  return analyzeProjectDocumentMarkdown(markdown).headings
}

/**
 * 把 Markdown 中的图片引用解析成受控目录内的 posix 路径。
 *
 * 相对引用按文档所在目录解析；解析结果必须仍落在 `.vela/documents/`
 * 之内，且扩展名属于允许的图片类型。`http:`、`data:`、绝对路径、
 * 盘符与 `..` 越界的引用一律返回 `null`，预览必须据此拒绝加载。
 */
export function resolveProjectDocumentAssetReference(
  documentPath: string,
  imageSource: unknown,
): string | null {
  if (typeof imageSource !== 'string') return null

  let source = imageSource.trim()
  if (!source || source.length > MAX_DOCUMENT_PATH_LENGTH) return null
  if (source.startsWith('<') && source.endsWith('>')) source = source.slice(1, -1).trim()
  // Markdown 允许 `path "title"`；标题不参与路径解析。
  const spaceIndex = source.search(/\s/)
  if (spaceIndex >= 0) source = source.slice(0, spaceIndex)
  if (!source) return null
  if (hasControlCharacter(source)) return null
  if (URL_SCHEME.test(source)) return null
  if (source.startsWith('//')) return null

  let decoded = source
  if (source.includes('%')) {
    try {
      decoded = decodeURIComponent(source)
    } catch {
      return null
    }
    if (decoded.includes('%')) return null
  }
  if (hasControlCharacter(decoded)) return null
  if (URL_SCHEME.test(decoded) || decoded.startsWith('//')) return null

  const unified = decoded.replace(/\\/g, '/')
  if (unified.startsWith('/')) return null
  if (/^[a-zA-Z]:/.test(unified)) return null

  const currentDocument = normalizeProjectDocumentPath(documentPath)
  if (!currentDocument) return null
  const stack = currentDocument.split('/').slice(0, -1)

  for (const segment of unified.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    if (hasTrailingDotOrSpace(segment)) return null
    if (WINDOWS_RESERVED_SEGMENT.test(segment)) return null
    stack.push(segment)
  }

  // 解析结果必须仍指向受控目录内的 assets 文件夹，不允许引用别处的图片。
  if (!stack.some(segment => segment.toLocaleLowerCase('en-US') === 'assets')) return null
  const assetPath = stack.join('/')
  if (!isProjectDocumentImageFileName(assetPath)) return null
  return assetPath
}
