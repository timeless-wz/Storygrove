/**
 * 「本章创作上下文」只读数据。
 *
 * 红线（与正文写作界面的其他只读投影一致）：
 * - 蓝图**只**来自草稿自己的 `blueprint_chapter_number`。未绑定时返回
 *   `unbound`，绝不按草稿章号猜测一份蓝图来填满侧栏。
 * - 正式分镜来自章节蓝图 v2；章节画布只是它的编排视图，不是另一份场景内容源。
 *   侧栏只投影蓝图里的场景条目，不读取可能过期的画布卡片摘要。
 * - 本模块只读：不写入草稿、蓝图或画布，不记录「上次创作位置」。
 */

import type { DatabaseChannels, ProjectSessionContext } from '../shared/ipc-channels'
import { getBlueprintV2Scenes, projectV2ToV1, type ChapterBlueprintV2DetailRead } from '../shared/blueprint-v2'
import { assertNoLossOnSerialize } from '../shared/blueprint-v2-markdown'
import { isProjectSessionCurrent } from '../components/project-session-gate'
import { ipc } from './ipc-client'

/** 侧栏展示的章节蓝图投影；字段名与 `BlueprintData` 一一对应。 */
export interface ChapterContextBlueprint {
  chapterNumber: number
  title: string
  /** 章节定位（建置 / 铺垫 / 发展 / 冲突 / 高潮 / 转折 / 收尾）。 */
  role: string
  /** 本章目标（`blueprints.purpose`）。 */
  purpose: string
  /** 由 `blueprints.key_events` 原文拆出的节拍条目。 */
  beats: string[]
  /** 出场关键人。 */
  characters: string[]
  /** 章尾悬念钩子（`blueprints.suspense_hook`）。 */
  suspenseHook: string
}

export interface ChapterContextScene {
  id: string
  title: string
  markdown: string
  presence: 'on-canvas' | 'off-canvas'
  order: number
}

export type ChapterContextState =
  /** 正在读取；此时不显示上一章或上一项目的内容。 */
  | { status: 'loading' }
  /** 当前草稿没有绑定章节蓝图。 */
  | { status: 'unbound' }
  /**
   * 读取途中项目会话已失效（切章 / 切项目 / 同路径重开）。
   * 调用方必须丢弃这个结果，不得让它进入任何草稿的侧栏。
   */
  | { status: 'session-lost' }
  /** 已绑定，但该章蓝图已不存在（被删除或已清理）。 */
  | { status: 'target-missing'; blueprintChapterNumber: number }
  /** 已绑定，但蓝图读取失败；不能误报为蓝图已删除。 */
  | { status: 'load-error' }
  | {
      status: 'ready'
      blueprintChapterNumber: number
      blueprint: ChapterContextBlueprint
      scenes: ChapterContextScene[]
      /** 存在 v2 细纲但正式分镜无法读取；与「没有正式分镜」区分显示。 */
      scenesLoadFailed: boolean
      hasV2Detail: boolean
      /** 完整细纲；损坏时保留数据库中的原始 Markdown。 */
      detailMarkdown: string | null
      detailReadStatus: 'corrupt' | 'needs-newer-app' | 'load-error' | null
    }

/**
 * 草稿实际绑定的蓝图章号。
 *
 * `blueprintChapterNumber` 由 `db:draft-get-meta` 在**未绑定**时整个省略，
 * 因此这里只接受正整数；不回退到草稿自身章号。
 */
export function boundBlueprintChapterNumber(
  draft: { blueprintChapterNumber?: number } | null | undefined,
): number | null {
  const value = draft?.blueprintChapterNumber
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null
}

/**
 * 拆分关键事件 / 节拍。
 *
 * 分隔符沿用章节工作流既有约定（换行与中英文分号），只做去空白与去空项，
 * 不重写作者的文字。
 */
export function splitChapterBeats(keyEvents: string | null | undefined): string[] {
  if (typeof keyEvents !== 'string') return []
  return keyEvents
    .split(/\r?\n|[；;]/u)
    .map(beat => beat.trim())
    .filter(beat => beat.length > 0)
}

function scenesFromBlueprint(detail: ChapterBlueprintV2DetailRead): ChapterContextScene[] {
  return getBlueprintV2Scenes(detail).map(scene => ({
    id: scene.sceneId,
    title: scene.title,
    markdown: scene.markdown,
    presence: scene.presence,
    order: scene.order,
  }))
}

