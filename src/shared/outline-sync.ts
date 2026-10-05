/**
 * 正文反向修纲（prose → 细纲 v2 同步）— 跨模块唯一权威类型与补丁应用纯函数
 * （knowledge-action-outline-sync-contract §5）。
 *
 * 权威边界（冻结）：
 * - 更新对象是正式 v2 细纲（blueprint_details）；候选补丁在作者确认前绝不写入。
 * - 补丁以 v2 稳定分区/条目 ID 定位，绝不做全文正则替换，也不以段落位置为唯一定位；
 *   replace/remove 前必须先验证 beforeMarkdown 仍与当前内容相等（否则该条目 stale）。
 * - 未涉及内容、作者指导、卷归属、notes 等独立元数据保持原样（本模块只动被点名的条目）。
 */

import {
  assertValidChapterBlueprintV2Content,
  createBlueprintV2SceneId,
  findBlueprintV2CanonicalSection,
  getBlueprintV2Scenes,
  type BlueprintV2SectionId,
  type ChapterBlueprintV2Content,
} from './blueprint-v2'

export const OUTLINE_SYNC_CANDIDATE_ID_PREFIX = 'osy'
export const OUTLINE_SYNC_ITEM_ID_PREFIX = 'osi'

export type OutlineSyncChangeKind =
  | 'scene-order' | 'scene-content' | 'scene-added' | 'scene-omitted'
  | 'character-action' | 'location-time' | 'knowledge' | 'conflict-outcome'
  | 'hook' | 'field-content' | 'no-change'

export const OUTLINE_SYNC_CHANGE_KINDS: readonly OutlineSyncChangeKind[] = [
  'scene-order', 'scene-content', 'scene-added', 'scene-omitted',
  'character-action', 'location-time', 'knowledge', 'conflict-outcome',
  'hook', 'field-content', 'no-change',
]

export type OutlineSyncPatchOp =
  | { kind: 'replace-item'; sectionId: BlueprintV2SectionId; itemId: string; beforeMarkdown: string; afterMarkdown: string; afterTitle?: string }
  | { kind: 'add-scene'; afterSceneId: string | null; title: string; markdown: string }
  | { kind: 'remove-item'; sectionId: BlueprintV2SectionId; itemId: string; beforeMarkdown: string }
  | { kind: 'reorder-scenes'; orderedSceneIds: string[] }

export interface OutlineSyncPatchItem {
  id: string                        // osi-<uuid>
  changeKind: OutlineSyncChangeKind
  explanation: string
  proseEvidence: string
  proseEvidenceOffset?: number
  op: OutlineSyncPatchOp
  status: 'pending' | 'accepted' | 'rejected'
}

export interface OutlineSyncProseSource {
  draftId: number
  version: number
  status: 'draft' | 'finalized'
  finalizationId?: string
  /** 冻结时对正文全文计算的 sha256；提交时复核依据。 */
  contentHash: string
  /** 作者标记「未完成稿」：未写到的后半段不得推断为删掉。 */
  unfinishedDraft: boolean
}

export type OutlineSyncCandidateStatus = 'pending' | 'committed' | 'discarded' | 'stale'

export interface OutlineSyncCandidate {
  id: string
  chapterNumber: number
  prose: OutlineSyncProseSource
  blueprint: { chapterNumber: number; revision: number; contentHash: string }
  items: OutlineSyncPatchItem[]
  noSubstantiveChange: boolean
  summaryNote: string
  status: OutlineSyncCandidateStatus
  createdAt: string
  updatedAt: string
}

/** 同步成功后的下游影响提示（只查询不改写；contract §5.2）。 */
export interface OutlineSyncAffected {
  threadPlanIds: number[]
  knowledgeRecordIds: string[]
  actionIds: string[]
  foreshadowingIds: string[]
  /** 记录的正文锚点已失效（需重新定位），保留原引用。 */
  staleProseAnchorRecordIds: string[]
}

/** 创建候选的输入（主进程负责重新冻结正文/蓝图版本）。 */
export interface OutlineSyncCreateCandidateInput {
  chapterNumber: number
  draftId: number
  unfinishedDraft: boolean
  items: OutlineSyncPatchItem[]
  noSubstantiveChange: boolean
  summaryNote: string
}

// ===== 结构校验（模型输出进入候选前的防线） =====

