import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useCultivationStore } from '../../../stores/cultivation-store'
import { useCharacterStore, type CharacterCard } from '../../../stores/character-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { cultivationLevelAt, cultivationLevels } from '../../../shared/cultivation'
import { projectSessionContextFromProject, sameProjectSessionContext, getActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useLocaleStore } from '../../../stores/locale-store'
import { CHARACTER_DRAFT_TAB, getProjectEditorDraft, parseProjectEditorDraftLedger } from '../../../stores/project-editor-draft-ledger'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'

export function openCultivationSettings(projectKey: string, name: string) {
  useEditorStore.getState().openFile({ id: 'cultivation-settings', name, type: 'cultivation', projectKey })
}

export default function CharacterCultivationField({ card, onChange }: { card: CharacterCard; onChange?: (id: string | null) => void }) {
  const text = useLocaleStore(state => state.text)
  const project = useProjectStore(state => state.currentProject)
  const session = projectSessionContextFromProject(project)
  const store = useCultivationStore()
  const characterBusy = useCharacterStore(state => state.identityBusy || state.saving)
  const [number, setNumber] = useState('')
  const [realmChoice, setRealmChoice] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const identity = useRef(card.name)
  identity.current = card.name
  useEffect(() => { if (session) void store.load(session) }, [session?.leaseId, session?.projectPath])
  const ready = sameProjectSessionContext(store.session, session) && !!store.system && !store.loading
  const realms = ready ? store.system!.realms : []
  const levels = cultivationLevels(realms)
  const level = levels.find(entry => entry.id === card.cultivationLevelId)
  useEffect(() => { setNumber(level ? String(level.number) : ''); setRealmChoice(level?.realmId ?? ''); setMessage('') }, [card.name, level?.id, level?.number])
  const draftLedgers = useEditorStore(state => state.draftLedgers)
  const draft = session ? getProjectEditorDraft(parseProjectEditorDraftLedger(draftLedgers[CHARACTER_DRAFT_TAB.id]), session.projectPath) : undefined
  const lockedByDraft = !onChange && !!draft
  const disabled = busy || characterBusy || store.saving || lockedByDraft || !ready
  const choose = async (id: string | null) => {
    if (disabled || !session) return
    if (onChange) { onChange(id); setMessage(text('未保存：请保存角色档案', 'Unsaved: save the character profile')); return }
    const name = card.name
    setBusy(true); setMessage('')
    useCharacterStore.getState().updateField(name, 'cultivationLevelId', id)
    try {
      await useCharacterStore.getState().saveAll(session.projectPath, session)
      if (sameProjectSessionContext(session, getActiveProjectSessionContext()) && identity.current === name) setMessage(text('修炼等级已保存', 'Cultivation level saved'))
    } catch (error) {
      if (sameProjectSessionContext(session, getActiveProjectSessionContext()) && identity.current === name) setMessage(text(`保存失败，修改已保留：${String(error)}`, `Save failed; changes retained: ${String(error)}`))
    } finally { setBusy(false) }
  }
  const selectedRealm = realms.find(realm => realm.id === realmChoice)
  return <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-editor-bg)] p-3 space-y-2" aria-label={text('修炼等级', 'Cultivation level')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">{text('修炼等级', 'Cultivation level')}</h4>
      <Button variant="ghost" onClick={() => session && openCultivationSettings(session.projectPath, text('修炼等级设置', 'Cultivation settings'))}>{text('管理修炼等级', 'Manage cultivation levels')}</Button>
    </div>
    {!ready ? <p role="status" className="text-xs">{store.error ?? text('正在读取修炼体系…', 'Loading cultivation system…')}</p>
      : !levels.length ? <p className="text-xs">{text('尚未设置修炼体系', 'No cultivation system configured')}</p>
        : <>
          <p className="text-sm">{level ? `${level.number} = ${level.name}` : text('未设置', 'Not set')}</p>
          <div className="flex flex-wrap gap-2 items-end">
            <Button variant="outline" aria-label={text('降低一级', 'Previous level')} disabled={disabled || !level || level.number === 1} onClick={() => void choose(levels[level!.number - 2].id)}><Minus size={14} /></Button>
            <Button variant="outline" aria-label={text('提高一级', 'Next level')} disabled={disabled || !level || level.number === levels.length} onClick={() => void choose(levels[level!.number].id)}><Plus size={14} /></Button>
            <label className="min-w-24 flex-1 text-xs">{text('大境界', 'Realm')}
              <NativeSelect aria-label={text('选择大境界', 'Select realm')} value={realmChoice} disabled={disabled} onChange={event => {
                const realm = realms.find(realm => realm.id === event.target.value)
                setRealmChoice(event.target.value)
                if (realm && !realm.stages.length) void choose(realm.levelId)
              }}><option value="">{text('请选择', 'Choose')}</option>{realms.map(realm => <option key={realm.id} value={realm.id}>{realm.name}</option>)}</NativeSelect>
            </label>
            {selectedRealm && selectedRealm.stages.length > 0 && <label className="min-w-24 flex-1 text-xs">{text('小境界', 'Stage')}
              <NativeSelect aria-label={text('选择小境界', 'Select stage')} value={level?.realmId === realmChoice ? level.id : ''} disabled={disabled} onChange={event => { if (event.target.value) void choose(event.target.value) }}><option value="">{text('请选择', 'Choose')}</option>{selectedRealm.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</NativeSelect>
            </label>}
            <label className="w-28 text-xs">{text('等级序号', 'Level number')}<Input aria-label={text('等级序号', 'Level number')} inputMode="numeric" value={number} disabled={disabled} onChange={event => setNumber(event.target.value)} /></label>
            <Button variant="outline" disabled={disabled} onClick={() => { const target = cultivationLevelAt(realms, number); if (!target) setMessage(text(`请输入 1–${levels.length} 的整数等级`, `Enter an integer level from 1 to ${levels.length}`)); else void choose(target.id) }}>{text('应用等级', 'Apply level')}</Button>
            <Button variant="ghost" disabled={disabled || !card.cultivationLevelId} onClick={() => void choose(null)}>{text('清除绑定', 'Clear binding')}</Button>
          </div>
          {lockedByDraft && <p className="text-xs">{text('角色档案有未保存修改，请先保存或在编辑档案中调整等级。', 'Save the pending profile edits, or change the level in Edit profile.')}</p>}
        </>}
    {message && <p role="status" className="text-xs whitespace-pre-wrap">{message}</p>}
  </section>
}
