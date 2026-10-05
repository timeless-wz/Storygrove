/**
 * 伏笔标记 ↔ 章节脉络计划 关系（knowledge-action-outline-sync-contract §7）。
 *
 * 关系行只是两侧本体的引用：伏笔选段仍以 foreshadowing 标记为权威，计划仍以
 * narrative_thread_plans 为权威；允许一条标记关联多个计划、一个计划关联多条标记；
 * 删除关系不影响两侧本体。伏笔的 completed 与脉络的 resolved 互不自动改写。
 */

export const THREAD_MARKER_LINK_ID_PREFIX = 'tml'

export type ThreadMarkerLinkKind = 'evidence' | 'reference'

export interface ThreadMarkerLink {
  id: string            // tml-<uuid>
  threadPlanId: number
  foreshadowingId: string
  kind: ThreadMarkerLinkKind
  note: string
  createdAt: string
}

export interface ThreadMarkerLinkInput {
  threadPlanId: number
  foreshadowingId: string
  kind: ThreadMarkerLinkKind
  note?: string
}
