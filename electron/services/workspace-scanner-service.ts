import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  matchWorkspaceCategory,
  type WorkspaceSource,
  type WorkspaceSourceCategory,
  type SettingRule,
  type WorkspaceImportCandidate,
  type WorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshotFragment,
} from '../../src/shared/workspace-hub'
import {
  WorkspaceHubRepository,
  type StagedScanPayload,
  type StagedSourceItem,
} from '../repositories/workspace-hub-repository'
import { normalizeCharacterRole } from '../../src/shared/character-role'

export const PARSER_SCHEMA_VERSION = 1

export const SCAN_LIMITS = {
  MAX_DEPTH: 10,
  MAX_FILES: 1000,
  MAX_FILE_SIZE_BYTES: 16 * 1024 * 1024, // 16MB
  MAX_TOTAL_BYTES: 120 * 1024 * 1024,   // 120MB
  MAX_PARSE_TEXT_BYTES: 2 * 1024 * 1024, // 2MB (超大参考小说只记录元数据)
  SCAN_CONCURRENCY: 8,
  ALLOWED_EXTENSIONS: new Set(['.md', '.markdown', '.txt']),
} as const

/** 获取规范路径（解析真实符号链接与长路径，兼顾尚不存在的子路径） */
export function getCanonicalPath(targetPath: string): string {
  const resolved = path.resolve(targetPath)
  if (fs.existsSync(resolved)) {
    try {
      return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved)
    } catch {
      return resolved
    }
  }
  // 目标尚不存在时，解析其最近的现有祖先目录的 realpath
  const missingSegments: string[] = []
  let ancestor = resolved
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    missingSegments.unshift(path.basename(ancestor))
    ancestor = parent
  }
  try {
    const canonicalAncestor = fs.realpathSync.native ? fs.realpathSync.native(ancestor) : fs.realpathSync(ancestor)
    return path.resolve(canonicalAncestor, ...missingSegments)
  } catch {
    return resolved
  }
}

/** 检查 childPath 是否安全包含在 parentPath 内（防路径穿越与软链接逃逸） */
export function isPathContained(childPath: string, parentPath: string): boolean {
  const canonicalParent = getCanonicalPath(parentPath).toLocaleLowerCase('en-US')
  const canonicalChild = getCanonicalPath(childPath).toLocaleLowerCase('en-US')
  if (canonicalChild === canonicalParent) return true
  const prefix = canonicalParent.endsWith(path.sep) ? canonicalParent : canonicalParent + path.sep
  return canonicalChild.startsWith(prefix)
}

/**
 * 单一权威工作区目录路径合法性校验：
 * - 必须为非空存在目录
 * - 拒绝操作系统磁盘根目录（例如 C:\, D:\, /）
 * - 拒绝操作系统敏感核心目录（Windows, Program Files, System32, ProgramData, /etc, /usr, /bin 等）
 * - 拒绝当前项目根目录以及当前项目内部目录（如 .vela）
 */
