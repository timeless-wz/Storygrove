/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useState } from 'react'

import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import { ipc } from '../../../services/ipc-client'
import {
  buildChapterBlueprintProposal,
  buildChapterBlueprintV2Proposal,
} from '../../../services/agent/tools/propose-chapter-blueprint.tool'
import { buildNovelConfigProposal, type ProposalFieldDiff } from '../../../services/agent/tools/propose-novel-config.tool'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../../shared/project-session-context'

export const CONFIG_LABELS: Record<string, readonly [string, string]> = {
  genre: ['类型', 'Genre'], subGenre: ['子类型', 'Subgenre'], targetAudience: ['目标读者', 'Target audience'],
  totalChapters: ['总章节数', 'Total chapters'], wordsPerChapter: ['每章字数', 'Words per chapter'],
  plotStructure: ['情节结构', 'Plot structure'], narrativePOV: ['叙事视角', 'Narrative POV'],
  coreOutline: ['核心大纲', 'Core outline'], worldSetting: ['世界设定', 'World setting'],
  goldenFinger: ['金手指', 'Special advantage'], protagonistProfile: ['主角设定', 'Protagonist profile'],
  globalGuidance: ['全局指导', 'Global guidance'], writingStyle: ['写作风格', 'Writing style'],
  referenceWorks: ['参考作品', 'Reference works'], writingLanguage: ['写作语言', 'Writing language'],
}
export const BLUEPRINT_LABELS: Record<string, readonly [string, string]> = {
  title: ['章节标题', 'Chapter title'], role: ['章节定位', 'Chapter role'], purpose: ['章节目的', 'Purpose'],
  keyEvents: ['关键事件', 'Key events'], characters: ['出场角色', 'Characters'], suspenseHook: ['悬念钩子', 'Suspense hook'],
  userGuidance: ['作者指导', 'Author guidance'], notes: ['备注', 'Notes'],
}

export interface DomainProposalPreview {
  kind: 'none' | 'loading' | 'valid' | 'invalid' | 'stale'
  diffs: ProposalFieldDiff[]
  error?: string
  warnings?: string[]
}

