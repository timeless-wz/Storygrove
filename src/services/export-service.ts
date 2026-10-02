import { volumeChapterNumbers } from '../shared/prose-volume'
/**
 * 导出服务 — 将小说项目导出为多种格式
 *
 * 支持：
 * - 合并 Markdown（全书合并为单个 .md）
 * - 分章 Markdown（每章一个 .md）
 * - 纯文本 TXT
 */
import { ipc } from './ipc-client'
import { requireIpcSuccess } from './ipc-result'
import { useWorkflowStore } from '../stores/workflow-store'
import { useLocaleStore } from '../stores/locale-store'
import type { Locale } from '../i18n/types'
import type { FileWriteCommitState, ProjectSessionContext } from '../shared/ipc-channels'
import type {
  FinalizedDraftExportAuthorityReceipt,
  FinalizedDraftExportSnapshot,
} from '../../electron/repositories/finalization-repository'
import {
  getActiveProjectSessionContext,
  sameProjectPathKey,
  sameProjectSessionContext,
} from '../shared/project-session-context'
import type { WritingLanguage } from '../shared/writing-language'
import { randomUUID } from '../utils/id'
import { createDocxBase64 } from './docx-export'
import type {
  DraftMarkdownSelectionRequest,
  DraftMarkdownSelectionReceiptItem,
  DraftMarkdownSelectionSnapshot,
} from '../shared/markdown-exchange'
import type { ProjectCoreData } from '../../electron/repositories/project-core-repository'
import type { CharacterData } from '../../electron/repositories/character-repository'
import type { CharacterRosterSnapshot } from '../shared/character-roster'
import { cultivationLevels, type CultivationSystem } from '../shared/cultivation'


export type ExportFormat = 'merged-md' | 'split-md' | 'txt' | 'word'
export type MarkdownExportSettingKey = 'premise' | 'worldview' | 'character-graph' | 'character-profiles'

export interface BasicSettingsExportSnapshot {
  core: ProjectCoreData | null
  roster: CharacterRosterSnapshot
  characters: CharacterData[]
  cultivation?: CultivationSystem | null
}

export interface SelectedMarkdownExportOptions {
  range: 'chapter' | 'volume' | 'settings'
  format: 'merged-md' | 'split-md'
  grantId: string
  selections: DraftMarkdownSelectionRequest[]
  settings?: MarkdownExportSettingKey[]
  scopeName?: string
  volumeId?: string
  expectedChapterNumbers?: number[]
}

interface ExportOptions {
  format: ExportFormat
  /** 由主进程选择目录后签发的受限授权，绝不是绝对路径。 */
  grantId: string
  includeOutline?: boolean
  includeCharacters?: boolean
}

/** 导出任务冻结的项目展示数据；项目路径本身绝不作为访问凭据。 */
export interface ExportProjectSnapshot {
  id: string
  sessionLease: string
  path: string
  name: string
  novelConfig: Readonly<{
    genre: string
    targetAudience: string
    writingLanguage: WritingLanguage
  }>
}

function isProjectSessionCurrent(projectSession: ProjectSessionContext): boolean {
  return sameProjectSessionContext(projectSession, getActiveProjectSessionContext())
}

function isMatchingProjectSnapshot(
  project: ExportProjectSnapshot,
  projectSession: ProjectSessionContext,
): boolean {
  return project.id === projectSession.projectId
    && project.sessionLease === projectSession.leaseId
    && sameProjectPathKey(project.path, projectSession.projectPath)
}

function staleExportResult(locale: Locale): { success: false; error: string } {
  return {
    success: false,
    error: locale === 'en-US'
      ? 'The project session changed. This export was cancelled.'
      : '项目会话已变化，本次导出已取消',
  }
}

type ExportWriteFailureCommitState = Exclude<FileWriteCommitState, 'committed'>

function requireExportWriteSuccess(
  result: { success: boolean; commitState?: FileWriteCommitState; error?: string },
  action: string,
  fallbackMessage: string,
): void {
  try {
    requireIpcSuccess(result, action, fallbackMessage)
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      {
        commitState: result.commitState === 'unknown'
          ? 'unknown'
          : 'not_committed',
      } satisfies { commitState: ExportWriteFailureCommitState },
    )
  }
}

