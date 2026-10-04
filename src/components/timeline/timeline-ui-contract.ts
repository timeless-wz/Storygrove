/**
 * 故事时间线 UI 契约（任务 0 冻结，仅类型）。
 *
 * 四条边界共享的语义都收敛在这里，改动需先同步所有使用方：
 * - 画布 Scene 是纯渲染/视口组件，不直接写库；
 * - 事件浮窗与画布菜单都消费 TimelineFloatingTarget；
 * - 所有写操作统一返回 TimelineUiResult，组件只在 success 时结束编辑。
 *
 * 坐标约定：浮层回调一律携带浏览器 clientX/clientY；宿主用画布容器
 * DOMRect 换算容器内坐标。窗口坐标、画布容器坐标、React Flow 流坐标
 * 是三套坐标系，禁止混用。
 */

import type {
  StoryTimelineBranch,
  StoryTimelineEvent,
  StoryTimelineMention,
} from '../../shared/story-timeline'

/** 时间线写操作的统一结果：失败必须携带可理解的错误文本。 */
export type TimelineUiResult = { success: true } | { success: false; error: string }

/** 原子创建支线的结果：支线与其首事件要么同时成功，要么同时失败。 */
export type TimelineBranchCommit =
  | { success: true; branch: StoryTimelineBranch; event: StoryTimelineEvent }
  | { success: false; error: string }

/** 浏览器坐标（clientX/clientY），用于浮层定位。 */
export type TimelineScreenPoint = { clientX: number; clientY: number }

/**
 * 画布视口意图。selection、浮层、过滤都不是视口状态；
 * 只有这里声明的三种诉求会移动画布，nonce 保证同一目标可重复触发。
 */
export type TimelineViewportIntent = {
  nonce: number
  kind: 'initial' | 'fit-all' | 'focus-event'
  eventId?: string
}

/**
 * 画布上的浮层目标。event 由右键/双击/键盘打开详情或编辑浮窗；
 * create 打开创建表单；anchor 与 canvas 打开各自的轻量菜单。
 */
export type TimelineFloatingTarget =
  | { kind: 'event'; eventId: string; point: TimelineScreenPoint; mode: 'details' | 'edit' }
  | {
      kind: 'create'
      mode: 'create-main' | 'create-next' | 'create-branch'
      sourceEventId?: string
      suggestedOrder?: number
      point: TimelineScreenPoint
    }
  | { kind: 'anchor'; anchor: 'start' | 'end'; point: TimelineScreenPoint }
  | { kind: 'canvas'; suggestedOrder?: number; canCreate: boolean; point: TimelineScreenPoint }

/** 画布容器的可视矩形（viewport 坐标），浮层据此钳制与翻转。 */
export type TimelineCanvasBounds = { left: number; top: number; width: number; height: number }

/** 删除事件的级联影响预览（与仓库层 deleteEvent 的级联规则保持一致）。 */
export interface TimelineCascadePreview {
  /** 将被连带删除的支线（含嵌套），按分支层级顺序。 */
  branchNames: string[]
  /** 连同事件本身在内将被删除的事件总数。 */
  eventCount: number
}

/** 事件浮窗回调集合：由页面提供真实实现，浮窗不接触 IPC。 */
export interface TimelineEventFloatCallbacks {
  /** viaEscape 为 true 时页面应把焦点还给触发节点。 */
  onClose: (options?: { viaEscape?: boolean }) => void
  /** 进入浮窗内编辑态。 */
  onSwitchToEdit: () => void
  /** 保存事件；失败返回 false 结果，浮窗保留输入与焦点。 */
  onSaveEvent: (event: StoryTimelineEvent) => Promise<TimelineUiResult>
  /** 删除事件（页面负责真实级联删除）。 */
  onDeleteEvent: (eventId: string) => Promise<TimelineUiResult>
  /** 从该事件创建支线（页面打开创建表单）。 */
  onCreateBranch: (eventId: string) => void
  /** 在该事件后追加同线事件（页面打开创建表单）。 */
  onCreateNext: (eventId: string) => void
  /** 展开/折叠该事件派生的支线。 */
  onToggleBranches: (eventId: string) => void
  onNavigateMention?: (mention: StoryTimelineMention) => void
}
