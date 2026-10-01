import { useEffect, useState } from 'react'
import { ipc } from '../../services/ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import type { AgentProposalReview } from '../../shared/ipc-channels'
import { assertNoLossOnSerialize } from '../../shared/blueprint-v2-markdown'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'

const supportedTypes = new Set(['propose_blueprint_update', 'propose_draft_update'])

export function AgentProposalReviewPanel() {
  const currentProject = useProjectStore(state => state.currentProject)
  const text = useLocaleStore(state => state.text)
  const [proposals, setProposals] = useState<AgentProposalReview[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [currentContent, setCurrentContent] = useState<string>('')
  const [comparisonReady, setComparisonReady] = useState(false)
  const [v2BlueprintGuard, setV2BlueprintGuard] = useState(false)
  const [busy, setBusy] = useState(false)
  const selected = proposals.find(proposal => proposal.proposalId === selectedId)

  const refresh = async () => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const result = await ipc.invokeWithProjectSession(session, 'story-data:list-agent-proposals', session.projectPath)
    // 响应可能是错误包（{ success:false, error }）或空值：非数组一律按空列表处理，
    // 否则 .find 会抛错并连带挂掉整个编辑器区域（2026-10-01 实测崩溃路径）。
    if (isProjectSessionCurrent(session)) setProposals(Array.isArray(result) ? result : [])
  }

  useEffect(() => {
    queueMicrotask(() => { void refresh().catch(error => toast.error(String(error))) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- parent remounts on project lease change

  useEffect(() => {
    if (!selected) return
    const session = captureProjectSession(currentProject)
    if (!session) return
    let cancelled = false
    const readCurrent = async () => {
      if (selected.proposalType === 'propose_blueprint_update') {
        const chapterNumber = selected.payload.chapterNumber
        if (!Number.isSafeInteger(chapterNumber)) return
        const [result, detail] = await Promise.all([
          ipc.invokeWithProjectSession(session, 'db:blueprint-get', chapterNumber as number, session.projectPath),
          ipc.invokeWithProjectSession(session, 'db:blueprint-v2-get', chapterNumber as number, session.projectPath),
        ])
        if (!cancelled && isProjectSessionCurrent(session)) {
          if (detail) {
            setV2BlueprintGuard(true)
            if (detail.readStatus) {
              setCurrentContent(detail.rawMarkdown ?? '')
            } else {
              try {
                setCurrentContent(assertNoLossOnSerialize(detail))
              } catch {
                setCurrentContent(detail.rawMarkdown ?? '')
              }
            }
          } else {
            setCurrentContent(JSON.stringify(result, null, 2))
          }
          setComparisonReady(true)
        }
      } else if (selected.proposalType === 'propose_draft_update') {
        const draftId = selected.payload.draftId
        if (!Number.isSafeInteger(draftId)) return
        const result = await ipc.invokeWithProjectSession(session, 'db:draft-get-full', draftId as number, session.projectPath)
        if (!cancelled && isProjectSessionCurrent(session)) {
          setCurrentContent(result?.content ?? '')
          setComparisonReady(Boolean(result))
        }
      }
    }
    void readCurrent().catch(error => toast.error(String(error)))
    return () => { cancelled = true }
  }, [selectedId, selected, currentProject])

  const review = async (action: 'approve' | 'reject') => {
    if (!selected || busy) return
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    setBusy(true)
    try {
      const result = action === 'approve'
        ? await ipc.invokeWithProjectSession(session, 'story-data:approve-agent-proposal', selected.proposalId, 'author', session.projectPath)
        : await ipc.invokeWithProjectSession(session, 'story-data:reject-agent-proposal', selected.proposalId, session.projectPath)
      if (!result.success) throw new Error(result.error ?? text('处理提案失败', 'Could not review proposal'))
      if (!isProjectSessionCurrent(session)) return
      toast.success(action === 'approve'
        ? text('已批准提案，等待外部 Agent 提交', 'Proposal approved; waiting for the external agent to commit')
        : text('已拒绝提案', 'Proposal rejected'))
      setSelectedId(null)
      await refresh()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  const proposedContent = selected?.proposalType === 'propose_blueprint_update'
    ? typeof selected.payload.markdown === 'string'
      ? selected.payload.markdown
      : JSON.stringify(selected.payload.blueprint, null, 2)
    : selected?.proposalType === 'propose_draft_update'
      ? String(selected.payload.content ?? '')
      : selected ? JSON.stringify(selected.payload, null, 2) : ''

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4" aria-label={text('外部 AI 提案', 'External AI proposals')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[var(--color-text)]">{text('外部 AI 提案', 'External AI proposals')}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">{text('先核对当前内容与提案，再决定是否批准。批准后仍需外部 Agent 提交。', 'Compare the current content with the proposal before approval. The external agent must commit afterward.')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>{text('刷新', 'Refresh')}</Button>
      </div>
      {proposals.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">{text('暂无待审提案', 'No pending proposals')}</p> : (
        <div className="flex flex-wrap gap-2">
          {proposals.map(proposal => (
              <Button key={proposal.proposalId} variant={selectedId === proposal.proposalId ? 'default' : 'outline'} size="sm" onClick={() => { setSelectedId(proposal.proposalId); setCurrentContent(''); setComparisonReady(false); setV2BlueprintGuard(false) }}>
              {proposal.proposalType === 'propose_blueprint_update'
                ? text(`第 ${String(proposal.payload.chapterNumber)} 章蓝图`, `Chapter ${String(proposal.payload.chapterNumber)} blueprint`)
                : proposal.proposalType === 'propose_draft_update'
                  ? text(`草稿 #${String(proposal.payload.draftId)}`, `Draft #${String(proposal.payload.draftId)}`)
                  : proposal.proposalType}
            </Button>
          ))}
        </div>
      )}
      {selected && (
        <div className="mt-4 space-y-3">
          <p className="break-all text-xs text-[var(--color-text-muted)]">ID: {selected.proposalId}</p>
          {v2BlueprintGuard && selected.proposalType === 'propose_blueprint_update' && (
            <p role="status" className="rounded border border-[var(--color-warning-border,var(--color-border))] p-2 text-xs text-[var(--color-warning-text)]">
              {text(
                '该章已有完整 v2 细纲。此外部提案流程没有 v2 完整文档差异与修订校验写入路径，因此已禁止批准；请通过章节蓝图提交完整 Markdown 提案。',
                'This chapter has a complete v2 outline. This external proposal flow has no v2 full-document diff or revision-checked save path, so approval is disabled. Submit a complete Markdown proposal from the chapter blueprint.',
              )}
            </p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">{text('当前内容', 'Current content')}</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border)] p-3 text-xs text-[var(--color-text)]">{currentContent || text('无内容', 'No content')}</pre>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">{text('提案内容', 'Proposed content')}</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border)] p-3 text-xs text-[var(--color-text)]">{proposedContent}</pre>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !comparisonReady || !selected.approvable || !supportedTypes.has(selected.proposalType) || v2BlueprintGuard} onClick={() => void review('approve')}>{text('批准', 'Approve')}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void review('reject')}>{text('拒绝', 'Reject')}</Button>
            {!selected.approvable && <span className="text-xs text-[var(--color-text-muted)]">{text('提案会话已过期，请外部 Agent 重新提交', 'The proposal session expired; ask the external agent to propose again')}</span>}
          </div>
        </div>
      )}
    </section>
  )
}