export function assertValidOutlineSyncPatchItem(item: OutlineSyncPatchItem): void {
  if (!item || typeof item !== 'object') throw new Error('补丁条目无效')
  if (typeof item.id !== 'string' || !item.id.startsWith(`${OUTLINE_SYNC_ITEM_ID_PREFIX}-`)) {
    throw new Error(`补丁条目 ID 无效：${String(item.id)}`)
  }
  if (!OUTLINE_SYNC_CHANGE_KINDS.includes(item.changeKind)) {
    throw new Error(`未知的补丁变化类型：${String(item.changeKind)}`)
  }
  if (typeof item.explanation !== 'string' || item.explanation.length > 2000) {
    throw new Error('补丁说明无效或超限')
  }
  if (typeof item.proseEvidence !== 'string' || item.proseEvidence.length > 1200) {
    throw new Error('正文证据无效或超限')
  }
  const op = item.op
  if (!op || typeof op !== 'object') throw new Error('补丁操作无效')
  if (op.kind === 'replace-item') {
    if (typeof op.itemId !== 'string' || !op.itemId) throw new Error('replace-item 缺少条目 ID')
    if (typeof op.beforeMarkdown !== 'string' || typeof op.afterMarkdown !== 'string') {
      throw new Error('replace-item 缺少前后正文')
    }
    if (op.afterTitle !== undefined && typeof op.afterTitle !== 'string') throw new Error('afterTitle 无效')
  } else if (op.kind === 'add-scene') {
    if (typeof op.title !== 'string' || !op.title.trim()) throw new Error('add-scene 缺少标题')
    if (typeof op.markdown !== 'string') throw new Error('add-scene 缺少正文')
  } else if (op.kind === 'remove-item') {
    if (typeof op.itemId !== 'string' || !op.itemId) throw new Error('remove-item 缺少条目 ID')
    if (typeof op.beforeMarkdown !== 'string') throw new Error('remove-item 缺少原文快照')
  } else if (op.kind === 'reorder-scenes') {
    if (!Array.isArray(op.orderedSceneIds) || op.orderedSceneIds.some(id => typeof id !== 'string')) {
      throw new Error('reorder-scenes 的顺序列表无效')
    }
  } else {
    throw new Error(`未知的补丁操作类型：${String((op as { kind?: unknown }).kind)}`)
  }
}

/** 为模型提示构建稳定的分区/条目 ID 清单（AI 只允许引用这里出现的 ID）。 */
export interface OutlineSyncIdMapEntry {
  sectionId: BlueprintV2SectionId | 'custom'
  sectionTitle: string
  items: Array<{ id: string; kind: string; label?: string; title?: string; markdown: string }>
}

export function buildOutlineSyncIdMap(content: ChapterBlueprintV2Content): OutlineSyncIdMapEntry[] {
  return content.sections.map(section => {
    if (section.kind === 'custom') {
      return { sectionId: 'custom' as const, sectionTitle: section.title, items: [] }
    }
    return {
      sectionId: section.id,
      sectionTitle: section.title,
      items: section.items.map(item => ({
        id: item.id,
        kind: item.kind,
        ...(item.kind === 'field' ? { label: item.label } : {}),
        ...(item.kind === 'scene' ? { title: item.title } : {}),
        markdown: item.kind === 'scene' ? item.markdown : item.markdown,
      })),
    }
  })
}

// ===== 补丁应用（纯函数；提交事务内调用） =====

export interface OutlineSyncApplyResult {
  content: ChapterBlueprintV2Content
  appliedItemIds: string[]
  skipped: Array<{ itemId: string; reason: string }>
}

function sectionMarkdownEquals(
  content: ChapterBlueprintV2Content,
  sectionId: BlueprintV2SectionId,
  itemId: string,
  beforeMarkdown: string,
): { ok: boolean; reason?: string } {
  const section = findBlueprintV2CanonicalSection(content, sectionId)
  if (!section) return { ok: false, reason: `分区不存在：${sectionId}` }
  const item = section.items.find(entry => entry.id === itemId)
  if (!item) return { ok: false, reason: `条目不存在：${itemId}` }
  if (item.markdown !== beforeMarkdown) return { ok: false, reason: `条目 ${itemId} 已被修改过，快照过期` }
  return { ok: true }
}

/**
 * 把被接受的补丁条目应用到冻结的 v2 内容上。
 * - 任何条目校验失败（分区/条目缺失、beforeMarkdown 过期）只跳过该条目并记录原因；
 *   全部失败时 content 原样返回，调用方据此阻止提交。
 * - add-scene 的条目 ID 由本函数分配（bps- 前缀），跨会话不重复。
 * - 未被接受的条目不参与应用；应用顺序 = items 数组顺序（AI 输出顺序即建议顺序）。
 */