function exportWriteFailureCommitState(error: unknown): ExportWriteFailureCommitState | undefined {
  if (!error || typeof error !== 'object' || !('commitState' in error)) return undefined
  const value = (error as { commitState?: unknown }).commitState
  return value === 'not_committed' || value === 'unknown' ? value : undefined
}

function splitWriteDetail(
  locale: Locale,
  confirmedWritten: readonly string[],
  possiblyWritten: readonly string[],
  definitelyFailed?: string,
): string {
  const none = locale === 'en-US' ? 'none' : '无'
  const detail = locale === 'en-US'
    ? `; confirmed written: ${confirmedWritten.join(', ') || none}; possibly written: ${possiblyWritten.join(', ') || none}; definitely failed: ${definitelyFailed || none}`
    : `；已确认写入: ${confirmedWritten.join(', ') || none}；可能已写入: ${possiblyWritten.join(', ') || none}；确定写入失败: ${definitelyFailed || none}`
  if (possiblyWritten.length === 0) return detail
  return `${detail}${locale === 'en-US'
    ? '; verify possibly written files before retrying; do not retry blindly'
    : '；请先核对可能已写入的文件，不要盲目重试'}`
}

function staleSplitExportResult(
  locale: Locale,
  confirmedWritten: readonly string[],
  possiblyWritten: readonly string[] = [],
  definitelyFailed?: string,
): { success: false; error: string } {
  const stale = staleExportResult(locale)
  return {
    ...stale,
    error: `${stale.error}${splitWriteDetail(
      locale,
      confirmedWritten,
      possiblyWritten,
      definitelyFailed,
    )}`,
  }
}

function unknownSingleWriteDetail(locale: Locale, relativePath: string): string {
  return locale === 'en-US'
    ? `; ${relativePath} may have been written; verify it before retrying and do not retry blindly`
    : `；${relativePath} 可能已写入；请先核对，不要盲目重试`
}

function staleCommittedSingleExportResult(locale: Locale, relativePath: string): { success: false; error: string } {
  const stale = staleExportResult(locale)
  return {
    ...stale,
    error: `${stale.error}${locale === 'en-US'
      ? `; the exported file was already written: ${relativePath}`
      : `；导出文件已确认写入: ${relativePath}`}`,
  }
}

function changedFinalizationResult(
  locale: Locale,
  confirmedWritten: readonly string[] = [],
): { success: false; error: string } {
  const error = locale === 'en-US'
    ? 'The finalized chapters changed. Review the latest versions and confirm the export again.'
    : '定稿章节已变化，请检查最新版本并重新确认导出'
  return {
    success: false,
    error: confirmedWritten.length > 0
      ? `${error}${splitWriteDetail(locale, confirmedWritten, [])}`
      : error,
  }
}

function requireFinalizedExportSnapshot(value: unknown): FinalizedDraftExportSnapshot[] {
  if (!Array.isArray(value)) throw new Error('定稿导出快照无效')
  const seenChapters = new Set<number>()
  const rows = value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('定稿导出快照无效')
    const row = candidate as Partial<FinalizedDraftExportSnapshot>
    const { draftId, chapterNumber, version, title, content, finalizationId, contentHash } = row
    if (
      typeof draftId !== 'number' || !Number.isSafeInteger(draftId) || draftId < 1
      || typeof chapterNumber !== 'number' || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1
      || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1
      || typeof title !== 'string'
      || typeof content !== 'string'
      || content.trim().length === 0
      || !(finalizationId === null
        || (typeof finalizationId === 'string' && finalizationId.trim().length > 0))
      || typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(contentHash)
    ) throw new Error('定稿导出快照身份或正文无效')
    if (seenChapters.has(chapterNumber)) throw new Error(`第 ${chapterNumber} 章存在重复定稿`)
    seenChapters.add(chapterNumber)
    return Object.freeze({
      draftId,
      chapterNumber,
      version,
      title,
      content,
      finalizationId,
      contentHash,
    })
  })
  return rows.sort((left, right) => left.chapterNumber - right.chapterNumber)
}

function exportAuthorityReceipt(
  drafts: readonly FinalizedDraftExportSnapshot[],
): FinalizedDraftExportAuthorityReceipt {
  return drafts.map(({
    draftId,
    chapterNumber,
    version,
    finalizationId,
    contentHash,
  }) => ({ draftId, chapterNumber, version, finalizationId, contentHash }))
}