function toBlueprintView(blueprint: {
  chapterNumber: number
  title?: string
  role?: string
  purpose?: string
  keyEvents?: string
  characters?: string[]
  suspenseHook?: string
}): ChapterContextBlueprint {
  return {
    chapterNumber: blueprint.chapterNumber,
    title: blueprint.title ?? '',
    role: blueprint.role ?? '',
    purpose: blueprint.purpose ?? '',
    beats: splitChapterBeats(blueprint.keyEvents),
    characters: Array.isArray(blueprint.characters) ? blueprint.characters : [],
    suspenseHook: blueprint.suspenseHook ?? '',
  }
}

function blueprintFromV2(detail: ChapterBlueprintV2DetailRead): NonNullable<DatabaseChannels['db:blueprint-get']['return']> {
  const empty: NonNullable<DatabaseChannels['db:blueprint-get']['return']> = {
    chapterNumber: detail.chapterNumber,
    title: '',
    role: '',
    purpose: '',
    keyEvents: '',
    characters: [],
    suspenseHook: '',
    userGuidance: '',
    notes: '',
    notesUpdatedAt: '',
  }
  return { ...empty, ...projectV2ToV1(detail, empty) }
}

/**
 * 读取当前草稿绑定的蓝图要点与正式分镜。v1-only 章节继续展示旧简纲。
 *
 * 每次 await 之后都用会话门校验：切章、切项目或同路径重开会话后，旧结果
 * 一律丢弃，绝不进入新草稿的侧栏。
 */
export async function loadChapterContext(
  projectSession: ProjectSessionContext,
  draft: { blueprintChapterNumber?: number } | null | undefined,
): Promise<ChapterContextState> {
  const blueprintChapterNumber = boundBlueprintChapterNumber(draft)
  if (blueprintChapterNumber === null) return { status: 'unbound' }

  let blueprint: DatabaseChannels['db:blueprint-get']['return']
  try {
    blueprint = await ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-get',
      blueprintChapterNumber,
      projectSession.projectPath,
    )
  } catch {
    return isProjectSessionCurrent(projectSession) ? { status: 'load-error' } : { status: 'session-lost' }
  }
  if (!isProjectSessionCurrent(projectSession)) return { status: 'session-lost' }

  let detail: ChapterBlueprintV2DetailRead | null = null
  let scenesLoadFailed = false
  let detailReadStatus: 'corrupt' | 'needs-newer-app' | 'load-error' | null = null
  try {
    detail = await ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-v2-get',
      blueprintChapterNumber,
      projectSession.projectPath,
    ) as ChapterBlueprintV2DetailRead | null
    if (!isProjectSessionCurrent(projectSession)) return { status: 'session-lost' }
    if (detail?.readStatus) {
      scenesLoadFailed = true
      detailReadStatus = detail.readStatus
    }
  } catch {
    // v2 读取失败不拖垮旧简纲展示，但不能把失败伪装成「没有分镜」。
    if (!isProjectSessionCurrent(projectSession)) return { status: 'session-lost' }
    scenesLoadFailed = true
    detailReadStatus = 'load-error'
  }
  if (!isProjectSessionCurrent(projectSession)) return { status: 'session-lost' }
  if (!blueprint && !detail) {
    return scenesLoadFailed
      ? { status: 'load-error' }
      : { status: 'target-missing', blueprintChapterNumber }
  }
  if (!blueprint && detail?.readStatus) return { status: 'load-error' }
  const resolvedBlueprint = blueprint ?? (detail ? blueprintFromV2(detail) : null)
  if (!resolvedBlueprint) return { status: 'target-missing', blueprintChapterNumber }
  // A corrupt/newer v2 row is still authoritative: show an explicit failure
  // for its formal storyboard instead of falling back to v1 key-event beats.
  const hasV2Detail = !!detail
  let scenes = detail && !detail.readStatus ? scenesFromBlueprint(detail) : []
  let detailMarkdown: string | null = detail?.readStatus ? detail.rawMarkdown ?? null : null
  if (detail && !detail.readStatus) {
    try {
      detailMarkdown = assertNoLossOnSerialize(detail)
    } catch {
      // 局部结构仍可供只读浏览；导出失败单独提示，不能抹掉可用分镜。
      detailReadStatus = 'corrupt'
      detailMarkdown = detail.rawMarkdown ?? null
    }
  }

  return {
    status: 'ready',
    blueprintChapterNumber,
    blueprint: toBlueprintView(resolvedBlueprint),
    scenes,
    scenesLoadFailed,
    hasV2Detail,
    detailMarkdown,
    detailReadStatus,
  }
}
