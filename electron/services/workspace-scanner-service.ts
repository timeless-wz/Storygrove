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

    // 2. 拒绝系统核心目录 (Windows, Program Files, System32 等)
    const lower = canonical.toLocaleLowerCase('en-US')
    const systemDrive = (process.env.SystemDrive || 'C:').toLocaleLowerCase('en-US')
    const forbiddenWindowsDirs = [
      `${systemDrive}\\windows`,
      `${systemDrive}\\program files`,
      `${systemDrive}\\program files (x86)`,
      `${systemDrive}\\programdata`,
    ]
    for (const forbidden of forbiddenWindowsDirs) {
      if (lower === forbidden || lower.startsWith(forbidden + '\\')) {
        return { valid: false, error: '禁止选择系统核心目录作为创作资料目录' }
      }
    }

    const forbiddenPosixDirs = ['/etc', '/usr', '/bin', '/sbin', '/var', '/system', '/library']
    for (const forbidden of forbiddenPosixDirs) {
      if (lower === forbidden || lower.startsWith(forbidden + '/')) {
        return { valid: false, error: '禁止选择系统核心目录作为创作资料目录' }
      }
    }

    // 3. 拒绝当前项目根目录以及当前项目的 .vela 内部目录
    if (projectRoot) {
      const canonicalProj = getCanonicalPath(path.resolve(projectRoot))
      if (canonical === canonicalProj || isPathContained(canonical, canonicalProj)) {
        return { valid: false, error: '创作资料目录不能是当前项目目录或其内部目录（如 .vela）' }
      }
    }

    return { valid: true, canonicalPath: canonical }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 中文数字转阿拉伯数字 */
export function chineseToNumber(cn: string): number | null {
  const trimmed = cn.trim()
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  const map: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    十: 10, 百: 100, 千: 1000,
  }
  let total = 0
  let current = 0
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    const val = map[char]
    if (val === undefined) continue
    if (val === 10 || val === 100 || val === 1000) {
      total += (current === 0 ? 1 : current) * val
      current = 0
    } else {
      current = val
    }
  }
  total += current
  return total > 0 ? total : null
}

/** 从文本中解析章节序号或结构化范围 */
export function extractChapterRange(text: string): { start: number | null; end: number | null } {
  const range1 = /(?:第\s*([一二三四五六七八九十百千零\d]+)|Chapter\s*(\d+))\s*[-—–~～至到]+\s*第?\s*([一二三四五六七八九十百千零\d]+)\s*章?/iu.exec(text)
  if (range1) {
    const start = chineseToNumber(range1[1] ?? range1[2])
    const end = chineseToNumber(range1[3])
    if (start !== null && end !== null) {
      return { start: Math.min(start, end), end: Math.max(start, end) }
    }
  }

  const range2 = /([一二三四五六七八九十百千零\d]+)\s*[-—–~～至到]+\s*([一二三四五六七八九十百千零\d]+)\s*章/iu.exec(text)
  if (range2) {
    const start = chineseToNumber(range2[1])
    const end = chineseToNumber(range2[2])
    if (start !== null && end !== null) {
      return { start: Math.min(start, end), end: Math.max(start, end) }
    }
  }

  const single = /(?:第\s*([一二三四五六七八九十百千零\d]+)\s*章|Chapter\s*(\d+))/iu.exec(text)
  if (single) {
    const raw = single[1] ?? single[2]
    const num = chineseToNumber(raw)
    if (num !== null) {
      return { start: num, end: num }
    }
  }

  return { start: null, end: null }
}

/** 结构化数值章节区间判定，严禁使用 includes 误匹配 */
export function isChapterInRange(chapterNumber: number, start: number | null, end: number | null): boolean {
  if (start === null) return true // 全局通用
  const maxEnd = end !== null ? end : start
  return chapterNumber >= start && chapterNumber <= maxEnd
}

/** Markdown 标题片段解析器 */
export interface ParsedMarkdownFragment {
  headingPath: string
  content: string
  startLine: number
  endLine: number
  chapterStart: number | null
  chapterEnd: number | null
}