function renderMarkdownChapter(
  chapterNumber: number,
  title: string,
  content: string,
  writingLanguage: WritingLanguage,
): string {
  const chapterTitle = writingLanguage === 'en-US'
    ? `Chapter ${chapterNumber}${title ? ` ${title}` : ''}`
    : `第${chapterNumber}章${title ? ` ${title}` : ''}`
  const heading = `# ${chapterTitle}`
  const firstLineEnd = content.indexOf('\n')
  const firstLine = content
    .slice(0, firstLineEnd === -1 ? content.length : firstLineEnd)
    .replace(/\r$/u, '')
  const firstAtxHeading = firstLine.match(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u)

  if (firstAtxHeading?.[1]?.trim() === chapterTitle) {
    return `${heading}${firstLineEnd === -1 ? '' : content.slice(firstLineEnd)}`
  }
  return `${heading}\n\n${content}`
}

/** 导出全书 */
export async function exportNovel(
  options: ExportOptions,
  project: ExportProjectSnapshot,
  projectSession: ProjectSessionContext,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const uiLocale = useLocaleStore.getState().locale
  const text = (zhCNText: string, enUSText: string) => uiLocale === 'en-US' ? enUSText : zhCNText
  const writtenSplitFiles: string[] = []
  let activeWritePath: string | undefined
  if (!isMatchingProjectSnapshot(project, projectSession) || !isProjectSessionCurrent(projectSession)) {
    return staleExportResult(uiLocale)
  }

  const addLog = useWorkflowStore.getState().addLog
  addLog('info', text(
    `开始导出（${formatLabel(options.format, uiLocale)}）...`,
    `Starting export (${formatLabel(options.format, uiLocale)})...`,
  ), uiLocale)

  try {
    const frozenDrafts = requireFinalizedExportSnapshot(await ipc.invokeWithProjectSession(
      projectSession,
      'db:draft-export-snapshot',
      projectSession.projectPath,
    ))
    const authorityReceipt = exportAuthorityReceipt(frozenDrafts)
    if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
    const chapterContents = frozenDrafts.map(draft => ({
      chapterNumber: draft.chapterNumber,
      title: draft.title.trim(),
      name: `chapter_${draft.chapterNumber}.md`,
      content: draft.content,
      markdownContent: renderMarkdownChapter(
        draft.chapterNumber,
        draft.title.trim(),
        draft.content,
        project.novelConfig.writingLanguage,
      ),
    }))

    if (chapterContents.length === 0) {
      return {
        success: false,
        error: text('无可导出的章节（无定稿章节）', 'There are no finalized chapters to export.'),
      }
    }

    if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
    addLog('info', text(
      `找到 ${chapterContents.length} 个已定稿章节`,
      `Found ${chapterContents.length} finalized chapters.`,
    ), uiLocale)

    let outputPath = ''
    const projectFileStem = exportFileStem(project.name)

    switch (options.format) {
      case 'merged-md': {
        // 合并为单个 Markdown
        let content = `# ${project.name}\n\n`
        content += `> ${project.novelConfig.genre} · ${project.novelConfig.targetAudience}\n\n---\n\n`

        // 可选：包含大纲
        if (options.includeOutline) {
          const core = await ipc.invokeWithProjectSession(
            projectSession,
            'db:project-core-get',
            projectSession.projectPath,
          )
          if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
          if (core?.synopsis) {
            content += core.synopsis + '\n\n---\n\n'
          }
        }

        // 章节内容
        for (const ch of chapterContents) {
          content += ch.markdownContent + '\n\n---\n\n'
        }

        outputPath = `${projectFileStem}.md`
        const authorityCurrent = await ipc.invokeWithProjectSession(
          projectSession,
          'db:draft-export-authority-current',
          authorityReceipt,
          projectSession.projectPath,
        )
        if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
        if (!authorityCurrent) return changedFinalizationResult(uiLocale)
        activeWritePath = outputPath
        const writeResult = await ipc.invoke('fs:grant-write-file', options.grantId, outputPath, content)
        requireExportWriteSuccess(
          writeResult,
          text('写入导出文件', 'Write export file'),
          text('写入导出文件失败', 'Failed to write the exported file.'),
        )
        activeWritePath = undefined
        if (!isProjectSessionCurrent(projectSession)) {
          return staleCommittedSingleExportResult(uiLocale, outputPath)
        }
        break
      }

      case 'split-md': {
        // 每章一个 Markdown
        const splitDir = `${projectFileStem}-${randomUUID()}`
        const authorityCurrent = await ipc.invokeWithProjectSession(
          projectSession,
          'db:draft-export-authority-current',
          authorityReceipt,
          projectSession.projectPath,
        )
        if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
        if (!authorityCurrent) return changedFinalizationResult(uiLocale)
        const mkdirResult = await ipc.invoke('fs:grant-mkdir', options.grantId, splitDir)
        if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
        requireIpcSuccess(
          mkdirResult,
          text('创建导出目录', 'Create export directory'),
          text('创建导出目录失败', 'Failed to create the export directory.'),
        )

        for (const ch of chapterContents) {
          const stillCurrent = await ipc.invokeWithProjectSession(
            projectSession,
            'db:draft-export-authority-current',
            authorityReceipt,
            projectSession.projectPath,
          )
          if (!isProjectSessionCurrent(projectSession)) {
            return staleSplitExportResult(uiLocale, writtenSplitFiles)
          }
          if (!stillCurrent) return changedFinalizationResult(uiLocale, writtenSplitFiles)
          activeWritePath = `${splitDir}/${ch.name}`
          const writeResult = await ipc.invoke('fs:grant-write-file', options.grantId, activeWritePath, ch.markdownContent)
          requireExportWriteSuccess(
            writeResult,
            text(`导出章节 ${ch.name}`, `Export chapter ${ch.name}`),
            text(`导出章节 ${ch.name} 失败`, `Failed to export chapter ${ch.name}.`),
          )
          writtenSplitFiles.push(activeWritePath)
          activeWritePath = undefined
          if (!isProjectSessionCurrent(projectSession)) {
            return staleSplitExportResult(uiLocale, writtenSplitFiles)
          }
        }

        outputPath = splitDir
        break
      }

      case 'txt': {
        // 纯文本（去除 Markdown 格式）
        let content = `${project.name}\n${'='.repeat(project.name.length * 2)}\n\n`

        for (const ch of chapterContents) {
          const chapterHeading = project.novelConfig.writingLanguage === 'en-US'
            ? `Chapter ${ch.chapterNumber}${ch.title ? ` ${ch.title}` : ''}`
            : `第${ch.chapterNumber}章${ch.title ? ` ${ch.title}` : ''}`
          // 简单去除 Markdown 标记
          const plainText = ch.content
            .replace(/^#{1,6}\s+/gm, '')  // 去掉标题标记
            .replace(/\*\*(.*?)\*\*/g, '$1')  // 去掉加粗
            .replace(/\*(.*?)\*/g, '$1')  // 去掉斜体
            .replace(/`(.*?)`/g, '$1')  // 去掉代码标记
            .replace(/---+/g, '\n')  // 分隔线
            .trim()

          content += `${chapterHeading}\n\n${plainText}\n\n`
        }

        outputPath = `${projectFileStem}.txt`
        const authorityCurrent = await ipc.invokeWithProjectSession(
          projectSession,
          'db:draft-export-authority-current',
          authorityReceipt,
          projectSession.projectPath,
        )
        if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
        if (!authorityCurrent) return changedFinalizationResult(uiLocale)
        activeWritePath = outputPath
        const writeResult = await ipc.invoke('fs:grant-write-file', options.grantId, outputPath, content)
        requireExportWriteSuccess(
          writeResult,
          text('写入导出文件', 'Write export file'),
          text('写入导出文件失败', 'Failed to write the exported file.'),
        )
        activeWritePath = undefined
        if (!isProjectSessionCurrent(projectSession)) {
          return staleCommittedSingleExportResult(uiLocale, outputPath)
        }
        break
      }

      case 'word': {
        const content = createDocxBase64(
          project.name,
          project.novelConfig.writingLanguage,
          chapterContents,
        )
        outputPath = `${projectFileStem}.docx`
        const authorityCurrent = await ipc.invokeWithProjectSession(
          projectSession,
          'db:draft-export-authority-current',
          authorityReceipt,
          projectSession.projectPath,
        )
        if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
        if (!authorityCurrent) return changedFinalizationResult(uiLocale)
        activeWritePath = outputPath
        const writeResult = await ipc.invoke('fs:grant-write-base64-file', options.grantId, outputPath, content)
        requireExportWriteSuccess(
          writeResult,
          text('写入 Word 导出文件', 'Write Word export file'),
          text('写入 Word 导出文件失败', 'Failed to write the Word export file.'),
        )
        activeWritePath = undefined
        if (!isProjectSessionCurrent(projectSession)) {
          return staleCommittedSingleExportResult(uiLocale, outputPath)
        }
        break
      }
    }

    if (!isProjectSessionCurrent(projectSession)) return staleExportResult(uiLocale)
    addLog('info', text(`导出完成: ${outputPath}`, `Export complete: ${outputPath}`), uiLocale)
    return { success: true, path: outputPath }
  } catch (error) {
    const commitState = activeWritePath
      ? exportWriteFailureCommitState(error)
      : undefined
    const possiblyWritten = activeWritePath && commitState === 'unknown'
      ? [activeWritePath]
      : []
    const definitelyFailed = activeWritePath && commitState === 'not_committed'
      ? activeWritePath
      : undefined
    if (!isProjectSessionCurrent(projectSession)) {
      if (options.format === 'split-md' && (writtenSplitFiles.length > 0 || activeWritePath)) {
        return staleSplitExportResult(
          uiLocale,
          writtenSplitFiles,
          possiblyWritten,
          definitelyFailed,
        )
      }
      const stale = staleExportResult(uiLocale)
      return activeWritePath && commitState === 'unknown'
        ? { ...stale, error: `${stale.error}${unknownSingleWriteDetail(uiLocale, activeWritePath)}` }
        : stale
    }
    const partialWriteDetail = options.format === 'split-md' && (writtenSplitFiles.length > 0 || activeWritePath)
      ? splitWriteDetail(uiLocale, writtenSplitFiles, possiblyWritten, definitelyFailed)
      : activeWritePath && commitState === 'unknown'
        ? unknownSingleWriteDetail(uiLocale, activeWritePath)
        : ''
    const errorMessage = `${String(error)}${partialWriteDetail}`
    addLog('error', text(`导出失败: ${errorMessage}`, `Export failed: ${errorMessage}`), uiLocale)
    return { success: false, error: errorMessage }
  }
}

/** Windows 与 POSIX 都安全的导出相对路径段，禁止项目名改变授权目录边界。 */
function exportFileStem(name: string): string {
  const normalized = Array.from(name, (character) => (
    character.charCodeAt(0) < 32 ? '_' : character
  )).join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  return normalized || 'novel'
}

function formatLabel(format: ExportFormat, locale: Locale): string {
  const labels: Record<ExportFormat, readonly [string, string]> = {
    'merged-md': ['合并 Markdown', 'Merged Markdown'],
    'split-md': ['分章 Markdown', 'Split Markdown'],
    'txt': ['纯文本 TXT', 'Plain text (TXT)'],
    'word': ['Word 文档', 'Word document'],
  }
  return labels[format][locale === 'en-US' ? 1 : 0]
}

/** Read the four user-confirmed basic setting sources from their authoritative project records. */
export async function loadBasicSettingsExportSnapshot(
  projectSession: ProjectSessionContext,
): Promise<BasicSettingsExportSnapshot> {
  const [core, roster, characters] = await Promise.all([
    ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', projectSession.projectPath),
    ipc.invokeWithProjectSession(projectSession, 'db:character-roster-read', projectSession.projectPath),
    ipc.invokeWithProjectSession(projectSession, 'db:character-get-all', projectSession.projectPath),
  ])
  const cultivation = characters.some(character => character.cultivationLevelId)
    ? await ipc.invokeWithProjectSession(projectSession, 'db:cultivation-read', projectSession.projectPath)
    : null
  return { core, roster, characters, ...(cultivation ? { cultivation } : {}) }
}

function textFor(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh
}

function settingSection(
  key: MarkdownExportSettingKey,
  snapshot: BasicSettingsExportSnapshot,
  locale: Locale,
): { title: string; body: string } {
  const empty = textFor(locale, '（暂无内容）', '(No content)')
  switch (key) {
    case 'premise':
      return {
        title: textFor(locale, '故事前提', 'Story premise'),
        body: snapshot.core?.premise?.trim() || empty,
      }
    case 'worldview': {
      const parts = [snapshot.core?.worldSetting?.trim(), snapshot.core?.worldbuilding?.trim()]
        .filter((value): value is string => Boolean(value))
      return {
        title: textFor(locale, '世界观', 'Worldview'),
        body: parts.length ? [...new Set(parts)].join('\n\n') : empty,
      }
    }
    case 'character-graph': {
      const body = snapshot.roster.renderedMarkdown?.trim() || snapshot.roster.legacyMarkdown?.trim() || ''
      return {
        title: textFor(locale, '角色图谱', 'Character graph'),
        body: body || empty,
      }
    }
    case 'character-profiles': {
      const roleLabels: Record<string, string> = locale === 'en-US'
        ? { protagonist: 'Protagonist', supporting: 'Supporting', antagonist: 'Antagonist', minor: 'Minor', unassigned: 'Unassigned' }
        : { protagonist: '主角', supporting: '配角', antagonist: '反派', minor: '次要角色', unassigned: '暂未设定' }
      const fields: Array<[keyof CharacterData, string, string]> = [
        ['gender', '性别', 'Gender'], ['age', '年龄', 'Age'], ['appearance', '外貌', 'Appearance'],
        ['personality', '性格', 'Personality'], ['background', '背景', 'Background'],
        ['abilities', '能力', 'Abilities'], ['motivation', '动机', 'Motivation'],
        ['relationships', '关系', 'Relationships'], ['arc', '角色弧光', 'Character arc'], ['notes', '备注', 'Notes'],
      ]
      const profiles = snapshot.characters.map(character => {
        const lines = [`## ${character.name} · ${roleLabels[character.role] ?? character.role}`]
        if (character.cultivationLevelId) {
          const level = cultivationLevels(snapshot.cultivation?.realms ?? []).find(entry => entry.id === character.cultivationLevelId)
          const label = textFor(locale, '修炼等级', 'Cultivation level')
          const value = level
            ? `${level.number} = ${level.name}`
            : textFor(locale, `未解析的等级绑定（${character.cultivationLevelId}）`, `Unresolved level binding (${character.cultivationLevelId})`)
          lines.push(`- ${label}: ${value}`)
        }
        for (const [field, zhLabel, enLabel] of fields) {
          const value = character[field]
          if (typeof value === 'string' && value.trim()) lines.push(`- ${textFor(locale, zhLabel, enLabel)}: ${value.trim()}`)
        }
        if (character.currentState) {
          lines.push(`- ${textFor(locale, '当前状态', 'Current state')}:`)
          for (const [field, zhLabel, enLabel] of [
            ['location', '所在位置', 'Location'], ['powerLevel', '修为描述（自由文本）', 'Power description (free text)'],
            ['physicalState', '身体状态', 'Physical state'], ['mentalState', '心理状态', 'Mental state'],
            ['keyItems', '关键物品', 'Key items'], ['recentEvents', '近期事件', 'Recent events'],
          ] as const) {
            const value = character.currentState[field]
            if (value.trim()) lines.push(`  - ${textFor(locale, zhLabel, enLabel)}: ${value.trim()}`)
          }
        }
        return lines.join('\n')
      })
      return {
        title: textFor(locale, '角色档案', 'Character profiles'),
        body: profiles.length ? profiles.join('\n\n') : empty,
      }
    }
  }
}

export function renderBasicSettingsMarkdown(
  snapshot: BasicSettingsExportSnapshot,
  keys: readonly MarkdownExportSettingKey[],
  locale: Locale,
): Array<{ key: MarkdownExportSettingKey; title: string; content: string }> {
  return keys.map(key => {
    const section = settingSection(key, snapshot, locale)
    return { key, title: section.title, content: `# ${section.title}\n\n${section.body}\n` }
  })
}

function receiptsEqual(
  current: readonly DraftMarkdownSelectionReceiptItem[],
  previewed: readonly DraftMarkdownSelectionReceiptItem[],
): boolean {
  return current.length === previewed.length && current.every((item, index) => {
    const old = previewed[index]
    return old !== undefined
      && item.draftId === old.draftId
      && item.kind === old.kind
      && item.chapterNumber === old.chapterNumber
      && item.version === old.version
      && item.status === old.status
      && item.contentHash === old.contentHash
      && item.titleHash === old.titleHash
      && item.finalizationId === old.finalizationId
  })
}

function exportSelectionChanged(locale: Locale): { success: false; error: string } {
  return {
    success: false,
    error: textFor(locale, '预览后所选章节数据已变化，请重新载入预览再导出。', 'The selected chapter data changed after preview. Reload the preview before exporting.'),
  }
}

/** Export one chapter, one volume, or selected basic settings under a fresh, isolated subdirectory. */
export async function exportSelectedMarkdown(
  options: SelectedMarkdownExportOptions,
  project: ExportProjectSnapshot,
  projectSession: ProjectSessionContext,
  previewReceipt: readonly DraftMarkdownSelectionReceiptItem[],
  previewSettings?: BasicSettingsExportSnapshot,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const locale = useLocaleStore.getState().locale
  const confirmedFiles: string[] = []
  let activeWritePath: string | undefined
  if (!isMatchingProjectSnapshot(project, projectSession) || !isProjectSessionCurrent(projectSession)) return staleExportResult(locale)
  if (options.range === 'settings' && (!options.settings?.length || options.selections.length)) {
    return { success: false, error: textFor(locale, '請選擇至少一項基礎設定。', 'Choose at least one basic setting.') }
  }
  if (options.range !== 'settings' && (!options.selections.length || options.settings?.length)) {
    return { success: false, error: textFor(locale, '請為範圍內每章明確選擇一個草稿版本或正文。', 'Choose exactly one draft version or finalized text for every chapter in this range.') }
  }

  try {
    const snapshot = options.selections.length
      ? await ipc.invokeWithProjectSession(projectSession, 'db:draft-export-selection', options.selections, projectSession.projectPath)
      : { chapters: [], receipt: [] } satisfies DraftMarkdownSelectionSnapshot
    if (!isProjectSessionCurrent(projectSession)) return staleExportResult(locale)
    if (!receiptsEqual(snapshot.receipt, previewReceipt)) return exportSelectionChanged(locale)

    let settingsSnapshot: BasicSettingsExportSnapshot | undefined
    let settingsFiles: Array<{ key: MarkdownExportSettingKey; title: string; content: string }> = []
    if (options.range === 'settings') {
      settingsSnapshot = await loadBasicSettingsExportSnapshot(projectSession)
      if (!isProjectSessionCurrent(projectSession)) return staleExportResult(locale)
      if (previewSettings && JSON.stringify(settingsSnapshot) !== JSON.stringify(previewSettings)) return exportSelectionChanged(locale)
      settingsFiles = renderBasicSettingsMarkdown(settingsSnapshot, options.settings ?? [], locale)
    }

    if (options.range === 'volume') {
      if (!options.volumeId || !options.expectedChapterNumbers?.length) {
        return { success: false, error: textFor(locale, '缺少卷和卷内章节清单；请重新预览。', 'The volume and chapter manifest is missing. Reload the preview.') }
      }
      const [volumes, blueprints, assignments] = await Promise.all([
        ipc.invokeWithProjectSession(projectSession, 'db:prose-volume-list', projectSession.projectPath),
        ipc.invokeWithProjectSession(projectSession, 'db:blueprint-list-summary', projectSession.projectPath),
        ipc.invokeWithProjectSession(projectSession, 'db:chapter-volume-list', projectSession.projectPath),
      ])
      if (!isProjectSessionCurrent(projectSession)) return staleExportResult(locale)
      if (!volumes.some(volume => volume.id === options.volumeId)) return exportSelectionChanged(locale)
      const expected = [...options.expectedChapterNumbers].sort((left, right) => left - right)
      const currentNumbers = volumeChapterNumbers(options.volumeId, blueprints, assignments ?? [])
      const selectedNumbers = snapshot.chapters.map(chapter => chapter.chapterNumber)
      if (JSON.stringify(expected) !== JSON.stringify(currentNumbers)
        || JSON.stringify(expected) !== JSON.stringify(selectedNumbers)) return exportSelectionChanged(locale)
    }

    const chapters = snapshot.chapters.map(chapter => ({
      ...chapter,
      markdownContent: renderMarkdownChapter(
        chapter.chapterNumber,
        chapter.title.trim(),
        chapter.content,
        project.novelConfig.writingLanguage,
      ),
    }))
    const hasFiles = options.range === 'settings' ? settingsFiles.length > 0 : chapters.length > 0
    if (!hasFiles) return { success: false, error: textFor(locale, '没有可导出的内容。', 'There is no content to export.') }

    if (snapshot.receipt.length) {
      const current = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-export-selection-current',
        snapshot.receipt,
        projectSession.projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return staleExportResult(locale)
      if (!current) return exportSelectionChanged(locale)
    }

    const folder = `${exportFileStem(project.name)}-export-${randomUUID()}`
    const mkdir = await ipc.invoke('fs:grant-mkdir', options.grantId, folder)
    if (!isProjectSessionCurrent(projectSession)) return staleExportResult(locale)
    requireIpcSuccess(mkdir, textFor(locale, '创建导出目录', 'Create export directory'), textFor(locale, '创建导出目录失败', 'Could not create export directory.'))

    const writeText = async (name: string, content: string) => {
      if (!isProjectSessionCurrent(projectSession)) throw new Error(staleExportResult(locale).error)
      if (snapshot.receipt.length) {
        const stillCurrent = await ipc.invokeWithProjectSession(projectSession, 'db:draft-export-selection-current', snapshot.receipt, projectSession.projectPath)
        if (!isProjectSessionCurrent(projectSession)) throw new Error(staleExportResult(locale).error)
        if (!stillCurrent) throw new Error(exportSelectionChanged(locale).error)
      }
      const relativePath = `${folder}/${name}`
      activeWritePath = relativePath
      const written = await ipc.invoke('fs:grant-write-file', options.grantId, relativePath, content)
      requireExportWriteSuccess(written, textFor(locale, `写入 ${name}`, `Write ${name}`), textFor(locale, `导出 ${name} 失败`, `Could not write ${name}.`))
      activeWritePath = undefined
      confirmedFiles.push(relativePath)
      if (!isProjectSessionCurrent(projectSession)) throw new Error(staleExportResult(locale).error)
    }

    if (options.range === 'settings') {
      if (options.format === 'merged-md') {
        const content = `# ${project.name} · ${textFor(locale, '基础设定', 'Basic settings')}\n\n${settingsFiles.map(file => `## ${file.title}\n\n${file.content.replace(/^# .+\n\n/u, '')}`).join('\n---\n\n')}`
        await writeText('basic-settings.md', content)
      } else {
        for (const [index, file] of settingsFiles.entries()) {
          const names: Record<MarkdownExportSettingKey, string> = {
            premise: 'story-premise', worldview: 'worldview', 'character-graph': 'character-graph', 'character-profiles': 'character-profiles',
          }
          await writeText(`${String(index + 1).padStart(2, '0')}-${names[file.key]}.md`, file.content)
        }
      }
    } else if (options.range === 'chapter') {
      const chapter = chapters[0]
      if (!chapter) throw new Error('所选章节缺少版本')
      const name = `chapter-${chapter.chapterNumber}${chapter.title ? `-${exportFileStem(chapter.title)}` : ''}.md`
      await writeText(name, chapter.markdownContent)
    } else if (options.format === 'merged-md') {
      const heading = options.scopeName?.trim() || textFor(locale, '所选卷', 'Selected volume')
      const content = `# ${heading}\n\n${chapters.map(chapter => `${chapter.markdownContent}\n`).join('\n---\n\n')}`
      await writeText(`${exportFileStem(heading)}.md`, content)
    } else {
      for (const chapter of chapters) {
        const name = `chapter-${chapter.chapterNumber}${chapter.title ? `-${exportFileStem(chapter.title)}` : ''}.md`
        await writeText(name, chapter.markdownContent)
      }
    }

    if (!isProjectSessionCurrent(projectSession)) return staleSplitExportResult(locale, confirmedFiles)
    return { success: true, path: confirmedFiles.length === 1 ? confirmedFiles[0] : folder }
  } catch (error) {
    const commitState = activeWritePath ? exportWriteFailureCommitState(error) : undefined
    const possiblyWritten = activeWritePath && commitState === 'unknown' ? [activeWritePath] : []
    const failed = activeWritePath && commitState === 'not_committed' ? activeWritePath : undefined
    const detail = splitWriteDetail(locale, confirmedFiles, possiblyWritten, failed)
    if (!isProjectSessionCurrent(projectSession)) return staleSplitExportResult(locale, confirmedFiles, possiblyWritten, failed)
    return { success: false, error: `${error instanceof Error ? error.message : String(error)}${detail}` }
  }
}