export function applyOutlineSyncPatchItems(
  content: ChapterBlueprintV2Content,
  items: OutlineSyncPatchItem[],
  acceptedItemIds: readonly string[],
  options?: { createSceneId?: () => string },
): OutlineSyncApplyResult {
  const accepted = new Set(acceptedItemIds)
  let working = structuredClone(content) as ChapterBlueprintV2Content
  const appliedItemIds: string[] = []
  const skipped: Array<{ itemId: string; reason: string }> = []

  for (const item of items) {
    if (!accepted.has(item.id)) continue
    try {
      assertValidOutlineSyncPatchItem(item)
    } catch (error) {
      skipped.push({ itemId: item.id, reason: String(error) })
      continue
    }
    const op = item.op
    if (op.kind === 'replace-item' || op.kind === 'remove-item') {
      const sectionId = op.kind === 'replace-item' ? op.sectionId : op.sectionId
      const check = sectionMarkdownEquals(working, sectionId, op.itemId, op.beforeMarkdown)
      if (!check.ok) {
        skipped.push({ itemId: item.id, reason: check.reason ?? '条目快照过期' })
        continue
      }
      working = {
        ...working,
        sections: working.sections.map(section => {
          if (!(section.kind === 'canonical' && section.id === sectionId)) return section
          return {
            ...section,
            items: section.items.flatMap(entry => {
              if (entry.id !== op.itemId) return [entry]
              if (op.kind === 'remove-item') return []
              if (entry.kind === 'scene') {
                const nextTitle = op.afterTitle?.trim() ? op.afterTitle : entry.title
                return [{ ...entry, title: nextTitle, markdown: op.afterMarkdown }]
              }
              return [{ ...entry, markdown: op.afterMarkdown }]
            }),
          }
        }),
      }
      appliedItemIds.push(item.id)
      continue
    }
    if (op.kind === 'add-scene') {
      const storyboard = findBlueprintV2CanonicalSection(working, 'storyboard')
      if (!storyboard) {
        skipped.push({ itemId: item.id, reason: '细纲没有逐场分镜分区，无法新增分镜' })
        continue
      }
      const sceneId = (options?.createSceneId ?? createBlueprintV2SceneId)()
      const insertIndex = op.afterSceneId
        ? storyboard.items.findIndex(entry => entry.id === op.afterSceneId) + 1
        : storyboard.items.length
      const newScene = {
        kind: 'scene' as const,
        id: sceneId,
        level: 5,
        title: op.title,
        markdown: op.markdown,
        presence: 'off-canvas' as const,
      }
      working = {
        ...working,
        sections: working.sections.map(section => {
          if (!(section.kind === 'canonical' && section.id === 'storyboard')) return section
          const nextItems = [...section.items]
          nextItems.splice(insertIndex <= 0 ? nextItems.length : insertIndex, 0, newScene)
          return { ...section, items: nextItems }
        }),
      }
      appliedItemIds.push(item.id)
      continue
    }
    if (op.kind === 'reorder-scenes') {
      const currentScenes = getBlueprintV2Scenes(working).map(scene => scene.sceneId)
      const requested = op.orderedSceneIds
      const sameSet = currentScenes.length === requested.length
        && new Set(currentScenes).size === new Set(requested).size
        && requested.every(id => currentScenes.includes(id))
      if (!sameSet) {
        skipped.push({ itemId: item.id, reason: '分镜顺序列表与当前分镜集合不一致' })
        continue
      }
      if (currentScenes.every((id, index) => id === requested[index])) {
        skipped.push({ itemId: item.id, reason: '分镜顺序没有变化' })
        continue
      }
      const storyboard = findBlueprintV2CanonicalSection(working, 'storyboard')
      if (storyboard) {
        const sceneById = new Map(storyboard.items
          .filter((entry): entry is Extract<typeof entry, { kind: 'scene' }> => entry.kind === 'scene')
          .map(entry => [entry.id, entry]))
        let cursor = 0
        working = {
          ...working,
          sections: working.sections.map(section => {
            if (!(section.kind === 'canonical' && section.id === 'storyboard')) return section
            const rebuilt = section.items.map(entry => (
              entry.kind === 'scene' ? sceneById.get(requested[cursor++]) ?? entry : entry
            ))
            return { ...section, items: rebuilt }
          }),
        }
      }
      appliedItemIds.push(item.id)
    }
  }

  try {
    assertValidChapterBlueprintV2Content(working)
  } catch (error) {
    // 应用结果非法（理论上不会发生：所有操作都保持结构）——回退到原内容并全部跳过。
    return {
      content,
      appliedItemIds: [],
      skipped: [...skipped, ...appliedItemIds.map(itemId => ({ itemId, reason: `应用结果未通过结构校验：${String(error)}` }))],
    }
  }
  return { content: working, appliedItemIds, skipped }
}
