import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useCultivationStore } from '../../stores/cultivation-store'
import { useProjectStore } from '../../stores/project-store'
import { registerEditorExitSaveHandler } from '../../stores/editor-store'
import { useEditorStore } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { cultivationLevels, CULTIVATION_PRESETS, type CultivationRealm } from '../../shared/cultivation'
import { createBusinessFieldDocumentIdentity } from '../../shared/document-editing'
import { getActiveProjectSessionContext, projectSessionContextFromProject, sameProjectSessionContext } from '../../shared/project-session-context'
import { randomUUID } from '../../utils/id'
import { ipc } from '../../services/ipc-client'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { NativeSelect } from '../ui/NativeSelect'
import { confirm } from '../ui/Confirm'
import DocumentEditingSurface from '../editor/DocumentEditingSurface'

function move<T>(items: T[], index: number, offset: number): T[] {
  const result = [...items]
  const other = index + offset
  if (other >= 0 && other < result.length) [result[index], result[other]] = [result[other], result[index]]
  return result
}

export default function CultivationSettingsPage({ projectKey, tabId, initialContent, initialDirty }: { projectKey: string; tabId: string; initialContent: string; initialDirty: boolean }) {
  const text = useLocaleStore(state => state.text)
  const tabsId = useId()
  const project = useProjectStore(state => state.currentProject)
  const documentIdentity = createBusinessFieldDocumentIdentity({
    projectId: project?.id ?? `inactive:${projectKey}`,
    entityType: 'project-settings',
    entityId: 'cultivation',
    fieldId: 'markdown',
  })
  const session = projectSessionContextFromProject(project)
  const store = useCultivationStore()
  const [activePane, setActivePane] = useState<'mechanism' | 'levels'>('mechanism')
  const mechanismTabRef = useRef<HTMLButtonElement>(null)
  const levelsTabRef = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState('')
  const [all, setAll] = useState(false)
  const [impact, setImpact] = useState<{ name: string; levelId: string }[] | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, string | null>>({})
  const [result, setResult] = useState('')
  const [checking, setChecking] = useState(false)
  const restoredMarkdown = useRef(false)
  const ready = session?.projectPath === projectKey && sameProjectSessionContext(session, store.session) && !!store.system && !store.loading
  const levels = cultivationLevels(store.realms)
  const realm = store.realms.find(entry => entry.id === selected)
  const locked = !ready || store.saving || checking || !!impact
  useEffect(() => { if (session?.projectPath === projectKey) void store.load(session) }, [session?.leaseId, projectKey])
  useEffect(() => { if (!store.realms.some(entry => entry.id === selected)) setSelected(store.realms[0]?.id ?? '') }, [store.realms, selected])
  useEffect(() => { setImpact(null); setResolutions({}); setResult('') }, [session?.leaseId])
  useEffect(() => {
    if (!ready || restoredMarkdown.current || !initialDirty) return
    restoredMarkdown.current = true
    store.editMarkdown(initialContent)
  }, [ready, initialContent, initialDirty, store.editMarkdown])
  const edit = (realms: CultivationRealm[]) => { store.edit(realms); setResult('') }
  const updateRealm = (next: CultivationRealm) => edit(store.realms.map(entry => entry.id === next.id ? next : entry))
  const applyPreset = async (names: readonly string[]) => {
    if (locked || !realm || !session) return
    const captured = session
    const targets = all ? store.realms : [realm]
    if (targets.some(entry => entry.stages.length)) {
      const accepted = await confirm(text('替换已有小境界？保存前将要求处理受影响角色。', 'Replace existing stages? Affected characters must be resolved before saving.'), { title: text('替换小境界', 'Replace stages'), confirmText: text('替换', 'Replace'), danger: true })
      if (!accepted || !sameProjectSessionContext(captured, getActiveProjectSessionContext())) return
    }
    edit(store.realms.map(entry => targets.some(target => target.id === entry.id)
      ? { ...entry, stages: names.map(name => ({ id: randomUUID(), name })) } : entry))
  }
  const save = async () => {
    if (!ready || !session || store.saving || checking) return
    setChecking(true); setResult('')
    try {
      const roster = await ipc.invokeWithProjectSession(session, 'db:character-roster-read', projectKey)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      const ids = new Set(levels.map(level => level.id))
      const affected = roster.entries.filter(entry => entry.cultivationLevelId && !ids.has(entry.cultivationLevelId)).map(entry => ({ name: entry.name, levelId: entry.cultivationLevelId! }))
      if (affected.length) { setImpact(affected); setResolutions({}); setActivePane('levels'); return }
      const markdownSnapshot = store.markdown
      useEditorStore.getState().syncTabContent(tabId, markdownSnapshot)
      const currentTab = useEditorStore.getState().tabs.find(tab => tab.id === tabId)
      const snapshot = { content: markdownSnapshot, contentRevision: currentTab?.contentRevision ?? 0 }
      if (await store.save({})) {
        useEditorStore.getState().settleTabSave(tabId, snapshot)
        setResult(text('力量体系已保存', 'Power system saved'))
      }
    } catch (error) { if (sameProjectSessionContext(session, getActiveProjectSessionContext())) setResult(String(error)) }
    finally { setChecking(false) }
  }
  useEffect(() => registerEditorExitSaveHandler({ tabId, type: 'cultivation', projectKey, save: async () => { await save() } }), [tabId, projectKey, save])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })
  const addRealm = () => {
    const id = randomUUID()
    edit([...store.realms, { id, name: text('新境界', 'New realm'), levelId: randomUUID(), stages: [] }])
    setSelected(id)
  }
  const focusPane = (pane: 'mechanism' | 'levels') => {
    setActivePane(pane)
    window.requestAnimationFrame(() => (pane === 'mechanism' ? mechanismTabRef : levelsTabRef).current?.focus())
  }

  return <div className="h-full min-h-0 flex flex-col overflow-hidden text-[var(--color-text)]" data-testid="cultivation-settings">
    <div className="w-full max-w-6xl mx-auto flex-1 min-h-0 flex flex-col p-4 sm:p-6">
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{text('力量体系', 'Power system')}</h2><p className="text-xs text-[var(--color-text-secondary)] mt-1">{text('维护力量来源、能力机制、成长条件、限制与代价；等级结构按需使用。', 'Define power sources, mechanics, growth, limits, and costs. Use a level structure only when useful.')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><span role="status" className="text-xs">{!ready ? text('尚未读取', 'Not loaded') : store.dirty ? text('未保存', 'Unsaved') : text('已保存', 'Saved')}</span>
          <Button variant="outline" disabled={locked || !store.dirty} onClick={() => { store.discard(); useEditorStore.getState().markTabSaved(tabId, store.system?.markdown ?? ''); setResult('') }}>{text('放弃修改', 'Discard changes')}</Button>
          <Button disabled={locked || !store.dirty || store.conflicted} onClick={() => void save()}>{store.saving || checking ? text('保存中…', 'Saving…') : text('保存力量体系', 'Save power system')}</Button></div>
      </header>
      {store.error && <p role="alert" className="shrink-0 text-sm text-[var(--color-error)] whitespace-pre-wrap">{store.error}</p>}
      {result && <p role="status" className="shrink-0 text-sm whitespace-pre-wrap">{result}</p>}
      {!ready ? <p className="mt-4">{text('正在读取项目等级…', 'Loading project levels…')}</p> : <>
        <div role="tablist" aria-label={text('力量体系设置', 'Power system settings')} className="shrink-0 flex gap-1 border-b border-[var(--color-border)] mt-3">
          {(['mechanism', 'levels'] as const).map(pane => {
            const isMechanism = pane === 'mechanism'
            const label = isMechanism ? text('机制说明', 'Mechanism') : text('等级结构', 'Levels')
            const selectedPane = activePane === pane
            return <button
              key={pane}
              ref={isMechanism ? mechanismTabRef : levelsTabRef}
              id={`${tabsId}-${pane}-tab`}
              type="button"
              role="tab"
              aria-selected={selectedPane}
              aria-controls={`${tabsId}-${pane}-panel`}
              tabIndex={selectedPane ? 0 : -1}
              onClick={() => setActivePane(pane)}
              onKeyDown={event => {
                const nextPane = event.key === 'Home' ? 'mechanism'
                  : event.key === 'End' ? 'levels'
                    : event.key === 'ArrowRight' ? 'levels'
                      : event.key === 'ArrowLeft' ? 'mechanism' : null
                if (!nextPane) return
                event.preventDefault()
                focusPane(nextPane)
              }}
              className={`min-h-9 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] ${selectedPane ? 'border-[var(--color-accent)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'}`}
            >{label}</button>
          })}
        </div>

        <div
          id={`${tabsId}-mechanism-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-mechanism-tab`}
          hidden={activePane !== 'mechanism'}
          style={{ display: activePane === 'mechanism' ? 'flex' : 'none' }}
          className="flex-1 min-h-0 min-w-0 overflow-hidden"
        >
          <DocumentEditingSurface
            documentIdentity={documentIdentity}
            layout="long-document"
            outlineControl="page"
            appearance="plain"
            showToolbar={false}
            ariaLabel={text('机制说明', 'Mechanism')}
            content={store.markdown}
            editable={!locked}
            onChange={markdown => { store.editMarkdown(markdown); useEditorStore.getState().updateTabContent(tabId, markdown) }}
            onSave={() => save()}
            placeholder={text('力量来自哪里？怎样成长？能力有哪些限制、代价与通用边界？可直接粘贴 Markdown。', 'Where does power come from? How does it grow? Describe limits, costs, and shared rules in Markdown.')}
            className="h-full min-h-0"
          />
        </div>

        <div
          id={`${tabsId}-levels-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-levels-tab`}
          hidden={activePane !== 'levels'}
          style={{ display: activePane === 'levels' ? 'block' : 'none' }}
          className="flex-1 min-h-0 min-w-0 overflow-y-auto pt-4"
        >
          <div className="space-y-4">
            {!store.realms.length ? <section className="space-y-3" data-testid="cultivation-levels-empty">
              <p className="text-sm text-[var(--color-text-secondary)]">{text('尚未设置等级结构。需要时再新增；没有等级结构也可以单独保存机制说明。', 'No level structure yet. Add one when useful; mechanism notes can be saved independently.')}</p>
              <Button variant="outline" disabled={locked} onClick={addRealm}>{text('新增大境界', 'Add realm')}</Button>
            </section> : <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <section className="min-w-0 space-y-3"><h3 className="text-sm font-semibold">{text('大境界', 'Realms')}</h3>
                {store.realms.map((entry, index) => <div key={entry.id} className={`rounded-lg border border-[var(--color-border)] p-2 space-y-2 ${selected === entry.id ? 'bg-[var(--color-hover)]' : ''}`}>
                  <div className="flex gap-2 items-center"><Button variant="ghost" aria-pressed={selected === entry.id} disabled={locked} onClick={() => setSelected(entry.id)}>{index + 1}</Button><Input aria-label={text(`大境界 ${index + 1} 名称`, `Realm ${index + 1} name`)} value={entry.name} disabled={locked} onChange={event => updateRealm({ ...entry, name: event.target.value })} /></div>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" aria-label={text(`上移大境界 ${index + 1}`, `Move realm ${index + 1} up`)} disabled={locked || index === 0} onClick={() => edit(move(store.realms, index, -1))}><ArrowUp size={14} /></Button>
                    <Button variant="ghost" aria-label={text(`下移大境界 ${index + 1}`, `Move realm ${index + 1} down`)} disabled={locked || index === store.realms.length - 1} onClick={() => edit(move(store.realms, index, 1))}><ArrowDown size={14} /></Button>
                    <Button variant="ghost" aria-label={text(`删除大境界 ${index + 1}`, `Delete realm ${index + 1}`)} disabled={locked} onClick={() => edit(store.realms.filter(next => next.id !== entry.id))}><Trash2 size={14} /></Button>
                  </div>
                </div>)}
                <Button variant="outline" disabled={locked} onClick={addRealm}>{text('新增大境界', 'Add realm')}</Button>
              </section>
              <section className="min-w-0 space-y-3"><h3 className="text-sm font-semibold">{text('当前大境界的小境界', 'Stages of the selected realm')}{realm && ` · ${realm.name}`}</h3>
                {realm ? <>
                  {!realm.stages.length && <p className="text-xs">{text('无小境界：大境界自身作为一个完整等级。', 'No stages: this realm itself is one complete level.')}</p>}
                  {realm.stages.map((stage, index) => <div key={stage.id} className="flex flex-wrap items-center gap-1">
                    <Input className="flex-1 min-w-24" aria-label={text(`小境界 ${index + 1} 名称`, `Stage ${index + 1} name`)} value={stage.name} disabled={locked} onChange={event => updateRealm({ ...realm, stages: realm.stages.map(next => next.id === stage.id ? { ...next, name: event.target.value } : next) })} />
                    <Button variant="ghost" aria-label={text(`上移小境界 ${index + 1}`, `Move stage ${index + 1} up`)} disabled={locked || index === 0} onClick={() => updateRealm({ ...realm, stages: move(realm.stages, index, -1) })}><ArrowUp size={14} /></Button>
                    <Button variant="ghost" aria-label={text(`下移小境界 ${index + 1}`, `Move stage ${index + 1} down`)} disabled={locked || index === realm.stages.length - 1} onClick={() => updateRealm({ ...realm, stages: move(realm.stages, index, 1) })}><ArrowDown size={14} /></Button>
                    <Button variant="ghost" aria-label={text(`删除小境界 ${index + 1}`, `Delete stage ${index + 1}`)} disabled={locked} onClick={() => updateRealm({ ...realm, stages: realm.stages.filter(next => next.id !== stage.id) })}><Trash2 size={14} /></Button>
                  </div>)}
                  <Button variant="outline" disabled={locked} onClick={() => updateRealm({ ...realm, stages: [...realm.stages, { id: randomUUID(), name: text('新小境界', 'New stage') }] })}>{text('新增小境界', 'Add stage')}</Button>
                  <div className="border-t border-[var(--color-border)] pt-3 space-y-2"><h4 className="text-xs font-semibold">{text('小境界预设', 'Stage presets')}</h4>
                    <label className="flex gap-2 text-xs"><input type="checkbox" checked={all} disabled={locked} onChange={event => setAll(event.target.checked)} />{text('应用到全部大境界', 'Apply to all realms')}</label>
                    <div className="flex flex-wrap gap-2">{CULTIVATION_PRESETS.map(preset => <Button key={preset.en} variant="outline" disabled={locked} onClick={() => void applyPreset(preset.names)}>{text(preset.zh, preset.en)}</Button>)}</div>
                  </div>
                </> : <p className="text-xs">{text('请选择或新增大境界', 'Select or add a realm')}</p>}
              </section>
            </div>}
            {impact && <section role="dialog" aria-label={text('处理受影响角色', 'Resolve affected characters')} className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
              <h3 className="text-sm font-semibold">{text('以下角色引用的等级将被删除', 'These characters reference levels being removed')}</h3>
              <p className="text-xs">{text('逐一重新指定，或显式解除绑定。确认后与等级配置一起保存；取消不会写入数据库。', 'Choose a replacement or explicitly unbind each character. All changes save together. Cancel writes nothing.')}</p>
              {impact.map(entry => <label key={entry.name} className="block text-xs">{entry.name}<NativeSelect aria-label={text(`${entry.name} 的新等级`, `Replacement level for ${entry.name}`)} value={Object.hasOwn(resolutions, entry.name) ? resolutions[entry.name] ?? '__clear__' : ''} onChange={event => { const value = event.target.value; setResolutions(previous => { const next = { ...previous }; if (!value) delete next[entry.name]; else next[entry.name] = value === '__clear__' ? null : value; return next }) }} disabled={store.saving}>
                <option value="">{text('请选择处理方式', 'Choose a resolution')}</option><option value="__clear__">{text('显式解除绑定', 'Explicitly unbind')}</option>{levels.map(level => <option key={level.id} value={level.id}>{level.number} = {level.name}</option>)}
              </NativeSelect></label>)}
              <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={store.saving} onClick={() => { setImpact(null); setResolutions({}) }}>{text('取消影响处理', 'Cancel impact resolution')}</Button>
                <Button disabled={store.saving || impact.some(entry => !Object.hasOwn(resolutions, entry.name))} onClick={async () => { if (await store.save(resolutions)) { setImpact(null); setResult(text('等级与角色绑定已一并保存', 'Levels and character bindings saved together')) } }}>{text('确认并原子保存', 'Confirm and save together')}</Button></div>
            </section>}
            {!!levels.length && <details className="border-t border-[var(--color-border)] pt-4">
              <summary className="cursor-pointer text-sm font-semibold">{text('完整等级预览', 'Complete level preview')}</summary>
              <ol className="mt-2 text-xs space-y-1 tabular-nums">{levels.map(level => <li key={level.id}>{level.number} = {level.name}</li>)}</ol>
            </details>}
          </div>
        </div>
      </>}
    </div>
  </div>
}
