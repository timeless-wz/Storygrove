/**
 * 伏笔详情里的「关联长线计划」区块（knowledge-action-outline-sync-contract §7）。
 * 关系行只是两侧本体的引用：伏笔标记与章节脉络计划都不在此复制或改写。
 */

import { useCallback, useEffect, useState } from 'react'
import { GitBranch, Link2, Unlink } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { Button } from '../ui/Button'
import { NativeSelect } from '../ui/NativeSelect'
import { toast } from '../ui/Toast'
import type { NarrativeThreadView } from '../../shared/narrative-thread'
import type { ThreadMarkerLink } from '../../shared/thread-marker-link'
import type { ForeshadowingRecord } from '../../shared/foreshadowing'
import { listThreadMarkerLinks, linkThreadMarker, unlinkThreadMarker } from '../../services/knowledge-gap-client'
import { ipc } from '../../services/ipc-client'

interface ForeshadowingThreadLinksProps {
  projectKey: string
  marker: ForeshadowingRecord
}

const THREAD_STATUS_LABEL: Record<string, [string, string]> = {
  planned: ['已计划', 'Planned'],
  planted: ['已埋设', 'Planted'],
  progressing: ['推进中', 'Progressing'],
  resolved: ['已回收', 'Resolved'],
  abandoned: ['已弃置', 'Abandoned'],
}

export default function ForeshadowingThreadLinks({ projectKey, marker }: ForeshadowingThreadLinksProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const addLog = useWorkflowStore(s => s.addLog)
  const [links, setLinks] = useState<ThreadMarkerLink[]>([])
  const [plans, setPlans] = useState<NarrativeThreadView[]>([])
  const [planId, setPlanId] = useState('')
  const [kind, setKind] = useState<'evidence' | 'reference'>('evidence')

  const load = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectKey) return
    try {
      const [linkList, planList] = await Promise.all([
        listThreadMarkerLinks(projectSession, { foreshadowingId: marker.id }),
        ipc.invokeWithProjectSession(projectSession, 'db:narrative-thread-list', projectSession.projectPath) as Promise<NarrativeThreadView[]>,
      ])
      if (!isProjectSessionCurrent(projectSession)) return
      setLinks(Array.isArray(linkList) ? linkList : [])
      setPlans(Array.isArray(planList) ? planList : [])
    } catch (error) {
      addLog('error', text(`长线计划关联加载失败：${String(error)}`, `Could not load thread links: ${String(error)}`))
    }
  }, [addLog, currentProject, marker.id, projectKey, text])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const handleLink = async () => {
    const projectSession = captureProjectSession(currentProject)
    const numericPlanId = Number.parseInt(planId, 10)
    if (!projectSession || !Number.isSafeInteger(numericPlanId)) {
      toast.info(text('请选择要关联的章节脉络计划', 'Select a chapter thread plan to link'))
      return
    }
    try {
      await linkThreadMarker(projectSession, { threadPlanId: numericPlanId, foreshadowingId: marker.id, kind })
      if (!isProjectSessionCurrent(projectSession)) return
      await load()
    } catch (error) {
      toast.error(text(`关联失败：${String(error)}`, `Could not link: ${String(error)}`))
    }
  }

  const handleUnlink = async (link: ThreadMarkerLink) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    await unlinkThreadMarker(projectSession, link.id)
    if (!isProjectSessionCurrent(projectSession)) return
    await load()
  }

  const planById = new Map(plans.map(plan => [plan.id, plan]))

  return (
    <section className="mt-5" data-testid="foreshadowing-thread-links">
      <h3 className="planning-section-label">{text('关联长线计划（章节脉络）', 'Linked thread plans')}</h3>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        {text(
          '把这条原文标记作为某条长线承诺的证据引用；伏笔的回收状态与脉络计划互不自动改写。',
          'Reference this marker as evidence for a long-term plan; neither side auto-updates the other.',
        )}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {links.map(link => {
          const plan = planById.get(link.threadPlanId)
          const statusLabel = plan ? THREAD_STATUS_LABEL[plan.status] : undefined
          return (
            <div
              key={link.id}
              className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <GitBranch size={12} className="text-[var(--color-accent)]" />
              <span className="font-medium text-[var(--color-text)]">
                {plan ? `#${plan.id} ${plan.title}` : `#${link.threadPlanId}（计划可能已删除）`}
              </span>
              <span className="planning-tag">{link.kind === 'evidence' ? text('证据', 'Evidence') : text('参考', 'Reference')}</span>
              {plan && statusLabel && <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{text(statusLabel[0], statusLabel[1])}</span>}
              {plan && (
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {text(`目标章 ${plan.targetStartChapter}–${plan.targetEndChapter}`, `Target ch ${plan.targetStartChapter}–${plan.targetEndChapter}`)}
                </span>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => { void handleUnlink(link) }} title={text('解除关联（不删除计划或标记）', 'Unlink (does not delete either side)')}>
                <Unlink size={11} /> {text('解除', 'Unlink')}
              </Button>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect value={planId} onChange={e => setPlanId(e.target.value)} className="h-7 text-xs max-w-56" data-testid="thread-link-plan-select">
            <option value="">{text('（选择章节脉络计划）', '(select a thread plan)')}</option>
            {plans.map(plan => (
              <option key={plan.id} value={String(plan.id)}>{`#${plan.id} ${plan.title}`}</option>
            ))}
          </NativeSelect>
          <NativeSelect value={kind} onChange={e => setKind(e.target.value as 'evidence' | 'reference')} className="h-7 text-xs w-28">
            <option value="evidence">{text('证据', 'Evidence')}</option>
            <option value="reference">{text('参考', 'Reference')}</option>
          </NativeSelect>
          <Button variant="outline" size="sm" onClick={() => { void handleLink() }} data-testid="thread-link-add">
            <Link2 size={11} /> {text('关联', 'Link')}
          </Button>
        </div>
      </div>
    </section>
  )
}