interface HeadingItem {
  level: number
  title: string
  chapterStart: number | null
  chapterEnd: number | null
}

export function parseMarkdownFragments(
  fileContent: string,
  fileName: string,
): ParsedMarkdownFragment[] {
  const lines = fileContent.split(/\r?\n/u)
  const fragments: ParsedMarkdownFragment[] = []

  const fileChapterRange = extractChapterRange(fileName)

  let headingStack: HeadingItem[] = []
  let currentStartLine = 1
  let currentContentLines: string[] = []
  let currentChapterStart = fileChapterRange.start
  let currentChapterEnd = fileChapterRange.end

  const flushCurrent = (endLine: number) => {
    const text = currentContentLines.join('\n').trim()
    if (text.length > 0 || headingStack.length > 0) {
      const headingPath = headingStack.map(h => h.title).join(' > ')
      fragments.push({
        headingPath: headingPath || path.basename(fileName, path.extname(fileName)),
        content: text,
        startLine: currentStartLine,
        endLine: Math.max(currentStartLine, endLine),
        chapterStart: currentChapterStart,
        chapterEnd: currentChapterEnd,
      })
    }
    currentContentLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const line = lines[i]
    const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(line.trim())

    if (headingMatch) {
      flushCurrent(lineNum - 1)
      const level = headingMatch[1].length
      const title = headingMatch[2].trim()

      headingStack = headingStack.filter(h => h.level < level)

      const explicitRange = extractChapterRange(title)
      let headingChapterStart: number | null = null
      let headingChapterEnd: number | null = null

      if (explicitRange.start !== null) {
        headingChapterStart = explicitRange.start
        headingChapterEnd = explicitRange.end
      } else {
        const ancestorWithRange = [...headingStack].reverse().find(h => h.chapterStart !== null)
        if (ancestorWithRange) {
          headingChapterStart = ancestorWithRange.chapterStart
          headingChapterEnd = ancestorWithRange.chapterEnd
        } else {
          headingChapterStart = fileChapterRange.start
          headingChapterEnd = fileChapterRange.end
        }
      }

      headingStack.push({
        level,
        title,
        chapterStart: headingChapterStart,
        chapterEnd: headingChapterEnd,
      })

      currentChapterStart = headingChapterStart
      currentChapterEnd = headingChapterEnd
      currentStartLine = lineNum
    } else {
      currentContentLines.push(line)
    }
  }

  flushCurrent(lines.length)
  return fragments
}

