/**
 * 知情记录编辑器（信息与揭露页）。
 *
 * 一条记录 = 某主体（人物/读者）对某信息条目的具体认知状态。人物认知不保证正确；
 * 读者记录只写"作者预期的读者理解"。故事位置与叙事位置分别编辑，互不推断。
 */

import { useEffect, useMemo, useState } from 'react'
import { useLocaleStore } from '../../../stores/locale-store'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'
import { Textarea } from '../../ui/Textarea'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import {
  KNOWLEDGE_COGNITION_LABEL,
  KNOWLEDGE_TRUTH_RELATION_LABEL,
  type InfoEntry,
  type KnowledgeCognition,
  type KnowledgeRecord,
  type KnowledgeRecordDraft,
  type KnowledgeTruthRelation,
} from '../../../shared/knowledge-gap'
import type { StoryTimelineSnapshot } from '../../../shared/story-timeline'
import { validateProseAnchor, computeProseContentHash } from '../../../shared/prose-anchor'
import { saveKnowledgeRecord, deleteKnowledgeRecord } from '../../../services/knowledge-gap-client'
import { ipc } from '../../../services/ipc-client'

interface CharacterOption {
  id: string
  name: string
}

interface KnowledgeRecordEditorProps {
  projectSession: ProjectSessionContext
  entry: InfoEntry
  record?: KnowledgeRecord | null
  characterOptions: CharacterOption[]
  timeline: StoryTimelineSnapshot | null
  onSaved: () => void
  onCancel: () => void
}

const COGNITIONS = Object.keys(KNOWLEDGE_COGNITION_LABEL) as KnowledgeCognition[]
const TRUTH_RELATIONS = Object.keys(KNOWLEDGE_TRUTH_RELATION_LABEL) as KnowledgeTruthRelation[]

