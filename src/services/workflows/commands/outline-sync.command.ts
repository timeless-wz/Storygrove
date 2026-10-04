/**
 * 正文—细纲同步建议 工作流命令（knowledge-action-outline-sync-contract §5.2）。
 *
 * 边界（冻结）：
 * - 只对作者显式绑定（drafts.blueprint_chapter_number）的章节生成建议；不按正文章号猜蓝图章号。
 * - 模型只提出补丁条目（带正文证据与 v2 稳定条目 ID）；作者确认前不改正式细纲。
 * - 仅措辞差异 → noSubstantiveChange 候选，零补丁；未完成稿不把未写到的后半段推断为删除。
 * - itemId/beforeMarkdown 在本命令内预校验，主进程创建候选时再次冻结校验。
 */

import { ipc } from '../../ipc-client'
import { requireIpcSuccess } from '../../ipc-result'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import type { DraftMeta } from '../../../../electron/repositories/draft-repository'
import type { ChapterBlueprintV2DetailRead } from '../../../shared/blueprint-v2'
import {
  buildOutlineSyncIdMap,
  OUTLINE_SYNC_ITEM_ID_PREFIX,
  type OutlineSyncChangeKind,
  type OutlineSyncPatchItem,
} from '../../../shared/outline-sync'
import { randomCanvasUuid } from '../../../shared/canvas-ids'
import { BaseWorkflowCommand } from './base-command'
import type { CommandExecuteParams } from './base-command'

export interface OutlineSyncSuggestParams {
  chapterNumber: number
  draftId: number
  /** 作者标记「未完成稿」：未写到的后半段不得推断为删掉。 */
  unfinishedDraft: boolean
}

interface RawPatchItem {
  changeKind?: unknown
  explanation?: unknown
  proseEvidence?: unknown
  op?: unknown
}

const SUGGEST_SYSTEM_PROMPT = [
  '你是小说"正文与章节细纲对照"的审读助手。你的任务是逐项对比实际正文与章节细纲，输出需要回写细纲的变化建议。',
  '输出严格 JSON：{"noSubstantiveChange":boolean,"summaryNote":string,"items":[{"changeKind":string,"explanation":string,"proseEvidence":string,"op":{...}}]}。',
  'changeKind 可选：scene-order|scene-content|scene-added|scene-omitted|character-action|location-time|knowledge|conflict-outcome|hook|field-content。',
  'op 只有四种：{"kind":"replace-item","sectionId":string,"itemId":string,"beforeMarkdown":string,"afterMarkdown":string,"afterTitle"?（仅 scene 条目可改标题）}',
  '{"kind":"add-scene","afterSceneId":string|null,"title":string,"markdown":string}',
  '{"kind":"remove-item","sectionId":string,"itemId":string,"beforeMarkdown":string}',
  '{"kind":"reorder-scenes","orderedSceneIds":string[]}。',
  '硬性规则：',
  '1. itemId 必须来自输入清单；beforeMarkdown 必须逐字复制输入清单里该条目的 markdown，一个字符都不能改。',
  '2. 只有正文与细纲的实质剧情差异（事件顺序、人物行动、地点时间、获知信息、冲突结果、钩子、场景新增/省略）才产出条目；纯措辞差异设置 noSubstantiveChange=true 且 items 为空。',
  '3. 细纲中存在但正文完全没写到的内容：若作者标记了未完成稿，一律不输出 remove-item/scene-omitted；未标记时也要在 explanation 里说明证据。',
  '4. proseEvidence 必须是正文原文的逐字片段（≤300 字）；explanation 说明正文证据如何支撑该变化。',
  '5. 不建议改写 userGuidance、notes 等作者字段；不把整个正文塞进细纲。',
].join('\n')

export class OutlineSyncSuggestCommand extends BaseWorkflowCommand<{ candidateId: string; itemCount: number; noSubstantiveChange: boolean }> {
  constructor(
    private readonly projectSession: ProjectSessionContext,
    private readonly params: OutlineSyncSuggestParams,
  ) {
    super()
  }

