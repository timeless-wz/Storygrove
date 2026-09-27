/**
 * 正文编辑器「编辑位置」记忆（内存态）。
 *
 * 用于「跳到蓝图 / 场景画布后再回到正文」时把光标与滚动位置放回原处。
 * 只活在本次渲染进程内：
 * - 不写 localStorage、不进数据库，因此不改变草稿的权威数据，也不会在
 *   重启后把作者带回一个已经过期的位置。
 * - 键包含项目路径与草稿 ID，切换项目或切换草稿不会互相读到对方的位置。
 *
 * 该记忆属于**导航辅助**：读取失败或目标块已经变化时，调用方必须安全地
 * 放弃还原，而不是改动正文。
 */

/** 与 Vditor 的三种模式对应；还原逻辑按模式分流。 */
export type DraftEditorMode = 'ir' | 'wysiwyg' | 'sv'

export interface DraftEditorPosition {
  mode: DraftEditorMode
  /** IR / 所见即所得：正文顶层块序号；无法定位时为 -1。 */
  blockIndex: number
  /** IR / 所见即所得：块内字符偏移。 */
  offsetInBlock: number
  /**
   * 定位块的起始文字快照。返回时先核对这一段是否还在原处，
   * 段落被改写时宁可退回到块序号，也不跳到别处。
   */
  blockText: string
  /** 分屏预览模式：源文本字符偏移。 */
  sourceOffset: number
  /** 编辑器滚动容器的滚动距离。 */
  scrollTop: number
}

const positions = new Map<string, DraftEditorPosition>()

/** 位置记忆键：项目路径 + 草稿 ID。 */
export function draftEditorPositionKey(projectPath: string, draftId: number): string {
  return `${projectPath}::${draftId}`
}

function isDraftEditorPosition(value: unknown): value is DraftEditorPosition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DraftEditorPosition>
  return (
    (candidate.mode === 'ir' || candidate.mode === 'wysiwyg' || candidate.mode === 'sv')
    && typeof candidate.blockIndex === 'number'
    && typeof candidate.offsetInBlock === 'number'
    && typeof candidate.blockText === 'string'
    && typeof candidate.sourceOffset === 'number'
    && typeof candidate.scrollTop === 'number'
  )
}

export function rememberDraftEditorPosition(key: string, position: DraftEditorPosition): void {
  if (!key || !isDraftEditorPosition(position)) return
  positions.set(key, position)
}

/**
 * 只在没有记忆时写入。
 *
 * 卸载时的兜底记录用它：跳转前作者主动记录的位置一定比卸载瞬间更准
 * （卸载时正文已脱离文档，滚动距离读不到），不能被覆盖掉。
 */
export function rememberDraftEditorPositionIfAbsent(key: string, position: DraftEditorPosition): void {
  if (!key || positions.has(key)) return
  rememberDraftEditorPosition(key, position)
}

export function readDraftEditorPosition(key: string): DraftEditorPosition | null {
  const position = positions.get(key)
  return isDraftEditorPosition(position) ? position : null
}

/**
 * 取走并清除位置记忆。
 *
 * 还原只应发生一次：作者之后主动滚动或点击时，不该再被拉回旧位置。
 */
export function takeDraftEditorPosition(key: string): DraftEditorPosition | null {
  const position = readDraftEditorPosition(key)
  positions.delete(key)
  return position
}

export function clearDraftEditorPosition(key: string): void {
  positions.delete(key)
}

/** 测试与项目清理使用：丢弃全部记忆位置。 */
export function resetDraftEditorPositions(): void {
  positions.clear()
}