export default function KnowledgeRecordEditor({
  projectSession,
  entry,
  record,
  characterOptions,
  timeline,
  onSaved,
  onCancel,
}: KnowledgeRecordEditorProps) {
  const text = useLocaleStore(s => s.text)
  const [subjectKind, setSubjectKind] = useState<'character' | 'reader'>(record?.subjectKind ?? 'character')
  const [characterId, setCharacterId] = useState(record?.characterId ?? characterOptions[0]?.id ?? '')
  const [knownContent, setKnownContent] = useState(record?.knownContent ?? '')
  const [cognition, setCognition] = useState<KnowledgeCognition>(record?.cognition ?? 'heard')
  const [believedStatement, setBelievedStatement] = useState(record?.believedStatement ?? '')
  const [truthRelation, setTruthRelation] = useState<KnowledgeTruthRelation>(record?.truthRelation ?? 'undetermined')
  const [learningChannel, setLearningChannel] = useState(record?.learningChannel ?? '')
  const [channelSourceNote, setChannelSourceNote] = useState(record?.channelSourceNote ?? '')
  const [storyKind, setStoryKind] = useState<'unplaced' | 'manual' | 'timeline-event'>(record?.storyPosition.kind === 'unplaced' ? 'unplaced' : record?.storyPosition.kind ?? 'unplaced')
  const [storyEventId, setStoryEventId] = useState(record?.storyPosition.kind === 'timeline-event' ? record.storyPosition.eventId : '')
  const [storySortOrder, setStorySortOrder] = useState(record?.storyPosition.kind === 'manual' ? String(record.storyPosition.sortOrder) : '')
  const [storyLabel, setStoryLabel] = useState(record?.storyPosition.kind === 'manual' ? record.storyPosition.label : '')
  const [narrativeChapter, setNarrativeChapter] = useState(record?.narrativePosition.kind === 'chapter-scene' ? String(record.narrativePosition.chapterNumber) : '')
  const [narrativeOrdinal, setNarrativeOrdinal] = useState(record?.narrativePosition.kind === 'chapter-scene' && record.narrativePosition.authorOrdinal !== undefined ? String(record.narrativePosition.authorOrdinal) : '')
  const [concealing, setConcealing] = useState(Boolean(record?.concealment))
  const [concealFrom, setConcealFrom] = useState(record?.concealment?.fromCharacterIds.join('、') ?? '')
  const [publicStatement, setPublicStatement] = useState(record?.concealment?.publicStatement ?? '')
  const [shownEvidence, setShownEvidence] = useState(record?.reader?.shownEvidence ?? '')
  const [expectedUnderstanding, setExpectedUnderstanding] = useState(record?.reader?.expectedUnderstanding ?? '')
  const [revealPlanNote, setRevealPlanNote] = useState(record?.reader?.revealPlanNote ?? '')
  const [basis, setBasis] = useState<'plan' | 'prose'>(record?.basis ?? 'plan')
  const [anchorDraftId, setAnchorDraftId] = useState('')
  const [anchorExcerpt, setAnchorExcerpt] = useState(record?.proseAnchor?.excerpt ?? '')
  const [anchorDrafts, setAnchorDrafts] = useState<Array<{ id: number; version: number; chapterNumber: number; status: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const drafts = await ipc.invokeWithProjectSession(
          projectSession, 'db:draft-list-all', projectSession.projectPath,
        ) as Array<{ id: number; version: number; chapterNumber: number; status: string }>
        if (!cancelled) setAnchorDrafts(drafts)
      } catch {
        if (!cancelled) setAnchorDrafts([])
      }
    })()
    return () => { cancelled = true }
  }, [projectSession])

  const timelineEvents = useMemo(() => timeline?.events ?? [], [timeline])

  const handleSave = async () => {
    setError('')
    const storyPosition = storyKind === 'timeline-event'
      ? { kind: 'timeline-event' as const, eventId: storyEventId }
      : storyKind === 'manual'
        ? { kind: 'manual' as const, sortOrder: Number(storySortOrder) || 0, label: storyLabel }
        : { kind: 'unplaced' as const }
    const chapterValue = Number.parseInt(narrativeChapter, 10)
    const ordinalValue = narrativeOrdinal.trim() ? Number.parseInt(narrativeOrdinal, 10) : undefined
    const narrativePosition = Number.isSafeInteger(chapterValue) && chapterValue >= 1
      ? { kind: 'chapter-scene' as const, chapterNumber: chapterValue, ...(ordinalValue !== undefined ? { authorOrdinal: ordinalValue } : {}) }
      : { kind: 'unplaced' as const }

    let proseAnchor: KnowledgeRecordDraft['proseAnchor']
    if (basis === 'prose') {
      const draftId = Number.parseInt(anchorDraftId, 10)
      const draft = anchorDrafts.find(candidate => candidate.id === draftId)
      const excerpt = anchorExcerpt.trim()
      if (!draft || !excerpt) {
        setError(text('正文依据需要选择草稿并粘贴原文片段', 'Prose basis requires a draft and an excerpt'))
        return
      }
      const full = await ipc.invokeWithProjectSession(
        projectSession, 'db:draft-get-full', draftId, projectSession.projectPath,
      ) as { content: string; status: string } | null
      if (!full) {
        setError(text('所选草稿不存在', 'The selected draft does not exist'))
        return
      }
      const offset = full.content.indexOf(excerpt)
      if (offset < 0 && !validateProseAnchor({
        draftId, version: draft.version, status: draft.status === 'finalized' ? 'finalized' : 'draft',
        contentHash: computeProseContentHash(full.content), excerpt,
      }, full.content)) {
        setError(text('片段不在该草稿正文中，无法锚定', 'The excerpt is not in this draft, cannot anchor it'))
        return
      }
      proseAnchor = {
        draftId,
        version: draft.version,
        status: draft.status === 'finalized' ? 'finalized' : 'draft',
        contentHash: computeProseContentHash(full.content),
        excerpt,
        ...(offset >= 0 ? { startOffset: offset, endOffset: offset + excerpt.length } : {}),
      }
    }

    const draft: KnowledgeRecordDraft = {
      infoId: entry.id,
      subjectKind,
      ...(subjectKind === 'character' ? { characterId } : {}),
      knownContent,
      cognition,
      believedStatement,
      truthRelation,
      learningChannel,
      channelSourceNote,
      storyPosition,
      narrativePosition,
      concealment: subjectKind === 'character' && concealing
        ? { fromCharacterIds: concealFrom.split(/[、,，]/).map(part => part.trim()).filter(Boolean), publicStatement }
        : null,
      basis,
      ...(proseAnchor ? { proseAnchor } : {}),
      reader: subjectKind === 'reader'
        ? { shownEvidence, expectedUnderstanding, revealPlanNote }
        : null,
    }
    setSaving(true)
    try {
      await saveKnowledgeRecord(projectSession, { ...draft, ...(record ? { id: record.id, baseRevision: record.revision } : {}) })
      onSaved()
    } catch (saveError) {
      setError(String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!record) return
    await deleteKnowledgeRecord(projectSession, record.id)
    onSaved()
  }

  const fieldLabel = 'text-xs font-medium text-[var(--color-text-secondary)]'
  return (
    <div className="rounded-md border p-3 text-xs flex flex-col gap-2.5" style={{ borderColor: 'var(--color-border)' }} data-testid="knowledge-record-editor">
      <div className="flex items-center gap-2">
        <span className={fieldLabel}>{text('主体类型', 'Subject')}</span>
        <NativeSelect
          value={subjectKind}
          onChange={e => setSubjectKind(e.target.value as 'character' | 'reader')}
          className="h-7 text-xs"
        >
          <option value="character">{text('人物', 'Character')}</option>
          <option value="reader">{text('读者（作者预期）', 'Reader (author expectation)')}</option>
        </NativeSelect>
        {subjectKind === 'character' && (
          <NativeSelect
            value={characterId}
            onChange={e => setCharacterId(e.target.value)}
            className="h-7 text-xs max-w-44"
            data-testid="knowledge-record-character"
          >
            {characterOptions.length === 0 && <option value="">{text('（先在角色档案创建角色）', '(create characters first)')}</option>}
            {characterOptions.map(option => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </NativeSelect>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>{text('取消', 'Cancel')}</Button>
        {record && (
          <Button variant="destructive" size="sm" onClick={() => { void handleDelete() }}>{text('删除', 'Delete')}</Button>
        )}
        <Button variant="outline" size="sm" disabled={saving} onClick={() => { void handleSave() }} data-testid="knowledge-record-save">
          {saving ? text('保存中…', 'Saving…') : text('保存记录', 'Save record')}
        </Button>
      </div>
      {error && <div className="text-[11px] text-[var(--color-destructive)]">{error}</div>}

      {subjectKind === 'character' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{text('知道的具体内容/部分', 'What exactly they know')}</span>
            <Textarea value={knownContent} onChange={e => setKnownContent(e.target.value)} rows={2} className="text-xs" data-testid="knowledge-record-content" />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>{text('认知状态（人物主观，不保证正确）', 'Cognition (subjective)')}</span>
              <NativeSelect value={cognition} onChange={e => setCognition(e.target.value as KnowledgeCognition)} className="h-7 text-xs" data-testid="knowledge-record-cognition">
                {COGNITIONS.map(value => (
                  <option key={value} value={value}>{text(KNOWLEDGE_COGNITION_LABEL[value].zh, KNOWLEDGE_COGNITION_LABEL[value].en)}</option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>{text('与作者真相关系', 'Relation to author truth')}</span>
              <NativeSelect value={truthRelation} onChange={e => setTruthRelation(e.target.value as KnowledgeTruthRelation)} className="h-7 text-xs">
                {TRUTH_RELATIONS.map(value => (
                  <option key={value} value={value}>{text(KNOWLEDGE_TRUTH_RELATION_LABEL[value].zh, KNOWLEDGE_TRUTH_RELATION_LABEL[value].en)}</option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>{text('获知途径', 'Learning channel')}</span>
              <Input value={learningChannel} onChange={e => setLearningChannel(e.target.value)} className="h-7 text-xs w-36" placeholder={text('亲历/告知/调查/推断', 'witnessed / told / investigation / inference')} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>{text('途径来源（事件/章节/人物）', 'Channel source')}</span>
              <Input value={channelSourceNote} onChange={e => setChannelSourceNote(e.target.value)} className="h-7 text-xs w-40" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{text('人物相信的说法', 'What they believe')}</span>
            <Input value={believedStatement} onChange={e => setBelievedStatement(e.target.value)} className="h-7 text-xs" />
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={concealing} onChange={e => setConcealing(e.target.checked)} />
              <span className={fieldLabel}>{text('隐瞒（可与误解并存）', 'Concealing (can coexist with misconception)')}</span>
            </label>
            {concealing && (
              <>
                <label className="flex items-center gap-1">
                  <span className={fieldLabel}>{text('向谁（人物名，顿号分隔）', 'From (names, separated)')}</span>
                  <Input value={concealFrom} onChange={e => setConcealFrom(e.target.value)} className="h-7 text-xs w-40" />
                </label>
                <Input value={publicStatement} onChange={e => setPublicStatement(e.target.value)} className="h-7 text-xs w-56" placeholder={text('公开说法', 'Public statement')} />
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{text('已展示给读者的证据', 'Evidence shown to readers')}</span>
            <Textarea value={shownEvidence} onChange={e => setShownEvidence(e.target.value)} rows={2} className="text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{text('作者预期的读者理解（不是断言真实读者猜到什么）', 'Expected reader understanding (not a claim about real readers)')}</span>
            <Textarea value={expectedUnderstanding} onChange={e => setExpectedUnderstanding(e.target.value)} rows={2} className="text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{text('计划揭露位置说明', 'Planned reveal note')}</span>
            <Input value={revealPlanNote} onChange={e => setRevealPlanNote(e.target.value)} className="h-7 text-xs" />
          </label>
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>{text('故事位置（剧情内时点）', 'Story position')}</span>
          <NativeSelect value={storyKind} onChange={e => setStoryKind(e.target.value as typeof storyKind)} className="h-7 text-xs">
            <option value="unplaced">{text('位置未知（不猜）', 'Unplaced (do not guess)')}</option>
            <option value="timeline-event">{text('时间线事件', 'Timeline event')}</option>
            <option value="manual">{text('自定义顺序', 'Manual order')}</option>
          </NativeSelect>
        </label>
        {storyKind === 'timeline-event' && (
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{text('事件', 'Event')}</span>
            <NativeSelect value={storyEventId} onChange={e => setStoryEventId(e.target.value)} className="h-7 text-xs max-w-48">
              <option value="">{text('（选择）', '(select)')}</option>
              {timelineEvents.map(event => (
                <option key={event.id} value={event.id}>{event.title || event.id}</option>
              ))}
            </NativeSelect>
          </label>
        )}
        {storyKind === 'manual' && (
          <>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>{text('顺序值（小者在前）', 'Order (smaller first)')}</span>
              <Input value={storySortOrder} onChange={e => setStorySortOrder(e.target.value)} className="h-7 text-xs w-20" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>{text('说明', 'Label')}</span>
              <Input value={storyLabel} onChange={e => setStoryLabel(e.target.value)} className="h-7 text-xs w-32" />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>{text('叙事位置·章（读者看到处）', 'Narrative chapter')}</span>
          <Input value={narrativeChapter} onChange={e => setNarrativeChapter(e.target.value)} className="h-7 text-xs w-16" placeholder={text('未知', 'unknown')} />
        </label>
        {narrativeChapter.trim() && (
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{text('章内序（同章多场景）', 'Within-chapter ordinal')}</span>
            <Input value={narrativeOrdinal} onChange={e => setNarrativeOrdinal(e.target.value)} className="h-7 text-xs w-16" placeholder={text('可选', 'optional')} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>{text('记录依据', 'Basis')}</span>
          <NativeSelect value={basis} onChange={e => setBasis(e.target.value as 'plan' | 'prose')} className="h-7 text-xs">
            <option value="plan">{text('计划', 'Plan')}</option>
            <option value="prose">{text('正文依据（带锚点）', 'Prose (anchored)')}</option>
          </NativeSelect>
        </label>
        {basis === 'prose' && (
          <>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>{text('来源草稿', 'Source draft')}</span>
              <NativeSelect value={anchorDraftId} onChange={e => setAnchorDraftId(e.target.value)} className="h-7 text-xs max-w-40">
                <option value="">{text('（选择草稿）', '(select draft)')}</option>
                {anchorDrafts.map(draft => (
                  <option key={draft.id} value={String(draft.id)}>{`第${draft.chapterNumber}章 v${draft.version} #${draft.id}`}</option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-48">
              <span className={fieldLabel}>{text('原文片段（逐字粘贴）', 'Excerpt (paste verbatim)')}</span>
              <Input value={anchorExcerpt} onChange={e => setAnchorExcerpt(e.target.value)} className="h-7 text-xs" />
            </label>
          </>
        )}
      </div>
    </div>
  )
}
