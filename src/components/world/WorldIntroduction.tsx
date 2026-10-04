import { useEffect, useRef, useState, type FormEvent } from 'react'

import type { WorldRecord } from '../../shared/world-workbench'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import type { WorldIntroductionProps } from './world-management-contract'
import './WorldIntroduction.css'

type WorldIntroductionDraft = Pick<WorldRecord, 'id' | 'name' | 'summary' | 'background' | 'notes'>

function draftFrom(world: WorldRecord): WorldIntroductionDraft {
  return {
    id: world.id,
    name: world.name,
    summary: world.summary,
    background: world.background,
    notes: world.notes,
  }
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

export default function WorldIntroduction({
  world,
  summaries,
  connections,
  editRequestToken,
  saving,
  saveError,
  onSave,
  onNavigate,
  onCreate,
  onEditingChange,
}: WorldIntroductionProps) {
  const text = useLocaleStore(state => state.text)
  const [editingWorldId, setEditingWorldId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WorldIntroductionDraft | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localSaving, setLocalSaving] = useState(false)
  const previousWorldId = useRef(world.id)
  // Zero means no pending request. A positive value must also work on first mount because
  // the persistent header can switch to this section in the same render that increments it.
  const previousEditRequestToken = useRef(0)

  // Key the inline draft to the world it was opened for. If the parent switches worlds,
  // the previous world's draft becomes inaccessible and can never be submitted to the new one.
  const editing = editingWorldId === world.id && draft?.id === world.id
  const busy = saving || localSaving
  const error = saveError ?? localError
  const hasIntroduction = hasText(world.summary) || hasText(world.background) || hasText(world.notes)

  useEffect(() => {
    if (previousWorldId.current === world.id) return
    previousWorldId.current = world.id
    setDraft(null)
    setEditingWorldId(null)
    setLocalError(null)
  }, [world.id])

  useEffect(() => {
    if (previousEditRequestToken.current === editRequestToken) return
    const isNewRequest = editRequestToken > previousEditRequestToken.current
    previousEditRequestToken.current = editRequestToken
    if (!isNewRequest) return
    if (editingWorldId === world.id && draft?.id === world.id) return
    setDraft(draftFrom(world))
    setEditingWorldId(world.id)
    setLocalError(null)
  }, [draft, editRequestToken, editingWorldId, world])

  useEffect(() => {
    onEditingChange(editing)
  }, [editing, onEditingChange])

  const beginEdit = () => {
    setDraft(draftFrom(world))
    setEditingWorldId(world.id)
    setLocalError(null)
  }

  const cancelEdit = () => {
    if (busy) return
    setDraft(null)
    setEditingWorldId(null)
    setLocalError(null)
  }

  const updateDraft = (field: keyof Omit<WorldIntroductionDraft, 'id'>, value: string) => {
    setDraft(previous => previous && previous.id === world.id
      ? { ...previous, [field]: value }
      : previous)
    setLocalError(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !editing || !draft || draft.id !== world.id) return
    if (!draft.name.trim()) {
      setLocalError(text('世界名称不能为空。', 'World name is required.'))
      return
    }

    setLocalSaving(true)
    setLocalError(null)
    try {
      const saved = await onSave({
        id: world.id,
        name: draft.name.trim(),
        summary: draft.summary,
        background: draft.background,
        notes: draft.notes,
      })
      if (saved?.id === world.id) {
        setDraft(null)
        setEditingWorldId(null)
        setLocalError(null)
      } else {
        setLocalError(text('保存失败，请检查后重试。', 'Save failed. Check the error and try again.'))
      }
    } catch (reason) {
      setLocalError(reason instanceof Error && reason.message
        ? text(`保存失败：${reason.message}`, `Save failed: ${reason.message}`)
        : text('保存失败，请检查后重试。', 'Save failed. Check the error and try again.'))
    } finally {
      setLocalSaving(false)
    }
  }

  const relatedConnections = connections.filter(connection => (
    connection.fromWorldId === world.id || connection.toWorldId === world.id
  ))

  const endpointName = (worldId: string, name: string | null) => {
    if (worldId === world.id) return world.name
    return name?.trim() ? name : text('世界引用缺失', 'Missing world reference')
  }

  return (
    <article className="world-introduction" aria-label={text(`${world.name}：世界介绍`, `${world.name}: World introduction`)}>
      <header className="world-introduction__header">
        <div className="world-introduction__title-group">
          <p className="world-introduction__eyebrow">{text('世界介绍', 'World introduction')}</p>
          <h1 className="world-introduction__title">{world.name}</h1>
        </div>
      </header>

      {editing && draft ? (
        <form className="world-introduction__editor" onSubmit={event => void submit(event)} aria-label={text('编辑世界介绍', 'Edit world introduction')}>
          <div className="world-introduction__field">
            <label htmlFor="world-introduction-name">{text('世界名称', 'World name')}</label>
            <Input
              id="world-introduction-name"
              autoFocus
              value={draft.name}
              aria-required="true"
              onChange={event => updateDraft('name', event.target.value)}
            />
          </div>
          <div className="world-introduction__field">
            <label htmlFor="world-introduction-summary">{text('一句话介绍', 'One-line summary')}</label>
            <Input
              id="world-introduction-summary"
              value={draft.summary}
              onChange={event => updateDraft('summary', event.target.value)}
            />
          </div>
          <div className="world-introduction__field">
            <label htmlFor="world-introduction-background">{text('世界背景与介绍', 'World background and introduction')}</label>
            <p className="world-introduction__help" id="world-introduction-background-help">
              {text('这里是什么地方？有什么独特规则或文明？主要矛盾是什么？', 'What kind of place is this? What rules or cultures make it distinct? What is its central conflict?')}
            </p>
            <Textarea
              id="world-introduction-background"
              rows={10}
              value={draft.background}
              placeholder={text('这里是什么地方？有什么独特规则或文明？主要矛盾是什么？', 'What kind of place is this? What rules or cultures make it distinct? What is its central conflict?')}
              aria-describedby="world-introduction-background-help"
              onChange={event => updateDraft('background', event.target.value)}
            />
          </div>
          <div className="world-introduction__field">
            <label htmlFor="world-introduction-notes">{text('补充说明', 'Additional notes')}</label>
            <Textarea
              id="world-introduction-notes"
              rows={6}
              value={draft.notes}
              onChange={event => updateDraft('notes', event.target.value)}
            />
          </div>
          {error && <p className="world-introduction__error" role="alert">{error}</p>}
          <div className="world-introduction__form-actions">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancelEdit}>
              {text('取消', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy} data-testid="world-introduction-save">
              {busy ? text('保存中…', 'Saving…') : text('保存介绍', 'Save introduction')}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {!hasIntroduction && (
            <div className="world-introduction__empty-callout">
              <div>
                <h2>{text('这个世界还没有介绍内容。', 'This world has no introduction yet.')}</h2>
                <p>{text('可以先补充背景，也可以直接维护势力和秘境。', 'Add background now, or go straight to its factions and relics.')}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={beginEdit} disabled={busy}>
                {text('填写世界介绍', 'Write introduction')}
              </Button>
            </div>
          )}
          <section className="world-introduction__section world-introduction__summary-section" aria-labelledby="world-summary-heading">
            <h2 id="world-summary-heading">{text('一句话介绍', 'One-line summary')}</h2>
            {hasText(world.summary)
              ? <p className="world-introduction__reading-text world-introduction__summary">{world.summary}</p>
              : <p className="world-introduction__empty">{text('尚未填写一句话介绍。', 'No one-line summary yet.')}</p>}
          </section>

          <section className="world-introduction__section" aria-labelledby="world-background-heading">
            <h2 id="world-background-heading">{text('世界背景与介绍', 'World background and introduction')}</h2>
            {hasText(world.background)
              ? <p className="world-introduction__reading-text">{world.background}</p>
              : <p className="world-introduction__empty">{text('尚未填写世界背景。', 'No world background yet.')}</p>}
          </section>

          <section className="world-introduction__section" aria-labelledby="world-notes-heading">
            <h2 id="world-notes-heading">{text('补充说明', 'Additional notes')}</h2>
            {hasText(world.notes)
              ? <p className="world-introduction__reading-text">{world.notes}</p>
              : <p className="world-introduction__empty">{text('尚未填写补充说明。', 'No additional notes yet.')}</p>}
          </section>
        </>
      )}

      <section className="world-introduction__section" aria-labelledby="world-composition-heading">
        <h2 id="world-composition-heading">{text('组成摘要', 'Composition')}</h2>
        {summaries.length > 0 ? (
          <ul className="world-introduction__composition-list">
            {summaries.map(summary => (
              <li key={summary.section}>
                <button
                  className="world-introduction__composition-row"
                  type="button"
                  aria-label={text(`进入${summary.label}分区`, `Open ${summary.label}`)}
                  onClick={() => onNavigate(summary.section)}
                >
                  <span className="world-introduction__composition-heading">
                    <span className="world-introduction__composition-label">{summary.label}</span>
                    <span className="world-introduction__composition-count">{text(`${summary.count} 项`, `${summary.count} items`)}</span>
                  </span>
                  {summary.preview.length > 0 ? (
                    <span className="world-introduction__preview-list" aria-label={`${summary.label}名称预览`}>
                      {summary.preview.map((name, index) => (
                        <span className="world-introduction__preview-name" key={`${summary.section}-${index}`}>{name}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="world-introduction__empty-preview">
                      {summary.count === 0 ? text('暂无记录', 'No records yet') : text('暂无名称预览', 'No names to preview')}
                    </span>
                  )}
                  <span className="world-introduction__row-action" aria-hidden="true">{text('查看', 'View')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="world-introduction__empty">{text('暂无组成摘要。', 'No composition data yet.')}</p>
        )}
        <div className="world-introduction__quick-actions" aria-label={text('快速添加', 'Quick add')}>
          <Button type="button" size="sm" variant="outline" onClick={() => onCreate('factions')}>
            {text('添加势力', 'Add faction')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onCreate('relics')}>
            {text('添加秘境', 'Add relic')}
          </Button>
        </div>
      </section>

      <section className="world-introduction__section world-introduction__connections" aria-labelledby="world-connections-heading">
        <div className="world-introduction__section-heading">
          <h2 id="world-connections-heading">{text('跨世界联系', 'Cross-world links')}</h2>
          <Button type="button" size="sm" variant="ghost" onClick={() => onNavigate('portals')}>
            {text('查看全部联系', 'View all connections')}
          </Button>
        </div>
        {relatedConnections.length > 0 ? (
          <ul className="world-introduction__connection-list">
            {relatedConnections.map(connection => (
              <li className="world-introduction__connection-row" data-testid="world-introduction-connection" key={connection.id}>
                <div className="world-introduction__connection-topline">
                  <h3>{connection.name}</h3>
                  <span className="world-introduction__connection-status">{connection.statusLabel || '状态未设定'}</span>
                </div>
                <p className="world-introduction__connection-route">
                  <span>{endpointName(connection.fromWorldId, connection.fromWorldName)}</span>
                  <span aria-label={connection.bidirectional ? text('双向', 'Bidirectional') : text('单向', 'One way')}>
                    {connection.bidirectional ? ' ↔ ' : ' → '}
                  </span>
                  <span>{endpointName(connection.toWorldId, connection.toWorldName)}</span>
                </p>
                <p className="world-introduction__connection-condition">
                  {text('通行条件：', 'Condition: ')}{hasText(connection.condition) ? connection.condition : text('尚未设定', 'Not set')}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="world-introduction__empty">{text('暂无跨世界联系。', 'No cross-world links yet.')}</p>
        )}
      </section>
    </article>
  )
}
