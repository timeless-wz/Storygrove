/**
 * import_chapter_blueprint_v2 — 智能体「Codex 导入细纲」工具（契约 §12.1 任务 E）。
 *
 * 复用 B 的解析器（src/shared/blueprint-v2-markdown.ts）与 A 的保存通道
 * （db:blueprint-v2-save，乐观并发 + 投影事务）。写入永不触碰
 * blueprints.userGuidance / notes / notes_updated_at / role / characters
 * （投影仅覆盖 title/purpose/keyEvents/suspenseHook 四列，契约 §6.3）。
 *
 * 两段式：
 * 1. confirm_write 缺省/false → 只返回导入预览（分区/分镜统计、重导入匹配、
 *    章号建议差异），零写入；
 * 2. confirm_write: true → 执行保存（应用层的工具确认仍然先行）。
 *
 * 重复导入（契约 §4.3）：按分镜标题匹配沿用旧 scene id（画布链接存活）；
 * 旧有新无的分镜逐条列出原文提示，由用户决定是否继续。
 */

import { ipc } from '../../ipc-client'
import { buildAgentTool } from '../tool-registry'
import { agentToolText, assertAgentProjectCurrent, assertAgentToolActive, requireAgentProject } from './project-context'
import {
  applyBlueprintV2Reimport,
  matchScenesForReimport,
  parseChapterBlueprintMarkdown,
} from '../../../shared/blueprint-v2-markdown'
import { extractBlueprintV2WordBudget, getBlueprintV2Scenes, type ChapterBlueprintV2DetailRead } from '../../../shared/blueprint-v2'

interface ImportPreviewSummary {
  chapterNumber: number
  suggestedChapterNumber: number | null
  suggestedMismatch: boolean
  sectionTitles: string[]
  sceneCount: number
  sceneTitles: string[]
  wordBudget: number | null
  hasExistingDetail: boolean
  existingRevision: number | null
  matchedSceneCount: number
  newSceneCount: number
  removedSceneCount: number
  removedScenePreviews: string[]
  baseRevision: number
}

function summarize(
  chapterNumber: number,
  suggestedChapterNumber: number | null,
  incomingContent: Parameters<typeof getBlueprintV2Scenes>[0],
  existing: ChapterBlueprintV2DetailRead | null,
): ImportPreviewSummary {
  const incomingScenes = getBlueprintV2Scenes(incomingContent)
  const sectionTitles = incomingContent.sections.map(section => section.title)
  const match = existing ? matchScenesForReimport(existing, incomingContent) : null
  const matchedSceneCount = match
    ? match.incoming.filter(entry => entry.matchedSceneId).length
    : 0
  const newSceneCount = match
    ? match.incoming.filter(entry => !entry.matchedSceneId).length
    : incomingScenes.length
  const removed = match?.removed ?? []
  return {
    chapterNumber,
    suggestedChapterNumber,
    suggestedMismatch: suggestedChapterNumber !== null && suggestedChapterNumber !== chapterNumber,
    sectionTitles,
    sceneCount: incomingScenes.length,
    sceneTitles: incomingScenes.map(scene => scene.title),
    wordBudget: extractBlueprintV2WordBudget(incomingContent),
    hasExistingDetail: Boolean(existing),
    existingRevision: existing?.revision ?? null,
    matchedSceneCount,
    newSceneCount,
    removedSceneCount: removed.length,
    removedScenePreviews: removed.slice(0, 5).map(scene => (
      `《${scene.title}》${scene.markdown.trim().slice(0, 120)}${scene.markdown.trim().length > 120 ? '…' : ''}`
    )),
    baseRevision: existing?.revision ?? 0,
  }
}

