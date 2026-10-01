/**
 * read_blueprint — 读取章节蓝图
 */
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { agentToolText, assertAgentProjectCurrent, requireAgentProject } from './project-context'
import { assertNoLossOnSerialize } from '../../../shared/blueprint-v2-markdown'
import type { ChapterBlueprintV2DetailRead } from '../../../shared/blueprint-v2'


export const readBlueprintTool = buildAgentTool({
  name: 'read_blueprint',
  description: '读取指定章节蓝图。按 chapter_number 读取时默认返回该章完整 v2 Markdown 细纲；不带章号时只返回有界列表摘要。',
  descriptionEn: 'Read a chapter blueprint. With chapter_number, return the full v2 Markdown outline by default; without it, return a bounded summary list.',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: '章节号（可选）。不填则列出所有蓝图文件。',
        descriptionEn: 'Optional chapter number. Omit it to list all chapter blueprints.',
      },
      include_detail: {
        type: 'boolean',
        description: '指定章节时默认 true，按需读取完整细纲；设为 false 只读简纲字段。',
        descriptionEn: 'Defaults to true for a chapter read. Set false to read only the simple-outline fields.',
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args, context) => {
    const { project, projectSession } = requireAgentProject(context)
    const text = (zhCN: string, enUS: string) => agentToolText(context, zhCN, enUS)

    const chapterNum = args.chapter_number as number | undefined

    if (chapterNum !== undefined) {
      if (!Number.isSafeInteger(chapterNum) || chapterNum <= 0) {
        return { success: false, content: '', error: text('章节号无效', 'The chapter number is invalid') }
      }
      const [bp, detail] = await Promise.all([
        ipc.invokeWithProjectSession(projectSession, 'db:blueprint-get', chapterNum, project.path),
        args.include_detail === false
          ? Promise.resolve(null)
          : ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-get', chapterNum, project.path) as Promise<ChapterBlueprintV2DetailRead | null>,
      ])
      assertAgentProjectCurrent(context)
      if (!bp && !detail) {
        return { success: false, content: '', error: text(`第 ${chapterNum} 章蓝图不存在或读取失败`, `The blueprint for Chapter ${chapterNum} does not exist or could not be read`) }
      }
      let markdown = ''
      if (detail) {
        if (detail.readStatus) {
          markdown = detail.rawMarkdown ?? ''
        } else {
          try {
            markdown = assertNoLossOnSerialize(detail)
          } catch (error) {
            return {
              success: false,
              content: '',
              error: text(
                `第 ${chapterNum} 章细纲无法通过无损导出自检：${error instanceof Error ? error.message : String(error)}`,
                `Chapter ${chapterNum} failed the lossless outline export check: ${error instanceof Error ? error.message : String(error)}`,
              ),
            }
          }
        }
      }
      const legacy = bp ? text(
        `\n\n【旧版简纲与独立字段】\n标题：${bp.title}\n章节定位：${bp.role}\n目的：${bp.purpose}\n关键事件：${bp.keyEvents}\n角色：${bp.characters.join('、')}\n悬念：${bp.suspenseHook}\n定稿记录：${bp.notes}\n作者微操指导：${bp.userGuidance}`,
        `\n\n[Legacy simple-outline and independent fields]\nTitle: ${bp.title}\nRole: ${bp.role}\nPurpose: ${bp.purpose}\nKey events: ${bp.keyEvents}\nCharacters: ${bp.characters.join(', ')}\nSuspense hook: ${bp.suspenseHook}\nFinalized notes: ${bp.notes}\nAuthor guidance: ${bp.userGuidance}`,
      ) : ''
      const full = markdown
        ? text(`\n\n【完整 v2 细纲 Markdown】\n${markdown}`, `\n\n[Full v2 detailed-outline Markdown]\n${markdown}`)
        : detail?.readStatus
          ? text(`\n\n【细纲读取状态：${detail.readStatus}】${markdown ? `\n${markdown}` : ''}`, `\n\n[Outline read status: ${detail.readStatus}]${markdown ? `\n${markdown}` : ''}`)
          : ''
      return { success: true, content: text(`📋 第 ${chapterNum} 章蓝图${legacy}${full}`, `📋 Chapter ${chapterNum} blueprint${legacy}${full}`) }
    }

    // 列出所有蓝图文件
    try {
      const [bps, details] = await Promise.all([
        ipc.invokeWithProjectSession(projectSession, 'db:blueprint-list-summary', project.path),
        ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-summary-list', project.path),
      ])
      assertAgentProjectCurrent(context)
      const legacyByChapter = new Map((bps ?? []).map(blueprint => [blueprint.chapterNumber, blueprint]))
      const detailByChapter = new Map(details.map(detail => [detail.chapterNumber, detail]))
      const chapterNumbers = [...new Set([
        ...(bps ?? []).map(blueprint => blueprint.chapterNumber),
        ...details.map(detail => detail.chapterNumber),
      ])].sort((left, right) => left - right)
      if (chapterNumbers.length === 0) {
        return { success: true, content: text('⚠️ 蓝图为空。建议先通过工作流生成章节蓝图。', '⚠️ There are no blueprints yet. Generate chapter blueprints with the workflow first.') }
      }

      const rows = chapterNumbers.slice(0, 100)
      const list = rows.map(chapterNumber => {
        const blueprint = legacyByChapter.get(chapterNumber)
        const summary = detailByChapter.get(chapterNumber)
        const title = blueprint?.title || `第 ${chapterNumber} 章`
        return text(
          `  - 第 ${chapterNumber} 章: ${title.slice(0, 100)}${summary ? `（v2，${summary.sceneCount} 个分镜）` : ''}`,
          `  - Chapter ${chapterNumber}: ${title.slice(0, 100)}${summary ? ` (v2, ${summary.sceneCount} scenes)` : ''}`,
        )
      }).join('\n')
      const omitted = chapterNumbers.length - rows.length
      return { success: true, content: text(`📋 蓝图列表（${chapterNumbers.length} 个；最多显示 100 个）\n${list}${omitted > 0 ? `\n…另有 ${omitted} 章` : ''}\n\n使用 chapter_number 参数可按需读取该章完整 v2 细纲。`, `📋 Blueprint list (${chapterNumbers.length}; showing up to 100)\n${list}${omitted > 0 ? `\n…${omitted} more chapters` : ''}\n\nUse chapter_number to read that chapter's full v2 outline on demand.`) }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        content: '',
        error: context?.writingLanguage === 'en-US' && /[\u3400-\u9fff]/u.test(detail)
          ? text('读取蓝图失败', 'Could not read blueprints')
          : text(`读取蓝图失败：${detail}`, `Could not read blueprints: ${detail}`),
      }
    }
  },
})