export function validateWorkspacePath(
  candidatePath: string,
  projectRoot?: string | null,
): { valid: boolean; canonicalPath?: string; error?: string } {
  if (!candidatePath || typeof candidatePath !== 'string' || !candidatePath.trim()) {
    return { valid: false, error: '目录路径不能为空' }
  }

  const trimmed = candidatePath.trim()
  const resolved = path.resolve(trimmed)
  if (!fs.existsSync(resolved)) {
    return { valid: false, error: `工作区目录不存在: ${trimmed}` }
  }

  try {
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return { valid: false, error: '指定路径不是有效文件夹' }
    }

    const canonical = getCanonicalPath(resolved)

    // 1. 拒绝操作系统磁盘根目录 (例如 C:\, D:\, /)
    const parsed = path.parse(canonical)
    if (canonical === parsed.root || resolved === path.parse(resolved).root) {
      return { valid: false, error: '禁止将操作系统磁盘根目录作为创作资料目录' }
    }

    // 2. 拒绝系统敏感目录
    const lower = canonical.toLocaleLowerCase('en-US').replace(/\\/g, '/')
    const forbiddenSubstrings = [
      '/windows',
      '/program files',
      '/program files (x86)',
      '/programdata',
      '/system32',
      '/etc',
      '/usr',
      '/bin',
      '/sbin',
      '/var',
      '/proc',
      '/sys',
    ]

    for (const sub of forbiddenSubstrings) {
      if (lower === sub || lower.startsWith(sub + '/') || lower.includes(':' + sub)) {
        return { valid: false, error: '禁止绑定系统敏感目录' }
      }
    }

    // 3. 拒绝当前项目自身目录及其子目录（如 .vela）
    if (projectRoot) {
      const canonicalProject = getCanonicalPath(projectRoot)
      if (isPathContained(canonical, canonicalProject)) {
        return { valid: false, error: '禁止将当前项目所在目录或其子目录作为外部创作母稿目录' }
      }
      if (isPathContained(canonicalProject, canonical)) {
        return { valid: false, error: '创作资料目录不能包含当前项目目录' }
      }
    }

    return { valid: true, canonicalPath: canonical }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 字符串 SHA-256 哈希辅助 */
function hashString(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Markdown 标题片段解析结果 */
interface ParsedMarkdownFragment {
  headingPath: string
  content: string
  startLine: number
  endLine: number
  level: number
}

/**
 * 将 Markdown 文档按照标题层级切分为片段。
 * 支持 ATX 标题 (# Title) 与多行内容保留。
 */
export function splitMarkdownByHeadings(content: string): ParsedMarkdownFragment[] {
  const lines = content.split(/\r?\n/)
  const fragments: ParsedMarkdownFragment[] = []

  interface StackEntry {
    level: number
    title: string
  }
  const headingStack: StackEntry[] = []

  let currentHeadingPath = '引言'
  let currentLevel = 0
  let currentStartLine = 1
  let currentLines: string[] = []

  const flush = (endLine: number) => {
    const text = currentLines.join('\n').trim()
    if (text.length > 0) {
      fragments.push({
        headingPath: currentHeadingPath,
        content: text,
        startLine: currentStartLine,
        endLine,
        level: currentLevel,
      })
    }
    currentLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      flush(lineNumber - 1)

      const level = headingMatch[1].length
      const title = headingMatch[2].trim()

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop()
      }
      headingStack.push({ level, title })

      currentHeadingPath = headingStack.map(h => h.title).join(' > ')
      currentLevel = level
      currentStartLine = lineNumber
      currentLines = [line]
    } else {
      currentLines.push(line)
    }
  }

  flush(lines.length)
  return fragments
}

/**
 * 从文本或标题路径中抽取涉及的章节范围 (如 "第1-10章", "第5章")
 */
export function extractChapterRange(text: string): { start: number | null; end: number | null } {
  const rangeMatch = text.match(/第\s*(\d+)\s*(?:[-~至到—–]\s*(\d+))?\s*章/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10)
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : start
    return { start, end }
  }
  const enMatch = text.match(/\bChapter\s*(\d+)(?:\s*[-~至到—–]\s*(\d+))?\b/i)
  if (enMatch) {
    const start = parseInt(enMatch[1], 10)
    const end = enMatch[2] ? parseInt(enMatch[2], 10) : start
    return { start, end }
  }
  return { start: null, end: null }
}

/**
 * 解析 Markdown 文本为结构化片段快照（供测试与独立片段化调用）
 */
export function parseMarkdownFragments(
  markdown: string,
  sourceFile: string = '',
  snapshotId: string = 'test-snapshot',
  projectId: string = 'main',
): WorkspaceSourceSnapshotFragment[] {
  const parsed = splitMarkdownByHeadings(markdown)
  const preset = matchWorkspaceCategory(sourceFile)
  return parsed.map((f, idx) => {
    const leafHeading = f.headingPath.split(' > ').pop() || f.headingPath
    const range = extractChapterRange(leafHeading)
    return {
      id: `${snapshotId}-f-${idx + 1}`,
      snapshotId,
      sourceId: `src-${hashString(sourceFile).slice(0, 16)}`,
      projectId,
      headingPath: f.headingPath,
      content: f.content,
      startLine: f.startLine,
      endLine: f.endLine,
      fragmentHash: hashString(f.content),
      chapterStart: range.start,
      chapterEnd: range.end,
      purpose: preset.category,
      status: 'active',
    }
  })
}