/** 计算文本哈希 */
export function hashString(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * 候选角色解析（纯文本模式，严禁任何硬编码人名或虚假推测）
 * candidateId 必须包含来源身份、标题路径和内容版本哈希，确保重扫幂等与变更追溯
 */
export function extractCharacterCandidates(
  fragments: ParsedMarkdownFragment[],
  sourceFile: string,
  projectId = 'main',
): WorkspaceImportCandidate[] {
  const candidates: WorkspaceImportCandidate[] = []

  for (const frag of fragments) {
    const parts = frag.headingPath.split(' > ')
    const lastHeading = parts[parts.length - 1]?.trim() || ''

    if (
      !lastHeading
      || parts.length === 1
      || /使用原则|原则|总纲|总览|一览|目录|备忘|主角团（待设计）|主要角色|核心人物|次要角色|人物与关系/u.test(lastHeading)
    ) {
      continue
    }

    const nameMatch = /^([^\s（(【[]+)/u.exec(lastHeading)
    const characterName = nameMatch ? nameMatch[1].trim() : lastHeading

    if (!characterName || characterName.length > 25) continue

    const content = frag.content
    const lines = content.split(/\r?\n/u)

    let gender = ''
    let age = ''
    let role = 'supporting'
    let background = ''
    let personality = ''
    let abilities = ''
    let motivation = ''
    let arc = ''
    let appearance = ''
    const notesList: string[] = []

    for (const rawLine of lines) {
      const trimmed = rawLine.trim().replace(/^[-*•]\s*/u, '')
      if (!trimmed) continue

      const genderMatch = /^(?:性别|gender)[：:]\s*(男|女|其他|未知|非二元)/iu.exec(trimmed)
      if (genderMatch) {
        gender = genderMatch[1]
        continue
      }

      const ageMatch = /^(?:年龄|age)[：:]\s*(\d+|[^，,\n]+)/iu.exec(trimmed)
      if (ageMatch) {
        age = ageMatch[1].trim()
        continue
      }

      const roleMatch = /^(?:定位|角色定位|身份定位|role)[：:]\s*(.+)/iu.exec(trimmed)
      if (roleMatch) {
        const roleText = roleMatch[1]
        if (/主角|领衔|男主|女主|第一主角/u.test(roleText)) role = 'protagonist'
        else if (/反派|敌对|对手|大boss/u.test(roleText)) role = 'antagonist'
        else if (/配角|主要配角/u.test(roleText)) role = 'supporting'
        else if (/客串|龙套|背景/u.test(roleText)) role = 'minor'
        continue
      }

      if (/^(?:外貌|容貌|长相|体貌|相貌|形象|穿着)[：:]/u.test(trimmed)) {
        appearance += (appearance ? '\n' : '') + trimmed.replace(/^(?:外貌|容貌|长相|体貌|相貌|形象|穿着)[：:]\s*/u, '')
      } else if (/^(?:身份|经历|原身|背景|生平)[：:]/u.test(trimmed)) {
        background += (background ? '\n' : '') + trimmed.replace(/^(?:身份|经历|原身|背景|生平)[：:]\s*/u, '')
      } else if (/^(?:性格|特质|特点|性格特征|思维方式|缺点)[：:]/u.test(trimmed)) {
        personality += (personality ? '\n' : '') + trimmed.replace(/^(?:性格|特质|特点|性格特征|思维方式|缺点)[：:]\s*/u, '')
      } else if (/^(?:能力|技能|职业|设定|专业|职印|本命)[：:]/u.test(trimmed)) {
        abilities += (abilities ? '\n' : '') + trimmed.replace(/^(?:能力|技能|职业|设定|专业|职印|本命)[：:]\s*/u, '')
      } else if (/^(?:动机|目标|追求|欲望|核心矛盾)[：:]/u.test(trimmed)) {
        motivation += (motivation ? '\n' : '') + trimmed.replace(/^(?:动机|目标|追求|欲望|核心矛盾)[：:]\s*/u, '')
      } else if (/^(?:弧光|走向|成长|轴|结局)[：:]/u.test(trimmed)) {
        arc += (arc ? '\n' : '') + trimmed.replace(/^(?:弧光|走向|成长|轴|结局)[：:]\s*/u, '')
      } else {
        notesList.push(trimmed)
      }
    }

    if (role === 'supporting') {
      if (/主角|男主|女主/u.test(lastHeading)) role = 'protagonist'
      else if (/反派|敌对/u.test(lastHeading)) role = 'antagonist'
    }

    const structuredCharacter = {
      name: characterName,
      role: normalizeCharacterRole(role),
      gender,
      age,
      appearance: appearance.slice(0, 300),
      personality: personality.slice(0, 300),
      background: background.slice(0, 400),
      abilities: abilities.slice(0, 300),
      motivation: motivation.slice(0, 300),
      relationships: [],
      arc: arc.slice(0, 300),
      notes: notesList.join('\n').slice(0, 500),
    }

    const contentVersionHash = hashString(frag.content).slice(0, 12)
    const candidateId = `cand-char-${hashString(`${sourceFile}:${frag.headingPath}:${characterName}`).slice(0, 12)}-${contentVersionHash}`

    candidates.push({
      candidateId,
      projectId,
      candidateType: 'character',
      rawData: frag.content,
      suggestedData: JSON.stringify(structuredCharacter, null, 2),
      sourceFile,
      sourceHeadingPath: frag.headingPath,
      sourceLineRange: `${frag.startLine}-${frag.endLine}`,
      evidence: frag.content.slice(0, 300),
      confidence: 0.9,
      status: 'pending',
    })
  }

  return candidates
}

/** 候选设定规则提取 */
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
      scope: frag.chapterStart ? `第${frag.chapterStart}章` : 'global',
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
}

export interface WorkspaceScanResult {
  success: boolean
  taskId?: string
  scannedCount: number
  recognizedCount: number
  error?: string
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
    for (const [id, task] of activeScanTasks) {
      if (task.projectId === projectId) {
        task.controller.abort()
        activeScanTasks.delete(id)
      }
    }
  }

  /**
   * 异步、有界、可取消、单事务提交的母稿目录扫描器
   * 严格只读！应用层级限制，防止假死、溢出与符号链接逃逸。
   */
  static async scanDirectory(
    workspacePath: string,
    projectId = 'main',
    options?: WorkspaceScanOptions,
  ): Promise<WorkspaceScanResult> {
    const taskId = options?.taskId
    const signal = options?.signal

    if (signal?.aborted) {
      return { success: false, taskId, scannedCount: 0, recognizedCount: 0, error: '扫描已取消' }
    }

    const validation = validateWorkspacePath(workspacePath)
    if (!validation.valid || !validation.canonicalPath) {
      return {
        success: false,
        taskId,
        scannedCount: 0,
        recognizedCount: 0,
        error: validation.error || `目录无效: ${workspacePath}`,
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
      }

      const discoveredFiles: DiscoveredFile[] = []
      let totalDiscoveredBytes = 0
      let discoveredFileCount = 0

      const walkAsync = async (dir: string, depth: number): Promise<void> => {
        if (signal?.aborted) return
        if (depth > SCAN_LIMITS.MAX_DEPTH) return
        if (discoveredFileCount >= SCAN_LIMITS.MAX_FILES) return

        let entries: fs.Dirent[]
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch {
          return // 无权读取子目录时安全跳过
        }

        for (const entry of entries) {
          if (signal?.aborted) return
          if (discoveredFileCount >= SCAN_LIMITS.MAX_FILES) break

          const fullPath = path.join(dir, entry.name)

          let lstat: fs.Stats
          try {
            lstat = await fs.promises.lstat(fullPath)
          } catch {
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
              // 不占正文读取/解析总字节预算。其他超限文件继续安全跳过。
              if (isWhitelistedReference) {
                discoveredFiles.push({
                  absPath: fullPath,
                  size: lstat.size,
                  mtimeMs: Math.floor(lstat.mtimeMs),
                })
              } else if (lstat.size <= SCAN_LIMITS.MAX_FILE_SIZE_BYTES) {
                if (totalDiscoveredBytes + lstat.size > SCAN_LIMITS.MAX_TOTAL_BYTES) {
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

          // 检查是否为超大参考小说：仅记录元数据，不读全文，不生成全文片段
          const isLargeReferenceNovel = preset.category === 'reference_novel'
            || file.size > SCAN_LIMITS.MAX_PARSE_TEXT_BYTES

          if (isLargeReferenceNovel) {
            const metaHash = hashString(`${relPath}:${file.size}:${file.mtimeMs}`)
            const snapshotId = `snap-${sourceId}-${metaHash.slice(0, 16)}`

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
              skipReason: preset.category === 'reference_novel'
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
            const snapshotId = `snap-${sourceId}-${observedFileHash.slice(0, 16)}`

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

            const parsedFragments = parseMarkdownFragments(fileContent, relPath)

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
              chapterStart: f.chapterStart,
              chapterEnd: f.chapterEnd,
              purpose: preset.purposeZh,
              status: preset.category === 'deprecated' ? 'deprecated' : 'active',
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
            }

            return {
              source,
              snapshot,
              fragments,
              candidates,
              rules,
            }
          } catch (err) {
            // 单文件解析失败隔离：写入独立诊断结果，保留上一份有效快照
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[WorkspaceScanner] 单文件读取或解析异常 (${relPath}):`, errMsg)

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
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (errorMsg === 'SCAN_ABORTED' || signal?.aborted) {
        return { success: false, taskId, scannedCount: 0, recognizedCount: 0, error: '扫描已取消' }
      }
      console.error('[WorkspaceScanner] 扫描外部目录全局失败:', errorMsg)
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
