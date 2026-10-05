/**
 * 人物行动线（角色档案内的行动线视图，knowledge-action-outline-sync-contract §4）。
 *
 * - 行动的目标/资源/限制/结果由本页维护；关联事件的标题/时间/结果永远从时间线读取。
 * - 「加入故事时间线」经确认创建事件并关联；重复操作不重复创建（主进程事务幂等）。
 * - 幕后行动同时显示故事内状态与叙事呈现状态：幕后 ≠ 没发生，也不等于读者已见。
 * - 不复制时间线节点；按角色过滤的原时间线视图在此展示，重名时提示显式确认。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, ListChecks, Plus, RefreshCw, Route, Trash2 } from 'lucide-react'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'
import { Textarea } from '../../ui/Textarea'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import type { StoryTimelineSnapshot } from '../../../shared/story-timeline'
import {
  KNOWLEDGE_COGNITION_LABEL,
  type InfoEntry,
  type KnowledgeRecord,
} from '../../../shared/knowledge-gap'
import type { CharacterActionView } from '../../../shared/character-action'
import type { KnowledgeCheckReport } from '../../../shared/knowledge-check'
import {
  deleteCharacterAction,
  listCharacterActions,
  listKnowledgeRecords,
  listKnowledgeCheckReports,
  promoteActionToTimeline,
  saveCharacterAction,
} from '../../../services/knowledge-gap-client'
import { ipc } from '../../../services/ipc-client'

interface CharacterActionLineViewProps {
  projectKey: string
  characterId: string
  characterName: string
}

const emptyForm = {
  title: '',
  goal: '',
  resources: '',
  constraints: '',
  plannedNote: '',
  outcome: '',
  aftermath: '',
  relatedChapters: '',
}

export default function CharacterActionLineView({ projectKey, characterId, characterName }: CharacterActionLineViewProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const characterIdentities = useCharacterStore(s => s.characterIdentities)
  const addLog = useWorkflowStore(s => s.addLog)

  const [actions, setActions] = useState<CharacterActionView[]>([])
  const [records, setRecords] = useState<KnowledgeRecord[]>([])
  const [entries, setEntries] = useState<InfoEntry[]>([])
  const [timeline, setTimeline] = useState<StoryTimelineSnapshot | null>(null)
  const [reports, setReports] = useState<KnowledgeCheckReport[]>([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingRevision, setEditingRevision] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [formEventId, setFormEventId] = useState('')
  const [formNarrativeChapter, setFormNarrativeChapter] = useState('')
  const [formVisibility, setFormVisibility] = useState<'on-stage' | 'off-stage'>('on-stage')
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([])

  const entryTitleById = useMemo(() => new Map(entries.map(entry => [entry.id, entry.title])), [entries])

  const loadAll = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectKey || !characterId) return
    setLoading(true)
    try {
      const [actionList, recordList, entryList, reportList, timelineSnapshot] = await Promise.all([
        listCharacterActions(projectSession, { characterId }),
        listKnowledgeRecords(projectSession, { characterId }),
        ipc.invokeWithProjectSession(projectSession, 'db:info-entry-list', undefined, projectSession.projectPath) as Promise<InfoEntry[]>,
        listKnowledgeCheckReports(projectSession, { kind: 'action-line', scope: `character:${characterId}` }),
        ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectSession.projectPath) as Promise<StoryTimelineSnapshot>,
      ])
      if (!isProjectSessionCurrent(projectSession)) return
      setActions(actionList)
      setRecords(recordList)
      setEntries(entryList)
      setReports(reportList)
      setTimeline(timelineSnapshot)
    } catch (error) {
      addLog('error', text(`行动线加载失败：${String(error)}`, `Could not load the action line: ${String(error)}`))
    } finally {
      setLoading(false)
    }
  }, [addLog, characterId, currentProject, projectKey, text])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAll() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAll])

  useEffect(() => globalEventBus.on('WORKFLOW_COMPLETE', payload => {
    if (payload.projectPath === projectKey) void loadAll()
  }), [loadAll, projectKey])

  const duplicateNameOwners = useMemo(() => {
    const sameName = characters.filter(character => character.name === characterName)
    return sameName.filter(character => (characterIdentities[character.name] ?? '') !== characterId).length
  }, [characterId, characterIdentities, characterName, characters])

  const timelineEventsForCharacter = useMemo(() => {
    const events = timeline?.events ?? []
    const linked = new Set(actions.map(action => action.eventId).filter(Boolean) as string[])
    return events.filter(event => (
      linked.has(event.id) || event.characterNames.includes(characterName)
    ))
  }, [actions, characterName, timeline])

  const openCreate = () => {
    setForm(emptyForm)
    setFormEventId('')
    setFormNarrativeChapter('')
    setFormVisibility('on-stage')
    setKnowledgeIds([])
    setEditingId(null)
    setEditingRevision(0)
    setFormOpen(true)
  }

  const openEdit = (action: CharacterActionView) => {
    setForm({
      title: action.title,
      goal: action.goal,
      resources: action.resources,
      constraints: action.constraints,
      plannedNote: action.plannedNote ?? '',
      outcome: action.outcome ?? '',
      aftermath: action.aftermath ?? '',
      relatedChapters: action.relatedChapterNumbers.join('、'),
    })
    setFormEventId(action.eventId ?? '')
    setFormNarrativeChapter(action.narrativePosition.kind === 'chapter-scene' ? String(action.narrativePosition.chapterNumber) : '')
    setFormVisibility(action.visibility)
    setKnowledgeIds([...action.basedOnKnowledgeIds])
    setEditingId(action.id)
    setEditingRevision(action.revision)
    setFormOpen(true)
  }

  const handleSave = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !characterId) return
    const chapterList = form.relatedChapters.split(/[、,，]/)
      .map(part => Number.parseInt(part.trim(), 10))
      .filter(value => Number.isSafeInteger(value) && value > 0)
    const narrativeChapter = Number.parseInt(formNarrativeChapter, 10)
    try {
      await saveCharacterAction(projectSession, {
        ...(editingId ? { id: editingId, baseRevision: editingRevision } : {}),
        characterId,
        title: form.title.trim() || text('未命名行动', 'Untitled action'),
        goal: form.goal,
        resources: form.resources,
        constraints: form.constraints,
        basedOnKnowledgeIds: knowledgeIds,
        ...(formEventId ? { eventId: formEventId } : {}),
        ...(!formEventId && form.plannedNote.trim() ? { plannedNote: form.plannedNote } : {}),
        storyPosition: formEventId ? { kind: 'timeline-event', eventId: formEventId } : { kind: 'unplaced' },
        narrativePosition: Number.isSafeInteger(narrativeChapter) && narrativeChapter >= 1
          ? { kind: 'chapter-scene', chapterNumber: narrativeChapter }
          : { kind: 'unplaced' },
        visibility: formVisibility,
        ...(form.outcome.trim() ? { outcome: form.outcome } : {}),
        ...(form.aftermath.trim() ? { aftermath: form.aftermath } : {}),
        status: 'plan',
        relatedChapterNumbers: chapterList,
      })
      if (!isProjectSessionCurrent(projectSession)) return
      setFormOpen(false)
      await loadAll()
      toast.success(text('行动记录已保存', 'Action record saved'))
    } catch (error) {
      toast.error(text(`行动记录保存失败：${String(error)}`, `Could not save the action record: ${String(error)}`))
    }
  }

  const handleDelete = async (action: CharacterActionView) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const ok = await confirm(text(
      `删除行动「${action.title}」？关联的时间线事件不会被删除。`,
      `Delete action “${action.title}”? The linked timeline event is not deleted.`,
    ), { title: text('删除行动', 'Delete action'), confirmText: text('删除', 'Delete'), danger: true })
    if (!ok) return
    await deleteCharacterAction(projectSession, action.id)
    if (!isProjectSessionCurrent(projectSession)) return
    await loadAll()
  }

  const handlePromote = async (action: CharacterActionView) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    try {
      const result = await promoteActionToTimeline(projectSession, action.id, characterName)
      if (!isProjectSessionCurrent(projectSession)) return
      await loadAll()
      toast.info(result.alreadyLinked
        ? text('该行动已关联时间线事件，未重复创建', 'This action is already linked to a timeline event; nothing was duplicated')
        : text('已创建 planned 状态的时间线事件并关联本行动', 'Created a planned timeline event and linked this action'))
    } catch (error) {
      toast.error(text(`加入时间线失败：${String(error)}`, `Could not add to the timeline: ${String(error)}`))
    }
  }

  const runActionCheck = () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !characterId) return
    void (async () => {
      try {
        const { createActionLineCheckWorkflow } = await import('../../../services/workflows/knowledge-workflows')
        const workflow = createActionLineCheckWorkflow({ projectSession, scope: { kind: 'character', characterId } })
        await useWorkflowStore.getState().startWorkflow(workflow)
      } catch (error) {
        addLog('error', text(`行动线检查启动失败：${String(error)}`, `Could not start the action-line check: ${String(error)}`))
      }
    })()
  }

  if (!characterId) {
    return (
      <div className="p-4 text-xs text-[var(--color-text-secondary)]">
        {text('该角色尚未建立稳定人物 ID；先保存角色档案后即可维护行动线。', 'This character has no stable ID yet; save the profile first to maintain the action line.')}
      </div>
    )
  }

  return (
    <div className="p-3 flex flex-col gap-3 text-xs" data-testid="character-action-line">
      <div className="flex items-center gap-2 flex-wrap">
        <Route size={14} className="text-[var(--color-accent)]" />
        <span className="font-semibold text-sm text-[var(--color-text)]">
          {text(`「${characterName}」的行动线`, `Action line of ${characterName}`)}
        </span>
        {duplicateNameOwners > 0 && (
          <span className="text-[10px] text-[var(--color-warning-text)]">
            {text(`注意：另有 ${duplicateNameOwners} 个同名人物，行动按稳定 ID 关联，不受改名影响。`, `Note: ${duplicateNameOwners} other character(s) share this name; actions link by stable ID.`)}
          </span>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => { void loadAll() }} disabled={loading}>
          <RefreshCw size={12} /> {text('刷新', 'Refresh')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={runActionCheck}
          title={text('AI 检查行动是否符合当时目标、资源与认知；只提建议', 'AI checks actions against goals, resources, and knowledge; suggestions only')}
          data-testid="action-line-check-run"
        >
          <ListChecks size={12} /> {text('行动线检查', 'Action-line check')}
        </Button>
        <Button variant="default" size="sm" onClick={openCreate} data-testid="action-create">
          <Plus size={12} /> {text('新增行动', 'New action')}
        </Button>
      </div>

      {formOpen && (
        <div className="rounded-md border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)' }} data-testid="action-form">
          <div className="flex flex-wrap gap-2">
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={text('行动标题', 'Action title')} className="h-8 text-xs w-56" data-testid="action-title" />
            <NativeSelect value={formVisibility} onChange={e => setFormVisibility(e.target.value as 'on-stage' | 'off-stage')} className="h-8 text-xs w-44" data-testid="action-visibility">
              <option value="on-stage">{text('台前（读者可见）', 'On-stage (visible)')}</option>
              <option value="off-stage">{text('幕后（尚未向读者展示，但可能已发生）', 'Off-stage (not yet shown; may still have happened)')}</option>
            </NativeSelect>
            <label className="flex items-center gap-1 h-8">
              <input
                type="checkbox"
                checked={knowledgeIds.length > 0}
                onChange={e => setKnowledgeIds(e.target.checked ? (records[0] ? [records[0].id] : []) : [])}
                title={text('声明所据认知（在下方选择记录）', 'Declare based-on knowledge (pick records below)')}
              />
              <span className="text-[11px] text-[var(--color-text-secondary)]">{text('声明所据认知', 'Based on knowledge')}</span>
            </label>
          </div>
          <Textarea value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} rows={2} placeholder={text('目标/行动意图', 'Goal / intent')} className="text-xs" data-testid="action-goal" />
          <div className="flex flex-wrap gap-2">
            <Input value={form.resources} onChange={e => setForm({ ...form, resources: e.target.value })} placeholder={text('掌握的资源', 'Resources')} className="h-8 text-xs flex-1 min-w-40" />
            <Input value={form.constraints} onChange={e => setForm({ ...form, constraints: e.target.value })} placeholder={text('限制', 'Constraints')} className="h-8 text-xs flex-1 min-w-40" />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <NativeSelect value={formEventId} onChange={e => setFormEventId(e.target.value)} className="h-8 text-xs max-w-56" data-testid="action-event">
              <option value="">{text('未关联时间线事件', 'No timeline event')}</option>
              {(timeline?.events ?? []).map(event => (
                <option key={event.id} value={event.id}>{event.title || event.id}</option>
              ))}
            </NativeSelect>
            {!formEventId && (
              <Input value={form.plannedNote} onChange={e => setForm({ ...form, plannedNote: e.target.value })} placeholder={text('行动计划（尚未排入时间线）', 'Planned action (not on the timeline yet)')} className="h-8 text-xs flex-1 min-w-40" />
            )}
            <Input
              value={formNarrativeChapter}
              onChange={e => setFormNarrativeChapter(e.target.value)}
              placeholder={text('叙事呈现章（幕后可留空）', 'Narrative chapter (empty for off-stage)')}
              className="h-8 text-xs w-48"
            />
            <Input value={form.relatedChapters} onChange={e => setForm({ ...form, relatedChapters: e.target.value })} placeholder={text('受影响章（顿号分隔）', 'Affected chapters (separated)')} className="h-8 text-xs w-44" />
          </div>
          {records.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {records.map(record => {
                const checked = knowledgeIds.includes(record.id)
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${checked ? 'ring-1' : ''}`}
                    style={{
                      borderColor: checked ? 'var(--color-accent)' : 'var(--color-border)',
                      backgroundColor: checked ? 'var(--color-accent)' : 'transparent',
                      opacity: checked ? 0.1 : 1,
                      color: 'var(--color-text)',
                    }}
                    onClick={() => setKnowledgeIds(checked
                      ? knowledgeIds.filter(id => id !== record.id)
                      : [...knowledgeIds, record.id])}
                  >
                    {entryTitleById.get(record.infoId) ?? record.infoId}
                    {` · ${text(KNOWLEDGE_COGNITION_LABEL[record.cognition].zh, KNOWLEDGE_COGNITION_LABEL[record.cognition].en)}`}
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Input value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value })} placeholder={text('人物侧结果（事件结果以时间线为准）', 'Character-side outcome (event outcomes live on the timeline)')} className="h-8 text-xs flex-1 min-w-56" />
            <Input value={form.aftermath} onChange={e => setForm({ ...form, aftermath: e.target.value })} placeholder={text('后续影响', 'Aftermath')} className="h-8 text-xs flex-1 min-w-40" />
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>{text('取消', 'Cancel')}</Button>
            <Button variant="outline" size="sm" onClick={() => { void handleSave() }} data-testid="action-save">{text('保存', 'Save')}</Button>
          </div>
        </div>
      )}

      {/* 行动列表 */}
      <div className="flex flex-col gap-1.5" data-testid="action-list">
        {actions.length === 0 && !formOpen && (
          <div className="text-[11px] text-[var(--color-text-secondary)] px-1 py-2">{text('暂无行动记录', 'No action records')}</div>
        )}
        {actions.map(action => (
          <div key={action.id} className="rounded-md border px-2.5 py-2" style={{ borderColor: 'var(--color-border)' }} data-testid={`action-${action.id}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-[var(--color-text)]">{action.title}</span>
              <span
                className="text-[10px] rounded px-1 py-0.5 border"
                style={{
                  borderColor: 'var(--color-border)',
                  color: action.visibility === 'off-stage' ? 'var(--color-warning-text)' : 'var(--color-text-secondary)',
                }}
              >
                {action.visibility === 'off-stage' ? text('幕后（未展示≠未发生）', 'Off-stage (unshown ≠ unhappened)') : text('台前', 'On-stage')}
              </span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                {action.eventDangling
                  ? text('（关联事件已删除）', '(linked event deleted)')
                  : action.event
                    ? text(`事件：${action.event.title}`, `Event: ${action.event.title}`)
                    : text('尚未排入时间线', 'Not on the timeline')}
              </span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                {action.narrativePosition.kind === 'chapter-scene'
                  ? text(`呈现于第${action.narrativePosition.chapterNumber}章`, `Shown at Ch${action.narrativePosition.chapterNumber}`)
                  : text('未排章', 'No chapter')}
              </span>
              <div className="flex-1" />
              {!action.eventId && action.plannedNote && (
                <Button variant="outline" size="sm" onClick={() => { void handlePromote(action) }} data-testid={`action-promote-${action.id}`}>
                  <CalendarClock size={11} /> {text('加入故事时间线', 'Add to the timeline')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => openEdit(action)}>{text('编辑', 'Edit')}</Button>
              <Button variant="ghost" size="sm" className="text-[var(--color-destructive)]" onClick={() => { void handleDelete(action) }}>
                <Trash2 size={11} />
              </Button>
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] mt-1 line-clamp-2">
              {text('目标：', 'Goal: ')}{action.goal}
              {action.resources.trim() ? ` ${text('｜资源：', '| Resources: ')}${action.resources}` : ''}
            </div>
            {action.basedOnKnowledgeIds.length > 0 && (
              <div className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                {text('所据认知：', 'Based on: ')}
                {action.basedOnKnowledgeIds.map(id => {
                  const record = records.find(candidate => candidate.id === id)
                  if (!record) return `${id.slice(0, 10)}…${text('（已失效）', ' (stale)')}`
                  return entryTitleById.get(record.infoId) ?? id
                }).join('；')}
              </div>
            )}
            {(action.outcome || action.aftermath) && (
              <div className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                {action.outcome ? `${text('结果：', 'Outcome: ')}${action.outcome}` : ''}
                {action.aftermath ? ` ${text('｜影响：', '| Aftermath: ')}${action.aftermath}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 按角色过滤的原时间线视图（只读，不复制节点） */}
      <section className="rounded-md border" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <CalendarClock size={13} className="text-[var(--color-accent)]" />
          <span className="font-semibold">{text('时间线中的相关事件（原时间线只读过滤）', 'Related timeline events (read-only filter of the original timeline)')}</span>
          <span className="text-[10px] text-[var(--color-text-secondary)]">
            {text('按行动关联 + 人物名匹配；事件修改请到故事时间线', 'By action links + name match; edit events on the story timeline')}
          </span>
        </div>
        <div className="p-2 flex flex-col gap-1">
          {timelineEventsForCharacter.length === 0 && (
            <div className="text-[11px] text-[var(--color-text-secondary)] px-1">{text('暂无相关事件', 'No related events')}</div>
          )}
          {timelineEventsForCharacter.map(event => (
            <div key={event.id} className="flex flex-wrap items-center gap-2 text-[11px] px-1 py-0.5">
              <span className="font-medium text-[var(--color-text)]">{event.title || event.id}</span>
              <span className="text-[var(--color-text-secondary)]">{event.timeLabel || text('时间未定', 'time unset')}</span>
              <span className="text-[10px] rounded px-1 border" style={{ borderColor: 'var(--color-border)' }}>{event.status}</span>
              {event.outcome && <span className="text-[var(--color-text-secondary)]">{text('结果：', 'Outcome: ')}{event.outcome}</span>}
              {event.characterNames.length > 1 && (
                <span className="text-[10px] text-[var(--color-text-secondary)]">{text('参与：', 'With: ')}{event.characterNames.filter(name => name !== characterName).join('、')}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 行动线检查报告 */}
      <section className="rounded-md border" style={{ borderColor: 'var(--color-border)' }} data-testid="action-line-reports">
        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="font-semibold">{text('行动线检查报告（建议级）', 'Action-line check reports (suggestions)')}</span>
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          {reports.length === 0 && (
            <div className="text-[11px] text-[var(--color-text-secondary)] px-1">{text('暂无报告', 'No reports')}</div>
          )}
          {reports.map(report => (
            <div key={report.id} className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--color-text-secondary)]">{new Date(report.createdAt).toLocaleString()}</span>
                <span className="text-[11px]">{text(`${report.findings.length} 条建议`, `${report.findings.length} suggestion(s)`)}</span>
              </div>
              {report.findings.map(finding => (
                <div key={finding.id} className="mt-1 rounded px-1.5 py-1" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
                  <div className="font-medium">{finding.title}</div>
                  <div className="text-[11px] text-[var(--color-text-secondary)] whitespace-pre-wrap">{finding.detail}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
