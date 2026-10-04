// ============================================================
// 项目隔离的 UI 偏好（localStorage），不写业务表。
// 只记录界面建议：内侧栏折叠、选中事件、卸载前的真实画布视口。
// 读取时逐字段校验，任何非法数字/超界 zoom 都退回默认，绝不注入脏值。
// ============================================================

const TIMELINE_UI_PREFS_KEY = 'ai-novel-writer-timeline-ui-prefs'
/** 与 Scene 的 React Flow minZoom/maxZoom 保持一致。 */
const TIMELINE_ZOOM_MIN = 0.05
const TIMELINE_ZOOM_MAX = 2
/** 平移坐标的合理范围：超出即可判定为脏数据。 */
const TIMELINE_VIEWPORT_COORD_LIMIT = 1e7
/** 最多保留多少个项目的界面偏好，避免 localStorage 无限膨胀。 */
const TIMELINE_UI_PREFS_PROJECT_LIMIT = 12

export interface TimelineCanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface TimelineUiPrefs {
  sidebarCollapsed: boolean
  selectedEventId: string | null
  /** 上一次离开该项目时的真实画布视口；没有则首次进入做可读适配。 */
  canvas: TimelineCanvasViewport | null
}

function isValidZoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= TIMELINE_ZOOM_MIN && value <= TIMELINE_ZOOM_MAX
}

/** 校验画布视口：三个数字都必须有限、zoom 在 Scene 的边界内。 */
export function sanitizeTimelineCanvasViewport(value: unknown): TimelineCanvasViewport | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { x?: unknown; y?: unknown; zoom?: unknown }
  const { x, y, zoom } = raw
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > TIMELINE_VIEWPORT_COORD_LIMIT) return null
  if (typeof y !== 'number' || !Number.isFinite(y) || Math.abs(y) > TIMELINE_VIEWPORT_COORD_LIMIT) return null
  if (!isValidZoom(zoom)) return null
  return { x, y, zoom }
}

function prefsStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 读取某项目的界面偏好；任何损坏数据都返回 null 而不是猜测值。 */
export function readTimelineUiPrefs(projectKey: string): TimelineUiPrefs | null {
  const storage = prefsStorage()
  if (!storage || !projectKey) return null
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TIMELINE_UI_PREFS_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const projects = (parsed as { projects?: unknown }).projects
    if (!projects || typeof projects !== 'object') return null
    const entry = (projects as Record<string, unknown>)[projectKey]
    if (!entry || typeof entry !== 'object') return null
    const raw = entry as Record<string, unknown>
    const selectedEventId = typeof raw.selectedEventId === 'string' && raw.selectedEventId.trim() !== ''
      ? raw.selectedEventId
      : null
    return {
      sidebarCollapsed: raw.sidebarCollapsed === true,
      selectedEventId,
      canvas: sanitizeTimelineCanvasViewport(raw.canvas),
    }
  } catch {
    return null
  }
}

/** 写入某项目的界面偏好；只保留最近使用的若干个项目。 */
export function writeTimelineUiPrefs(projectKey: string, prefs: TimelineUiPrefs): void {
  const storage = prefsStorage()
  if (!storage || !projectKey) return
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TIMELINE_UI_PREFS_KEY) ?? 'null')
    const existing = parsed && typeof parsed === 'object'
      ? (parsed as { projects?: Record<string, TimelineUiPrefs> }).projects
      : undefined
    const projects: Record<string, TimelineUiPrefs> = { ...(existing ?? {}) }
    delete projects[projectKey]
    projects[projectKey] = {
      sidebarCollapsed: prefs.sidebarCollapsed === true,
      selectedEventId: prefs.selectedEventId,
      canvas: sanitizeTimelineCanvasViewport(prefs.canvas),
    }
    const keys = Object.keys(projects)
    for (const stale of keys.slice(0, Math.max(0, keys.length - TIMELINE_UI_PREFS_PROJECT_LIMIT))) {
      delete projects[stale]
    }
    storage.setItem(TIMELINE_UI_PREFS_KEY, JSON.stringify({ version: 1, projects }))
  } catch {
    // 偏好只是界面建议：写入失败不影响任何业务操作。
  }
}