function previewText(summary: ImportPreviewSummary, writingLanguage: 'zh-CN' | 'en-US'): string {
  const lines = writingLanguage === 'en-US' ? [
    `[Import preview — nothing written]`,
    `Target chapter: ${summary.chapterNumber}`,
    summary.suggestedMismatch
      ? `Warning: the document heading suggests Chapter ${summary.suggestedChapterNumber}, which differs from the target chapter ${summary.chapterNumber}. The import binds to the target chapter.`
      : `Document chapter heading matches the target.`,
    `Canonical sections: ${summary.sectionTitles.join('、') || '(none)'}`,
    `Scenes: ${summary.sceneCount}${summary.wordBudget !== null ? `; word budget: ${summary.wordBudget}` : ''}`,
    summary.hasExistingDetail
      ? `Existing detailed outline found (r${summary.existingRevision}): matched scenes ${summary.matchedSceneCount}, new scenes ${summary.newSceneCount}, scenes that would be removed ${summary.removedSceneCount}.`
      : `No existing detailed outline for this chapter; a new one will be created.`,
    ...summary.removedScenePreviews.map(preview => `To be removed: ${preview}`),
    `Call again with confirm_write: true to write (user confirmation still applies). Scene IDs of matched scenes are preserved so chapter-canvas links survive.`,
  ] : [
    `【导入预览——尚未写入】`,
    `目标章节：第${summary.chapterNumber}章`,
    summary.suggestedMismatch
      ? `警告：文档章题建议第 ${summary.suggestedChapterNumber} 章，与目标章（第${summary.chapterNumber}章）不一致；导入将绑定目标章。`
      : `文档章题与目标章一致。`,
    `一级分区：${summary.sectionTitles.join('、') || '（无）'}`,
    `分镜：${summary.sceneCount} 个${summary.wordBudget !== null ? `；字数预算：${summary.wordBudget}` : ''}`,
    summary.hasExistingDetail
      ? `该章已有 v2 细纲（r${summary.existingRevision}）：匹配沿用分镜 ${summary.matchedSceneCount} 个、新增分镜 ${summary.newSceneCount} 个、将被移除分镜 ${summary.removedSceneCount} 个。`
      : `该章尚无 v2 细纲；将新建。`,
    ...summary.removedScenePreviews.map(preview => `将被移除：${preview}`),
    `确认无误后携带 confirm_write: true 再次调用即可写入（应用层确认仍会先行）。匹配分镜沿用旧分镜 ID，章节画布链接因此存活。`,
  ]
  return lines.filter(Boolean).join('\n')
}