function displayValue(value: unknown, locale: string): string {
  if (Array.isArray(value)) return value.join(locale === 'zh-CN' ? '、' : ', ')
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

export function useDomainProposalPreview(toolCall: ToolCallInfo): DomainProposalPreview {
  const currentProject = useProjectStore(s => s.currentProject)
  const [blueprintPreview, setBlueprintPreview] = useState<DomainProposalPreview>({ kind: 'loading', diffs: [] })
  const isConfig = toolCall.toolName === 'propose_novel_config'
  const isBlueprint = toolCall.toolName === 'propose_chapter_blueprint'
  const sessionCurrent = !!toolCall.projectSession && sameProjectSessionContext(
    toolCall.projectSession,
    projectSessionContextFromProject(currentProject),
  )

  const configPreview = useMemo<DomainProposalPreview>(() => {
    if (!isConfig) return { kind: 'none', diffs: [] }
    if (!currentProject || !sessionCurrent) return { kind: 'stale', diffs: [] }
    const proposal = buildNovelConfigProposal(toolCall.arguments, currentProject.novelConfig)
    return proposal.valid
      ? { kind: 'valid', diffs: proposal.diffs }
      : { kind: 'invalid', diffs: [], error: proposal.error }
  }, [currentProject, isConfig, sessionCurrent, toolCall.arguments])

  const blueprintImmediate = useMemo<DomainProposalPreview | null>(() => {
    if (!isBlueprint) return { kind: 'none', diffs: [] }
    if (!currentProject || !sessionCurrent || !toolCall.projectSession) return { kind: 'stale', diffs: [] }
    const chapterNumber = toolCall.arguments.chapter_number
    if (!Number.isInteger(chapterNumber) || (chapterNumber as number) <= 0) {
      return { kind: 'invalid', diffs: [], error: '章节号无效' }
    }
    return null
  }, [currentProject, isBlueprint, sessionCurrent, toolCall.arguments, toolCall.projectSession])

  useEffect(() => {
    if (blueprintImmediate || !currentProject || !toolCall.projectSession) return
    const chapterNumber = toolCall.arguments.chapter_number
    let disposed = false
    void Promise.all([
      ipc.invokeWithProjectSession(toolCall.projectSession, 'db:blueprint-get', chapterNumber as number, currentProject.path),
      ipc.invokeWithProjectSession(toolCall.projectSession, 'db:blueprint-v2-get', chapterNumber as number, currentProject.path),
    ]).then(([blueprint, detail]) => {
      if (disposed) return
      const now = useProjectStore.getState().currentProject
      if (!sameProjectSessionContext(toolCall.projectSession, projectSessionContextFromProject(now))) {
        setBlueprintPreview({ kind: 'stale', diffs: [] })
        return
      }
      if (!blueprint) {
        setBlueprintPreview({ kind: 'invalid', diffs: [], error: `第 ${chapterNumber} 章蓝图不存在` })
        return
      }
      const proposal = typeof toolCall.arguments.markdown === 'string'
        ? buildChapterBlueprintV2Proposal(toolCall.arguments, chapterNumber as number, detail)
        : detail
          ? { valid: false as const, error: '该章已有 v2 细纲；请基于当前完整 Markdown 提交细纲提案。' }
          : buildChapterBlueprintProposal(toolCall.arguments, blueprint)
      setBlueprintPreview(proposal.valid
        ? { kind: 'valid', diffs: proposal.diffs, warnings: proposal.kind === 'v2' ? proposal.warnings : [] }
        : { kind: 'invalid', diffs: [], error: proposal.error })
    }).catch(() => {
      if (!disposed) setBlueprintPreview({ kind: 'invalid', diffs: [], error: '无法读取章节蓝图' })
    })
    return () => { disposed = true }
  }, [blueprintImmediate, currentProject, toolCall.arguments, toolCall.projectSession])

  return isConfig ? configPreview : blueprintImmediate ?? blueprintPreview
}

export default function DomainProposalDiff({ toolCall, preview }: { toolCall: ToolCallInfo; preview: DomainProposalPreview }) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  if (preview.kind === 'none') return null
  if (preview.kind === 'loading') return <div className="text-xs opacity-70">{text('正在读取当前值…', 'Loading current values…')}</div>
  if (preview.kind === 'stale') return <div className="text-xs text-[var(--color-error-text)]">{text('项目已切换，此提案已过期，不会写入。', 'The project changed. This proposal is stale and will not be written.')}</div>
  if (preview.kind === 'invalid') return <div className="text-xs text-[var(--color-error-text)]">{text(`提案无效：${preview.error ?? '未知错误'}`, 'Invalid proposal fields or target.')}</div>
  const labels = toolCall.toolName === 'propose_novel_config' ? CONFIG_LABELS : BLUEPRINT_LABELS
  return (
    <div className="space-y-2" aria-label={text('字段变更', 'Field changes')}>
      {preview.warnings?.map(warning => (
        <p key={warning} role="status" className="rounded border border-[var(--color-warning-border,var(--color-border))] p-2 text-xs text-[var(--color-warning-text)]">{warning}</p>
      ))}
      {preview.diffs.map(diff => (
        <div key={diff.field} className="rounded border border-[var(--color-border)] p-2">
          <div className="mb-1 text-xs font-medium">{text(labels[diff.field]?.[0] ?? diff.field, labels[diff.field]?.[1] ?? diff.field)}</div>
          <div className="grid grid-cols-2 items-start gap-2 text-[0.7rem]">
            {([
              { side: 'current', value: diff.current },
              { side: 'proposed', value: diff.proposed },
            ] as const).map(({ side, value }) => {
              const label = side === 'current' ? text('当前', 'Current') : text('建议', 'Proposed')
              const rendered = displayValue(value, locale)
              return (
                <div key={side}>
                  <span className="opacity-60">{label}</span>
                  {rendered.length > 1200 ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer">{text(`查看完整内容（${rendered.length} 字符）`, `View full content (${rendered.length} characters)`)}</summary>
                      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words">{rendered}</pre>
                    </details>
                  ) : <div className="whitespace-pre-wrap break-words">{rendered}</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
