/**
 * last-creation-location — 「回到上次创作位置」的记录与读取。
 *
 * 数据源是**真实保存行为**：只有当作者真实保存了章节正文
 * （DraftEditor → db:draft-update-content 成功）、章节蓝图
 * （ChapterCardEditor → db:blueprint-upsert 成功）或章节画布内容
 * （ChapterCanvasWorkbench → db:chapter-canvas-node/edge-upsert 成功）时才
 * 写入一条记录。打开页面、切换章节、滚动浏览等行为绝不记录。
 *
 * 存储是 localStorage，按项目路径隔离（projectKey 即项目路径，是应用内
 * 项目身份的统一键），因此跨项目切换不可能读到另一个项目的记录；记录只
 * 是导航辅助，绝不写入草稿/蓝图/正文的权威数据。记录损坏、目标被删除或
 * 项目会话失效时由读取方校验并回退到既有流程。
 */

export type LastCreationLocationKind = 'draft' | 'blueprint' | 'chapter-canvas'

export interface LastCreationLocation {
  kind: LastCreationLocationKind
  /** 目标章节号；正文/蓝图/画布都以章节为锚。 */
  chapterNumber: number
  /** 保存时刻的作品内名称快照（章节标题或草稿名），展示用。 */
  title: string
  /** 真实保存完成时间（ISO 字符串）。 */
  savedAt: string
  /** kind = 'draft' 时的草稿 ID，用于精确打开同一份草稿。 */
  draftId?: number
}

const STORAGE_PREFIX = 'vela:last-creation-location:'

function storageKey(projectKey: string): string {
  return `${STORAGE_PREFIX}${projectKey}`
}

function isValidLocation(value: unknown): value is LastCreationLocation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.kind !== 'draft' && record.kind !== 'blueprint' && record.kind !== 'chapter-canvas') return false
  if (!Number.isSafeInteger(record.chapterNumber) || (record.chapterNumber as number) < 1) return false
  if (typeof record.title !== 'string' || record.title.length > 200) return false
  if (typeof record.savedAt !== 'string' || !record.savedAt) return false
  if (record.draftId !== undefined && (!Number.isSafeInteger(record.draftId) || (record.draftId as number) < 1)) return false
  return true
}

/** 真实保存成功后调用；项目路径缺失或存储不可用时静默放弃（记录只是辅助）。 */
export function recordLastCreationLocation(
  projectKey: string | undefined | null,
  location: LastCreationLocation,
): void {
  if (!projectKey || typeof window === 'undefined') return
  if (!isValidLocation(location)) return
  try {
    window.localStorage.setItem(storageKey(projectKey), JSON.stringify(location))
  } catch {
    // 隐私模式 / 配额满等场景：放弃记录，不影响创作数据。
  }
}

/** 读取记录；损坏或字段不合法一律返回 null（由调用方回退到既有流程）。 */
export function readLastCreationLocation(
  projectKey: string | undefined | null,
): LastCreationLocation | null {
  if (!projectKey || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(projectKey))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isValidLocation(parsed)) return null
    if (Number.isNaN(new Date(parsed.savedAt).getTime())) return null
    return parsed
  } catch {
    return null
  }
}

/** 时间展示：相对时间优先，超过一个月回落到日期；返回中英文案。 */
export function formatSavedAt(
  savedAt: string,
  now: number = Date.now(),
): { zh: string; en: string } {
  const saved = new Date(savedAt)
  if (Number.isNaN(saved.getTime())) return { zh: '', en: '' }
  const minutes = Math.floor((now - saved.getTime()) / 60000)
  if (minutes < 1) return { zh: '刚刚', en: 'just now' }
  if (minutes < 60) return { zh: `${minutes} 分钟前`, en: `${minutes} min ago` }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { zh: `${hours} 小时前`, en: `${hours} h ago` }
  const days = Math.floor(hours / 24)
  if (days === 1) return { zh: '昨天', en: 'yesterday' }
  if (days < 30) return { zh: `${days} 天前`, en: `${days} d ago` }
  const date = `${saved.getFullYear()}/${saved.getMonth() + 1}/${saved.getDate()}`
  return { zh: date, en: date }
}

/** 各类目标的展示名（正文 / 章节蓝图 / 场景画布）。 */
export function formatLocationKind(kind: LastCreationLocationKind): { zh: string; en: string } {
  switch (kind) {
    case 'draft':
      return { zh: '正文', en: 'Prose' }
    case 'blueprint':
      return { zh: '章节蓝图', en: 'Blueprint' }
    case 'chapter-canvas':
      return { zh: '场景画布', en: 'Scene canvas' }
  }
}