/**
 * 判断目标章节是否在章节范围内
 */
export function isChapterInRange(chapter: number, start: number | null, end: number | null): boolean {
  if (start === null && end === null) return true
  if (start !== null && end !== null) return chapter >= start && chapter <= end
  if (start !== null) return chapter >= start
  if (end !== null) return chapter <= end
  return true
}

/**
 * 从 "05_人物与关系" 片段中提取结构化角色名单导入候选。
 */
export function extractCharacterCandidates(
  fragments: ParsedMarkdownFragment[],
  sourceFile: string,
  projectId = 'main',
): WorkspaceImportCandidate[] {
  const candidates: WorkspaceImportCandidate[] = []

  for (const frag of fragments) {
    const lines = frag.content.split('\n')
    let name = ''
    const parts = frag.headingPath.split(' > ')
    const lastHeading = parts[parts.length - 1].trim()

    const SECTION_TITLE_REGEX = /^(人物|角色|核心人物|主要人物|次要人物|重要人物|反派人物|主要角色|次要角色|重要角色|核心角色|反派角色|配角名单|角色档案|人物档案|人物设定|角色设定|人物列表|角色列表|人物关系|角色关系|人物群像|角色群像|角色总览|人物总览|登场人物|登场角色|其他人物|其他角色|说明|总览|前言|引言|目录|概述|背景设定)$/
    const isSectionHeader = frag.level === 1
      || /(角色|人物|总览|说明|概述|列表|档案|群像|设定|名单)$/.test(lastHeading)
      || SECTION_TITLE_REGEX.test(lastHeading)

    if (isSectionHeader) {
      continue
    }

    const headingNameMatch = lastHeading.match(/^[\d_\s-]*([^(:：[{]+)/)
    if (headingNameMatch && headingNameMatch[1].trim().length >= 1 && headingNameMatch[1].trim().length <= 12) {
      name = headingNameMatch[1].trim()
    }

    let role = ''
    let gender = ''
    let age = ''
    let appearance = ''
    let personality = ''
    let background = ''
    let abilities = ''
    let motivation = ''
    let arc = ''
    const otherNotes: string[] = []
    const relationships: Array<{ targetName: string; relationship: string }> = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const fieldMatch = trimmed.match(/^[-*•]?\s*(姓名|角色名|名字|身份|定位|类型|性别|年龄|外貌|容貌|性格|特质|身世|背景|能力|技能|金手指|动机|目标|弧光|成长|关系)[：:]\s*(.+)$/)
      if (fieldMatch) {
        const key = fieldMatch[1]
        const val = fieldMatch[2].trim()
        switch (key) {
          case '姓名':
          case '角色名':
          case '名字':
            if (!name) name = val
            break
          case '身份':
            if (val === '主角' || val === '反派' || val === '配角' || val === '龙套' || val === 'protagonist' || val === 'antagonist' || val === 'supporting' || val === 'minor') {
              role = val
            } else {
              background = background ? `${background}; ${val}` : val
            }
            break
          case '定位':
          case '类型':
            role = val
            break
          case '性别':
            gender = val
            break
          case '年龄':
            age = val
            break
          case '外貌':
          case '容貌':
            appearance = val
            break
          case '性格':
          case '特质':
            personality = val
            break
          case '身世':
          case '背景':
            background = val
            break
          case '能力':
          case '技能':
          case '金手指':
            abilities = val
            break
          case '动机':
          case '目标':
            motivation = val
            break
          case '弧光':
          case '成长':
            arc = val
            break
          case '关系': {
            const relMatch = val.match(/([^(:：,\s]+)\s*[(（](.+)[)）]/)
            if (relMatch) {
              relationships.push({ targetName: relMatch[1].trim(), relationship: relMatch[2].trim() })
            } else {
              otherNotes.push(`关系: ${val}`)
            }
            break
          }
        }
      } else {
        otherNotes.push(trimmed)
      }
    }

    if (!name && lastHeading.length <= 10 && !lastHeading.includes('说明') && !lastHeading.includes('总览')) {
      name = lastHeading
    }

    if (name && name.length >= 2) {
      const normalizedRole = normalizeCharacterRole(role)
      const characterData = {
        name,
        role: normalizedRole,
        gender,
        age,
        appearance,
        personality,
        background,
        abilities,
        motivation,
        arc,
        notes: otherNotes.slice(0, 5).join('; '),
        relationships,
      }

      const dataHash = hashString(JSON.stringify(characterData)).slice(0, 8)
      const baseId = hashString(`${sourceFile}:${name}`).slice(0, 8)
      const candidateId = `cand-char-${baseId}-${dataHash}`
      candidates.push({
        candidateId,
        projectId,
        candidateType: 'character',
        rawData: frag.content,
        suggestedData: JSON.stringify(characterData),
        sourceFile,
        sourceHeadingPath: frag.headingPath,
        sourceLineRange: `${frag.startLine}-${frag.endLine}`,
        evidence: `检测到角色卡：${name} (${role || '待定'})`,
        confidence: role && personality ? 0.95 : 0.75,
        status: 'pending',
      })
    }
  }

  return candidates
}

/**
 * 从世界资料与设定文档中提取有效设定规则。
 */
export function extractSettingRulesFromFragments(
  fragments: ParsedMarkdownFragment[],
  sourceFile: string,
  category: WorkspaceSourceCategory,
  projectId = 'main',
): SettingRule[] {
  const rules: SettingRule[] = []

  for (const frag of fragments) {
    if (!frag.content.trim()) continue

    let status: 'confirmed' | 'candidate' | 'background' | 'deprecated' = 'confirmed'
    if (category === 'deprecated') {
      status = 'deprecated'
    } else if (category === 'background_settings') {
      status = 'background'
    } else if (category === 'confirmed_settings') {
      status = 'confirmed'
    } else {
      status = 'candidate'
    }

    const ruleId = `rule-${hashString(`${sourceFile}:${frag.headingPath}:${frag.startLine}`).slice(0, 16)}`
    const parts = frag.headingPath.split(' > ')
    const title = parts[parts.length - 1] || '未命名规则'

    rules.push({
      ruleId,
      projectId,
      title,
      content: frag.content,
      status,
      constraintType: 'hard',
      scope: extractChapterRange(frag.headingPath).start ? `第${extractChapterRange(frag.headingPath).start}章` : 'global',
      sourceFile,
      sourceHeadingPath: frag.headingPath,
      sourceLineRange: `${frag.startLine}-${frag.endLine}`,
      confirmedAt: status === 'confirmed' ? new Date().toISOString() : undefined,
      confirmedBy: status === 'confirmed' ? 'preset-importer' : undefined,
    })
  }

  return rules
}

export interface WorkspaceScanOptions {
  signal?: AbortSignal
  taskId?: string
  maxFiles?: number
  maxTotalBytes?: number
}

export interface WorkspaceScanResult {
  success: boolean
  taskId?: string
  scannedCount: number
  recognizedCount: number
  error?: string
  enumerationComplete?: boolean
  truncated?: boolean
  truncationReason?: string
}

interface ActiveScanTask {
  taskId: string
  projectId: string
  controller: AbortController
}

const activeScanTasks = new Map<string, ActiveScanTask>()

/** 并发限制执行辅助函数 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIdx = 0

  const worker = async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++
      results[idx] = await fn(items[idx])
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(pool)
  return results
}

export class WorkspaceScannerService {
  /** 单一权威路径验证实现 */
  static validateWorkspacePath = validateWorkspacePath

  static registerScanTask(taskId: string, projectId: string, controller: AbortController): void {
    activeScanTasks.set(taskId, { taskId, projectId, controller })
  }

  static cancelScanTask(taskId: string): boolean {
    const task = activeScanTasks.get(taskId)
    if (task) {
      task.controller.abort()
      activeScanTasks.delete(taskId)
      return true
    }
    return false
  }

  static cancelAllForProject(projectId: string): void {
    for (const [taskId, task] of activeScanTasks.entries()) {
      if (task.projectId === projectId) {
        task.controller.abort()
        activeScanTasks.delete(taskId)
      }
    }
  }

  /**
   * 执行完整外部工作区扫描
   * 采用异步非阻塞收集、并发受控解析，并通过单事务 commitScanPayload 提交暂存快照。
   */
  static async scanDirectory(
    workspacePath: string,
    projectId = 'main',
    options?: WorkspaceScanOptions,
  ): Promise<WorkspaceScanResult> {
    const signal = options?.signal
    const taskId = options?.taskId
    const maxFiles = options?.maxFiles ?? SCAN_LIMITS.MAX_FILES
    const maxTotalBytes = options?.maxTotalBytes ?? SCAN_LIMITS.MAX_TOTAL_BYTES

    const validation = validateWorkspacePath(workspacePath)
    if (!validation.valid || !validation.canonicalPath) {
      return {
        success: false,
        taskId,
        scannedCount: 0,
        recognizedCount: 0,
        error: validation.error || '工作区路径无效',
      }
    }

    const canonicalRoot = validation.canonicalPath

    try {
      // -----------------------------------------------------------------------
      // 阶段 1: 异步收集文件清单（严格检查符号链接、深度、文件总数、并在添加前检查总上限）
      // -----------------------------------------------------------------------
      interface DiscoveredFile {
        absPath: string
        size: number
        mtimeMs: number
        oversized?: boolean
      }

      const discoveredFiles: DiscoveredFile[] = []
      let totalDiscoveredBytes = 0
      let discoveredFileCount = 0
      let enumerationComplete = true
      let truncated = false
      let truncationReason: string | undefined = undefined

      const walkAsync = async (dir: string, depth: number): Promise<void> => {
        if (signal?.aborted) return
        if (depth > SCAN_LIMITS.MAX_DEPTH) {
          enumerationComplete = false
          return
        }
        if (discoveredFileCount >= maxFiles) {
          enumerationComplete = false
          truncated = true
          truncationReason = 'max_files_limit'
          return
        }

        let entries: fs.Dirent[]
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch (err) {
          if (dir === canonicalRoot) {
            throw new Error(`无法读取工作区根目录: ${err instanceof Error ? err.message : String(err)}`)
          }
          enumerationComplete = false
          return // 无权读取子目录时安全跳过，同时标记遍历未完全覆盖
        }

        // 逐条 await lstat 会让千文件目录的枚举退化成纯串行等待（实测 1000 条
        // 约 148ms，批处理后约 27ms）。按批并行解析条目元数据，同时严格保持
        // readdir 顺序与原有短路语义。批次边界处发现已达文件上限即停止解析，
        // 因此主循环永远不会读取到未解析的条目。
        const entryStats: Array<fs.Stats | null> = []
        const LSTAT_BATCH = 64
        for (let start = 0; start < entries.length; start += LSTAT_BATCH) {
          if (signal?.aborted) return
          if (discoveredFileCount >= maxFiles) break
          const batch = entries.slice(start, start + LSTAT_BATCH)
          const resolvedStats = await Promise.all(batch.map(async (entry) => {
            try {
              return await fs.promises.lstat(path.join(dir, entry.name))
            } catch {
              return null
            }
          }))
          entryStats.push(...resolvedStats)
        }

        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
          const entry = entries[entryIndex]
          if (signal?.aborted) return
          if (discoveredFileCount >= maxFiles) {
            enumerationComplete = false
            truncated = true
            truncationReason = 'max_files_limit'
            break
          }

          const fullPath = path.join(dir, entry.name)

          const lstat = entryStats[entryIndex]
          if (!lstat) {
            enumerationComplete = false
            continue
          }

          if (lstat.isSymbolicLink()) {
            try {
              const real = getCanonicalPath(fullPath)
              if (!isPathContained(real, canonicalRoot)) {
                console.warn(`[WorkspaceScanner] 忽略逃逸工作区根目录的符号链接: ${fullPath} -> ${real}`)
                continue
              }
            } catch {
              enumerationComplete = false
              continue
            }
          }

          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.')) {
              await walkAsync(fullPath, depth + 1)
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            if (SCAN_LIMITS.ALLOWED_EXTENSIONS.has(ext)) {
              discoveredFileCount++
              const relativePath = path.relative(canonicalRoot, fullPath)
              const isWhitelistedReference = matchWorkspaceCategory(relativePath).category === 'reference_novel'

              // 白名单参考小说即使超过正文解析上限也必须登记；它只占文件数量，
              // 不占正文读取/解析总字节预算。
              if (isWhitelistedReference) {
                discoveredFiles.push({
                  absPath: fullPath,
                  size: lstat.size,
                  mtimeMs: Math.floor(lstat.mtimeMs),
                })
              } else if (lstat.size > SCAN_LIMITS.MAX_FILE_SIZE_BYTES) {
                // 超限非参考小说：记录元数据，跳过正文解析，保留在 active 列表中防止误判为 missing
                discoveredFiles.push({
                  absPath: fullPath,
                  size: lstat.size,
                  mtimeMs: Math.floor(lstat.mtimeMs),
                  oversized: true,
                })
              } else {
                if (totalDiscoveredBytes + lstat.size > maxTotalBytes) {
                  enumerationComplete = false
                  truncated = true
                  truncationReason = 'max_total_bytes_limit'
                  console.warn(`[WorkspaceScanner] 到达正文解析总字节上限，跳过文件: ${fullPath}`)
                  continue
                }
                discoveredFiles.push({
                  absPath: fullPath,
                  size: lstat.size,
                  mtimeMs: Math.floor(lstat.mtimeMs),
                })
                totalDiscoveredBytes += lstat.size
              }
            }
          }
        }
      }

      await walkAsync(canonicalRoot, 0)

      if (signal?.aborted) {
        return { success: false, taskId, scannedCount: 0, recognizedCount: 0, error: '扫描已取消' }
      }

      // -----------------------------------------------------------------------
      // 阶段 2: 有界并发读取与解析（超大参考小说只登记元数据；单文件错误隔离诊断）
      // -----------------------------------------------------------------------
      const existingSources = WorkspaceHubRepository.listSources(projectId)
      const existingSourceMap = new Map(existingSources.map(s => [s.id, s]))

      let recognizedCount = 0
      const activeSourceIds: string[] = []

      const stagedItems: StagedSourceItem[] = await mapConcurrent(
        discoveredFiles,
        SCAN_LIMITS.SCAN_CONCURRENCY,
        async (file): Promise<StagedSourceItem> => {
          if (signal?.aborted) {
            throw new Error('SCAN_ABORTED')
          }

          const relPath = path.relative(canonicalRoot, file.absPath)
          const sourceId = `src-${hashString(relPath).slice(0, 16)}`
          activeSourceIds.push(sourceId)

          const preset = matchWorkspaceCategory(relPath)
          if (preset.category !== 'other') {
            recognizedCount++
          }

          const existing = existingSourceMap.get(sourceId)

          // 检查是否为超大参考小说或超单文件上限文件：仅记录元数据，不读全文，不生成全文片段
          const isLargeReferenceNovel = preset.category === 'reference_novel'
            || file.size > SCAN_LIMITS.MAX_PARSE_TEXT_BYTES
            || Boolean(file.oversized)

          if (isLargeReferenceNovel) {
            const metaHash = hashString(`${relPath}:${file.size}:${file.mtimeMs}`)
            const snapshotId = `snap-${sourceId}-v${PARSER_SCHEMA_VERSION}-${metaHash.slice(0, 16)}`

            let importStatus: 'scanned' | 'imported' | 'stale' | 'missing' | 'disabled' = 'scanned'
            let approvedContentHash = ''
            let approvedSnapshotId: string | null = null

            if (existing) {
              approvedContentHash = existing.approvedContentHash || ''
              approvedSnapshotId = existing.approvedSnapshotId ?? null
              if (approvedSnapshotId && approvedSnapshotId !== snapshotId) {
                importStatus = 'stale'
              } else {
                importStatus = approvedSnapshotId === snapshotId ? 'imported' : 'scanned'
              }
            }

            const source: WorkspaceSource = {
              id: sourceId,
              projectId,
              absolutePath: file.absPath,
              relativePath: relPath,
              category: preset.category,
              authorityStatus: preset.defaultAuthority,
              contentHash: metaHash,
              observedFileHash: metaHash,
              approvedContentHash,
              observedSnapshotId: snapshotId,
              approvedSnapshotId,
              parseError: null,
              parseStatus: 'metadata_only',
              skipReason: file.oversized
                ? 'file_size_exceeded_single_limit'
                : preset.category === 'reference_novel'
                  ? 'reference_novel_metadata_only'
                  : 'parse_text_size_limit_exceeded',
              mtime: file.mtimeMs,
              lastScannedAt: new Date().toISOString(),
              importStatus,
              isMissing: false,
              isDisabled: false,
              fileSize: file.size,
            }

            const snapshot: WorkspaceSourceSnapshot = {
              snapshotId,
              sourceId,
              projectId,
              contentHash: metaHash,
              fileSize: file.size,
              fragmentCount: 0,
              parserSchemaVersion: PARSER_SCHEMA_VERSION,
            }

            return {
              source,
              snapshot,
              fragments: [],
              candidates: [],
              rules: [],
            }
          }

          // 常规资料文件解析
          try {
            const fileContent = await fs.promises.readFile(file.absPath, 'utf8')
            const observedFileHash = hashString(fileContent)
            const snapshotId = `snap-${sourceId}-v${PARSER_SCHEMA_VERSION}-${observedFileHash.slice(0, 16)}`

            let importStatus: 'scanned' | 'imported' | 'stale' | 'missing' | 'disabled' = 'scanned'
            let approvedContentHash = ''
            let approvedSnapshotId: string | null = null

            if (existing) {
              approvedContentHash = existing.approvedContentHash || ''
              approvedSnapshotId = existing.approvedSnapshotId ?? null
              if (approvedSnapshotId && approvedSnapshotId !== snapshotId) {
                importStatus = 'stale'
              } else {
                importStatus = approvedSnapshotId === snapshotId ? 'imported' : 'scanned'
              }
            }

            const parsedFragments = splitMarkdownByHeadings(fileContent)
            const fragments: WorkspaceSourceSnapshotFragment[] = parsedFragments.map((f, idx) => ({
              id: `${snapshotId}-f-${idx + 1}`,
              snapshotId,
              sourceId,
              projectId,
              headingPath: f.headingPath,
              content: f.content,
              startLine: f.startLine,
              endLine: f.endLine,
              fragmentHash: hashString(f.content),
              chapterStart: extractChapterRange(f.headingPath.split(' > ').pop() || f.headingPath).start,
              chapterEnd: extractChapterRange(f.headingPath.split(' > ').pop() || f.headingPath).end,
              purpose: preset.category,
              status: 'active',
            }))

            let candidates: WorkspaceImportCandidate[] = []
            if (preset.category === 'character_data') {
              candidates = extractCharacterCandidates(parsedFragments, relPath, projectId)
            }

            let rules: SettingRule[] = []
            if (
              preset.category === 'confirmed_settings'
              || preset.category === 'deprecated'
              || preset.category === 'background_settings'
            ) {
              rules = extractSettingRulesFromFragments(parsedFragments, relPath, preset.category, projectId)
              rules = rules.map(rule => {
                const fragment = fragments.find(f => (
                  f.headingPath === rule.sourceHeadingPath
                  && `${f.startLine}-${f.endLine}` === rule.sourceLineRange
                ))
                return {
                  ...rule,
                  sourceFragmentId: fragment?.id,
                  sourceSnapshotFragmentId: fragment?.id,
                  sourceId,
                  sourceSnapshotId: snapshotId,
                  originType: 'scan' as const,
                }
              })
            }

            const source: WorkspaceSource = {
              id: sourceId,
              projectId,
              absolutePath: file.absPath,
              relativePath: relPath,
              category: preset.category,
              authorityStatus: preset.defaultAuthority,
              contentHash: observedFileHash,
              observedFileHash,
              approvedContentHash,
              observedSnapshotId: snapshotId,
              approvedSnapshotId,
              parseError: null,
              parseStatus: 'parsed',
              skipReason: null,
              mtime: file.mtimeMs,
              lastScannedAt: new Date().toISOString(),
              importStatus,
              isMissing: false,
              isDisabled: false,
              fileSize: file.size,
            }

            const snapshot: WorkspaceSourceSnapshot = {
              snapshotId,
              sourceId,
              projectId,
              contentHash: observedFileHash,
              fileSize: file.size,
              fragmentCount: fragments.length,
              parserSchemaVersion: PARSER_SCHEMA_VERSION,
            }

            return {
              source,
              snapshot,
              fragments,
              candidates,
              rules,
            }
          } catch (fileErr) {
            const errMsg = fileErr instanceof Error ? fileErr.message : String(fileErr)
            console.error(`[WorkspaceScanner] 解析单个文件失败: ${file.absPath}`, errMsg)

            const source: WorkspaceSource = {
              id: sourceId,
              projectId,
              absolutePath: file.absPath,
              relativePath: relPath,
              category: preset.category,
              authorityStatus: preset.defaultAuthority,
              contentHash: existing?.contentHash || '',
              observedFileHash: existing?.observedFileHash || '',
              approvedContentHash: existing?.approvedContentHash || '',
              observedSnapshotId: existing?.observedSnapshotId ?? null,
              approvedSnapshotId: existing?.approvedSnapshotId ?? null,
              parseError: errMsg,
              parseStatus: 'error',
              skipReason: 'read_or_parse_failed',
              mtime: file.mtimeMs,
              lastScannedAt: new Date().toISOString(),
              importStatus: existing?.importStatus ?? 'scanned',
              isMissing: false,
              isDisabled: false,
              fileSize: file.size,
            }

            return {
              source,
              preserveOldSnapshots: true,
            }
          }
        },
      )

      if (signal?.aborted) {
        return { success: false, taskId, scannedCount: 0, recognizedCount: 0, error: '扫描已取消' }
      }

      // -----------------------------------------------------------------------
      // 阶段 3 & 4: 构建与验证暂存快照载荷
      // -----------------------------------------------------------------------
      const stagedPayload: StagedScanPayload = {
        projectId,
        items: stagedItems,
        activeSourceIds,
        scanTime: new Date().toISOString(),
        enumerationComplete,
        truncated,
        truncationReason,
      }

      // -----------------------------------------------------------------------
      // 阶段 5: 单事务原子提交（若取消或出错，完整回滚）
      // -----------------------------------------------------------------------
      WorkspaceHubRepository.commitScanPayload(stagedPayload)

      return {
        success: true,
        taskId,
        scannedCount: discoveredFiles.length,
        recognizedCount,
        enumerationComplete,
        truncated,
        truncationReason,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (errorMsg === 'SCAN_ABORTED') {
        return { success: false, taskId, scannedCount: 0, recognizedCount: 0, error: '扫描已取消' }
      }
      return {
        success: false,
        taskId,
        scannedCount: 0,
        recognizedCount: 0,
        error: errorMsg,
      }
    }
  }
}