export const importChapterBlueprintV2Tool = buildAgentTool({
  name: 'import_chapter_blueprint_v2',
  description: '把整章 Markdown 细纲（七个分区与逐场分镜）导入章节蓝图 v2。首次调用只返回导入预览不写入；确认后携带 confirm_write: true 再次调用写入。重复导入按分镜标题匹配并沿用旧分镜 ID。不覆盖定稿记录（notes）与作者微操指导。',
  descriptionEn: 'Import a full-chapter Markdown detailed outline (seven canonical sections with scene storyboard) into blueprint v2. The first call returns a preview without writing; call again with confirm_write: true to write. Re-imports match scenes by title and keep scene IDs. Never touches finalized notes or author guidance.',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: { type: 'number', description: '目标章节号', descriptionEn: 'Target chapter number' },
      markdown: { type: 'string', description: '完整细纲 Markdown 原文（逐字保留，不改动内容）', descriptionEn: 'The full detailed-outline Markdown (kept verbatim)' },
      confirm_write: { type: 'boolean', description: '默认 false：仅返回预览。true 时执行写入。', descriptionEn: 'Default false: preview only. true performs the write.' },
    },
    required: ['chapter_number', 'markdown'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args, context) => {
    const text = (zhCN: string, enUS: string) => agentToolText(context, zhCN, enUS)
    const writingLanguage = context?.writingLanguage === 'en-US' ? 'en-US' as const : 'zh-CN' as const
    const chapterNumber = args.chapter_number
    if (!Number.isInteger(chapterNumber) || (chapterNumber as number) <= 0) {
      return { success: false, content: '', error: text('章节号无效', 'The chapter number is invalid') }
    }
    if (typeof args.markdown !== 'string' || !args.markdown.trim()) {
      return { success: false, content: '', error: text('缺少细纲 Markdown 内容', 'Missing the detailed-outline Markdown') }
    }
    const { project, projectSession } = requireAgentProject(context)

    // 解析（B）：只因超限/类型错误失败；解析失败零写入。
    let parseResult: ReturnType<typeof parseChapterBlueprintMarkdown>
    try {
      parseResult = parseChapterBlueprintMarkdown(args.markdown)
    } catch (error) {
      return {
        success: false,
        content: '',
        error: text(
          `细纲解析失败：${error instanceof Error ? error.message : String(error)}`,
          `Failed to parse the detailed outline: ${error instanceof Error ? error.message : String(error)}`,
        ),
      }
    }
    assertAgentProjectCurrent(context)
    const content = { ...parseResult.content, chapterNumber: chapterNumber as number }

    const existing = await ipc.invokeWithProjectSession(
      projectSession, 'db:blueprint-v2-get', chapterNumber as number, project.path,
    ) as ChapterBlueprintV2DetailRead | null
    assertAgentProjectCurrent(context)
    if (existing) {
      const readStatus = (existing as { readStatus?: string }).readStatus
      if (readStatus === 'needs-newer-app') {
        return {
          success: false,
          content: '',
          error: text(
            '该章细纲由更新版本的应用写入，请先升级应用，再决定是否删除后重新导入。',
            'The existing detailed outline was written by a newer app version. Upgrade the app first, then decide whether to delete and re-import.',
          ),
        }
      }
      if (readStatus === 'corrupt') {
        return {
          success: false,
          content: '',
          error: text(
            '该章已有细纲但存储损坏（原始 Markdown 仍保留在数据库中）；请先在细纲界面确认或删除后再导入。',
            'The chapter has a detailed outline whose storage is corrupted (the raw Markdown remains in the database); confirm or delete it in the outline UI before importing.',
          ),
        }
      }
    }

    const summary = summarize(chapterNumber as number, parseResult.suggestedChapterNumber, content, existing)
    if (!args.confirm_write) {
      return { success: true, content: previewText(summary, writingLanguage) }
    }

    // 重复导入（契约 §4.3）：匹配分镜沿用旧 scene id / presence / canvasNodeId。
    const merged = existing ? applyBlueprintV2Reimport(existing, content, chapterNumber as number) : content
    assertAgentToolActive(context)
    context?.markSideEffectStarted?.()
    const save = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-save', {
      chapterNumber: chapterNumber as number,
      baseRevision: summary.baseRevision,
      content: merged,
    }, project.path)
    if (!save.success) {
      const conflictHint = save.conflict
        ? text(
          `该章细纲已被并发修改（当前 r${save.currentRevision}）；请重新调用本工具获取最新预览后再确认写入。`,
          `The detailed outline changed concurrently (current r${save.currentRevision}); re-run this tool for a fresh preview before confirming.`,
        )
        : ''
      return {
        success: false,
        content: '',
        error: [save.error ? text(`细纲写入失败：${save.error}`, `Failed to save the detailed outline: ${save.error}`) : '', conflictHint].filter(Boolean).join(' '),
      }
    }
    return {
      success: true,
      content: text(
        `第${chapterNumber}章细纲已保存（r${save.revision}，${summary.sceneCount} 个分镜${summary.wordBudget !== null ? `，字数预算 ${summary.wordBudget}` : ''}）；` +
          `投影字段已同步刷新，定稿记录（notes）与作者微操指导未受影响。`,
        `Chapter ${chapterNumber} detailed outline saved (r${save.revision}, ${summary.sceneCount} scene(s)${summary.wordBudget !== null ? `, word budget ${summary.wordBudget}` : ''}); ` +
          `projected fields refreshed; finalized notes and author guidance untouched.`,
      ),
    }
  },
})