  async execute(params: CommandExecuteParams): Promise<{ candidateId: string; itemCount: number; noSubstantiveChange: boolean }> {
    const { context, callbacks } = params
    const { chapterNumber, draftId } = this.params
    // 1) 绑定检查：显式 drafts.blueprint_chapter_number 定位目标。
    const draftMeta = await ipc.invokeWithProjectSession(
      this.projectSession, 'db:draft-get-meta', draftId, this.projectSession.projectPath,
    ) as DraftMeta | null
    if (!draftMeta) throw new Error(`草稿不存在：${draftId}`)
    if (draftMeta.blueprintChapterNumber !== chapterNumber) {
      throw new Error(`草稿 ${draftId} 未绑定到第 ${chapterNumber} 章蓝图；请先在正文编辑器绑定蓝图`)
    }
    // 2) 冻结蓝图（读取后不再重读；候选创建时主进程会复核 revision/contentHash）。
    const detail = await ipc.invokeWithProjectSession(
      this.projectSession, 'db:blueprint-v2-get', chapterNumber, this.projectSession.projectPath,
    ) as ChapterBlueprintV2DetailRead | null
    if (!detail) throw new Error(`第 ${chapterNumber} 章暂无 v2 细纲，无法对照同步`)
    if (detail.readStatus) throw new Error(`第 ${chapterNumber} 章细纲读取异常（${detail.readStatus}）`)
    // 3) 冻结正文。
    const draftFull = await ipc.invokeWithProjectSession(
      this.projectSession, 'db:draft-get-full', draftId, this.projectSession.projectPath,
    ) as { content: string } | null
    if (!draftFull) throw new Error(`草稿正文不存在：${draftId}`)
    const prose = draftFull.content
    if (!prose.trim()) throw new Error('正文为空，无需对照同步')
    callbacks.log(`已冻结第 ${chapterNumber} 章蓝图 revision ${detail.revision} 与草稿 ${draftId} v${draftMeta.version}`)
    callbacks.setProgress(15)

    // 4) 组装提示：稳定 ID 清单 + 全部条目原文 + 正文全文。
    const idMap = buildOutlineSyncIdMap(detail)
    const outlineDigest = idMap.map(section => {
      const lines = section.items.map(item => {
        const head = item.kind === 'scene' ? `分镜「${item.title ?? ''}」` : item.kind === 'field' ? `字段「${item.label ?? ''}」` : item.kind
        return `  - [${item.id}] ${head}｜markdown 逐字如下（两行 # 包夹）：\n#\n${item.markdown}\n#`
      })
      return `- 分区 [${section.sectionId}] ${section.sectionTitle}\n${lines.join('\n') || '  （空）'}`
    }).join('\n')
    const prompt = [
      `【章节】第 ${chapterNumber} 章（草稿 ${draftId} v${draftMeta.version}${this.params.unfinishedDraft ? '；作者标记：未完成稿，未写到的后半段不是被删除' : ''}）`,
      '【章节细纲（逐条给出稳定 ID 与逐字原文）】',
      outlineDigest,
      '【实际正文（全文）】',
      prose,
      '【任务】对照正文与细纲，按系统提示的 JSON 合同输出需要回写细纲的逐项变化建议；没有实质变化时 noSubstantiveChange=true 且 items 为空。',
    ].join('\n\n')

    callbacks.setProgress(30)
    const raw = await this.executeWithGenerationRuntime('structured', params, async () => {
      return this.callLLM(
        prompt,
        SUGGEST_SYSTEM_PROMPT,
        callbacks,
        { responseFormat: { type: 'json_object' }, purpose: 'outline-sync-suggest', reasoningStage: 'review' },
        context,
      )
    })
    callbacks.setProgress(75)
    const parsed = this.parseJSON(this.stripThinkingTags(raw)) as {
      noSubstantiveChange?: unknown
      summaryNote?: unknown
      items?: unknown
    }

    // 5) 解码 + 预校验条目（itemId 必须存在；beforeMarkdown 必须与当前内容一致）。
    const markdownById = new Map(idMap.flatMap(section => section.items.map(item => [item.id, item.markdown] as const)))
    const knownItemIds = new Set(markdownById.keys())
    const rawItems = Array.isArray(parsed.items) ? parsed.items as RawPatchItem[] : []
    const items: OutlineSyncPatchItem[] = []
    let dropped = 0
    for (const rawItem of rawItems.slice(0, 40)) {
      if (!rawItem || typeof rawItem !== 'object') continue
      const changeKind = typeof rawItem.changeKind === 'string' ? rawItem.changeKind as OutlineSyncChangeKind : 'scene-content'
      const explanation = typeof rawItem.explanation === 'string' ? rawItem.explanation.slice(0, 2000) : ''
      const proseEvidence = typeof rawItem.proseEvidence === 'string' ? rawItem.proseEvidence.slice(0, 1200) : ''
      const op = rawItem.op as OutlineSyncPatchItem['op'] | undefined
      if (!op || typeof op !== 'object') { dropped += 1; continue }
      if (op.kind === 'replace-item' || op.kind === 'remove-item') {
        if (!knownItemIds.has(op.itemId)
          || (typeof op.beforeMarkdown !== 'string')
          || markdownById.get(op.itemId) !== op.beforeMarkdown) {
          dropped += 1
          callbacks.log(`放弃 1 条建议：条目 ${String((op as { itemId?: unknown }).itemId)} 不在细纲中或原文快照不一致`)
          continue
        }
      }
      items.push({
        id: `${OUTLINE_SYNC_ITEM_ID_PREFIX}-${randomCanvasUuid()}`,
        changeKind,
        explanation,
        proseEvidence,
        op,
        status: 'pending',
      })
    }
    const noSubstantiveChange = items.length === 0 && (parsed.noSubstantiveChange === true || rawItems.length === 0)
    const summaryNote = typeof parsed.summaryNote === 'string' ? parsed.summaryNote.slice(0, 2000) : ''
    callbacks.log(`建议解析完成：${items.length} 条补丁${dropped > 0 ? `，${dropped} 条因引用失效被丢弃` : ''}${noSubstantiveChange ? '（无实质变化）' : ''}`)

    // 6) 候选落库（主进程重新冻结正文/蓝图版本；作者确认前不写正式细纲）。
    const created = requireIpcSuccess(await ipc.invokeWithProjectSession(
      this.projectSession,
      'db:outline-sync-create-candidate',
      {
        chapterNumber,
        draftId,
        unfinishedDraft: this.params.unfinishedDraft,
        items,
        noSubstantiveChange,
        summaryNote,
      },
      this.projectSession.projectPath,
    ), '创建同步候选')
    if (!created.candidate) throw new Error('同步候选创建结果缺失')
    for (const rejected of created.rejectedItems ?? []) {
      callbacks.log(`候选创建时拒收 1 条：${rejected.reason}`)
    }
    callbacks.setProgress(100)
    return {
      candidateId: created.candidate.id,
      itemCount: created.candidate.items.length,
      noSubstantiveChange: created.candidate.noSubstantiveChange,
    }
  }
}
