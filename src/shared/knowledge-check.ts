/**
 * AI 检查报告（信息差检查 / 人物行动线检查）— 类型模块
 * （knowledge-action-outline-sync-contract §6）。
 *
 * 报告是证据不是事实：语义判断一律建议级，作者确认前不写任何正式对象；
 * 每条发现必须携带具体引用（citations），作者据此跳转核对。
 */

import { randomCanvasUuid } from './canvas-ids'

export const KNOWLEDGE_CHECK_REPORT_ID_PREFIX = 'kcr'
export const KNOWLEDGE_CHECK_FINDING_ID_PREFIX = 'kcf'

export type KnowledgeCheckKind = 'info-gap' | 'action-line'

export type KnowledgeCheckCitation =
  | { kind: 'info-entry'; id: string; note?: string }
  | { kind: 'knowledge-record'; id: string; note?: string }
  | { kind: 'character-action'; id: string; note?: string }
  | { kind: 'timeline-event'; id: string; note?: string }
  | { kind: 'chapter'; chapterNumber: number; note?: string }
  | { kind: 'thread-plan'; id: number; note?: string }
  | { kind: 'draft'; draftId: number; note?: string }

export interface KnowledgeCheckFinding {
  id: string
  /** 建议级：不阻断写作，不判错作者剧情。 */
  severity: 'suggestion'
  title: string
  detail: string
  citations: KnowledgeCheckCitation[]
}

export interface KnowledgeCheckReport {
  id: string
  kind: KnowledgeCheckKind
  /** 例：'chapter:3' / 'character:<characterId>' / 'project'。 */
  scope: string
  findings: KnowledgeCheckFinding[]
  /** 输入范围与目标说明（显示"AI 看了什么、在查什么"）。 */
  modelNote: string
  createdAt: string
}

export function createKnowledgeCheckReportId(): string {
  return `${KNOWLEDGE_CHECK_REPORT_ID_PREFIX}-${randomCanvasUuid()}`
}

/** 保存报告的输入（id 与 createdAt 由服务端生成）。 */
export type KnowledgeCheckReportInput = Omit<KnowledgeCheckReport, 'id' | 'createdAt'>

export function createKnowledgeCheckFindingId(): string {
  return `${KNOWLEDGE_CHECK_FINDING_ID_PREFIX}-${randomCanvasUuid()}`
}

const MAX_FINDINGS = 50

/** 模型输出进入报告存储前的防线：超出即拒收，绝不静默截断语义。 */
export function assertValidKnowledgeCheckReport(report: KnowledgeCheckReport): void {
  if (!report || typeof report !== 'object') throw new Error('检查报告无效')
  if (report.kind !== 'info-gap' && report.kind !== 'action-line') {
    throw new Error(`未知的检查类型：${String(report.kind)}`)
  }
  if (typeof report.scope !== 'string' || !report.scope.trim()) throw new Error('检查报告缺少范围')
  if (!Array.isArray(report.findings)) throw new Error('检查发现列表无效')
  if (report.findings.length > MAX_FINDINGS) throw new Error(`检查发现超限（≤${MAX_FINDINGS} 条）`)
  for (const finding of report.findings) {
    if (!finding || typeof finding !== 'object') throw new Error('检查发现无效')
    if (finding.severity !== 'suggestion') throw new Error('检查发现只允许建议级')
    if (typeof finding.title !== 'string' || !finding.title.trim()) throw new Error('检查发现缺少标题')
    if (finding.title.length > 200) throw new Error('检查发现标题超限（≤200 字符）')
    if (typeof finding.detail !== 'string' || finding.detail.length > 4000) {
      throw new Error('检查发现详情超限（≤4000 字符）')
    }
    if (!Array.isArray(finding.citations)) throw new Error('检查发现缺少引用列表')
    for (const citation of finding.citations) {
      if (!citation || typeof citation !== 'object') throw new Error('检查引用无效')
      const kinds = ['info-entry', 'knowledge-record', 'character-action', 'timeline-event', 'chapter', 'thread-plan', 'draft']
      if (!kinds.includes(citation.kind)) throw new Error(`未知的检查引用类型：${String(citation.kind)}`)
    }
  }
}
