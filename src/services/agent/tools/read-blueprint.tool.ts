/**
 * read_blueprint — 读取章节蓝图
 */
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { agentToolText, assertAgentProjectCurrent, requireAgentProject } from './project-context'
import { assertNoLossOnSerialize } from '../../../shared/blueprint-v2-markdown'


export const readBlueprintTool = buildAgentTool({
  name: 'read_blueprint',
  description: '读取指定章节的完整蓝图 Markdown（含未识别分区、逐场分镜、规则与禁忌）；不填章节号时只返回有界章节摘要。',
  descriptionEn: 'Read the complete chapter blueprint Markdown, including custom sections, scenes, rules, and taboos. Without a chapter number, return bounded chapter summaries only.',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: '章节号（可选）。填写时读取完整细纲；不填时只列有界摘要。',
        descriptionEn: 'Optional chapter number. When provided, read its complete outline; otherwise list bounded summaries.',
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args, context) => {
    const { project, projectSession } = requireAgentProject(context)
    const text = (zhCN: string, enUS: string) => agentToolText(context, zhCN, enUS)

    const chapterNum = args.chapter_number as number | undefined

    if (chapterNum !== undefined) {
      if (!Number.isSafeInteger(chapterNum) || chapterNum < 1) {
        return { success: false, content: '', error: text('章节号无效', 'The chapter number is invalid') }
      }
      const bp = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-get', chapterNum, project.path)
      assertAgentProjectCurrent(context)
      if (!bp) {
        return { success: false, content: '', error: text(`第 ${chapterNum} 章蓝图不存在或读取失败`, `The blueprint for Chapter ${chapterNum} does not exist or could not be read`) }
      }
      const detail = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-get', chapterNum, project.path)
      assertAgentProjectCurrent(context)
      if (detail?.readStatus === 'corrupt' || detail?.readStatus === 'needs-newer-app') {
        if (!detail.rawMarkdown) {
          return { success: false, content: '', error: text('完整细纲无法解析，且没有可展示的原始 Markdown；请勿以旧版简纲覆盖。', 'The full outline could not be parsed and no raw Markdown is available. Do not overwrite it with the legacy projection.') }
        }
        return { success: true, content: text(
          `📋 第 ${chapterNum} 章细纲（${detail.readStatus === 'corrupt' ? '结构损坏' : '需要较新版本'}；以下为存储原文）\n\n${detail.rawMarkdown}`,
          `📋 Chapter ${chapterNum} outline (${detail.readStatus === 'corrupt' ? 'corrupt structure' : 'requires a newer app'}; stored source follows)\n\n${detail.rawMarkdown}`,
        ) }
      }
      if (detail) {
        let markdown: string
        try {
          markdown = assertNoLossOnSerialize(detail)
        } catch {
          return { success: false, content: '', error: text('完整细纲无法无损序列化；请先在蓝图界面检查，避免覆盖原文。', 'The complete outline failed the lossless serialization check. Inspect it in the blueprint view before editing.') }
        }
        const legacyContext = [
          bp.role ? `章节定位：${bp.role}` : '',
          bp.characters.length ? `出场角色：${bp.characters.join('、')}` : '',
          bp.userGuidance ? `作者指导（独立 v1 字段）：${bp.userGuidance}` : '',
        ].filter(Boolean).join('\n')
        return { success: true, content: text(
          `📋 第 ${chapterNum} 章完整章节蓝图 Markdown${legacyContext ? `\n\n${legacyContext}` : ''}\n\n${markdown}`,
          `📋 Complete Chapter ${chapterNum} blueprint Markdown${legacyContext ? `\n\n${legacyContext}` : ''}\n\n${markdown}`,
        ) }
      }
      return { success: true, content: text(
        `📋 第 ${chapterNum} 章旧版简纲\n\n标题：${bp.title}\n章节定位：${bp.role}\n本章目的：${bp.purpose}\n关键事件：\n${bp.keyEvents}\n出场角色：${bp.characters.join('、')}\n章尾悬念：${bp.suspenseHook}${bp.userGuidance ? `\n作者指导（独立 v1 字段）：${bp.userGuidance}` : ''}`,
        `📋 Legacy outline for Chapter ${chapterNum}\n\nTitle: ${bp.title}\nRole: ${bp.role}\nPurpose: ${bp.purpose}\nKey events:\n${bp.keyEvents}\nCharacters: ${bp.characters.join(', ')}\nEnding hook: ${bp.suspenseHook}${bp.userGuidance ? `\nAuthor guidance (separate v1 field): ${bp.userGuidance}` : ''}`,
      ) }
    }

    // 列出所有蓝图文件
    try {
      const [bps, v2Summaries] = await Promise.all([
        ipc.invokeWithProjectSession(projectSession, 'db:blueprint-get-all', project.path),
        ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-summary-list', project.path),
      ])
      assertAgentProjectCurrent(context)
      if (!bps || bps.length === 0) {
        return { success: true, content: text('⚠️ 蓝图为空。建议先通过工作流生成章节蓝图。', '⚠️ There are no blueprints yet. Generate chapter blueprints with the workflow first.') }
      }

      const summaryByChapter = new Map(v2Summaries.map(summary => [summary.chapterNumber, summary]))
      const listLimit = 100
      const list = bps.slice(0, listLimit).map(blueprint => {
        const title = (blueprint.title || '无标题').slice(0, 160)
        const summary = summaryByChapter.get(blueprint.chapterNumber)
        const scenes = summary?.sceneTitles.slice(0, 4).map(scene => scene.slice(0, 120)) ?? []
        const suffix = summary
          ? `；正式分镜 ${summary.sceneCount} 场${scenes.length ? `：${scenes.join('、')}${summary.sceneCount > scenes.length ? '…' : ''}` : ''}`
          : `；旧版简纲${blueprint.keyEvents.trim() ? `：${blueprint.keyEvents.split(/\r?\n/u).slice(0, 2).join(' / ').slice(0, 240)}` : ''}`
        return text(
          `  - 第 ${blueprint.chapterNumber} 章：${title}${suffix}`,
          `  - Chapter ${blueprint.chapterNumber}: ${title}${summary ? `; ${summary.sceneCount} formal scenes${scenes.length ? `: ${scenes.join(', ')}${summary.sceneCount > scenes.length ? '…' : ''}` : ''}` : '; legacy outline'}`,
        )
      }).join('\n')
      const remaining = bps.length > listLimit
        ? text(`\n另有 ${bps.length - listLimit} 章未列出，请按章节号分段查询。`, `\n${bps.length - listLimit} more chapters were omitted; query them in chapter ranges.`)
        : ''
      return { success: true, content: text(
        `📋 蓝图摘要（${bps.length} 章；最多显示 ${listLimit} 章，不包含分镜正文）\n${list}${remaining}\n\n使用 chapter_number 参数可以读取具体章节的完整细纲 Markdown。`,
        `📋 Blueprint summaries (${bps.length} chapters; showing at most ${listLimit}, without scene bodies)\n${list}${remaining}\n\nUse chapter_number to read a chapter's complete outline Markdown.`,
      ) }
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
