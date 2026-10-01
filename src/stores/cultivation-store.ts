import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { getActiveProjectSessionContext, sameProjectSessionContext } from '../shared/project-session-context'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type { CharacterRosterSnapshot } from '../shared/character-roster'
import { cultivationLevels, validateCultivationRealms, type CultivationRealm, type CultivationSystem } from '../shared/cultivation'
import { useCharacterStore } from './character-store'
import { useEditorStore } from './editor-store'
import { parseProjectEditorDraftLedger, recordProjectEditorEdit, rebaseProjectEditorDraft, persistProjectEditorDraftLedger, settleProjectEditorSave } from './project-editor-draft-ledger'

const TAB = { id: 'cultivation-settings', type: 'cultivation' as const, name: '修炼等级设置' }
let loadSequence = 0
function ledger() { return parseProjectEditorDraftLedger<CultivationRealm[]>(useEditorStore.getState().draftLedgers[TAB.id]) }
function persist(value: ReturnType<typeof ledger>) { persistProjectEditorDraftLedger(useEditorStore.getState(), TAB, value) }
function current(session: ProjectSessionContext | null) { return !!session && sameProjectSessionContext(session, getActiveProjectSessionContext()) }

interface CultivationState {
  session: ProjectSessionContext | null
  system: CultivationSystem | null
  realms: CultivationRealm[]
  roster: CharacterRosterSnapshot | null
  dirty: boolean
  loading: boolean
  saving: boolean
  error: string | null
  conflicted: boolean
  load: (session: ProjectSessionContext) => Promise<void>
  edit: (realms: CultivationRealm[]) => void
  discard: () => void
  save: (resolutions: Record<string, string | null>) => Promise<boolean>
}
export const useCultivationStore = create<CultivationState>((set, get) => ({
  session: null, system: null, realms: [], roster: null, dirty: false, loading: false, saving: false, error: null, conflicted: false,
  load: async session => {
    if (!current(session)) return
    if (sameProjectSessionContext(get().session, session) && (get().loading || get().saving || get().system)) return
    const sequence = ++loadSequence
    set({ session, system: null, realms: [], roster: null, dirty: false, loading: true, saving: false, error: null, conflicted: false })
    try {
      const [system, roster] = await Promise.all([
        ipc.invokeWithProjectSession(session, 'db:cultivation-read', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:character-roster-read', session.projectPath),
      ])
      if (!current(session) || sequence !== loadSequence) return
      validateCultivationRealms(system?.realms)
      if (!Number.isSafeInteger(system.revision) || system.revision < 0) throw new Error('Invalid cultivation revision')
      const existingDraft = ledger().projects.find(entry => entry.projectKey === session.projectPath)
      const conflicted = !!existingDraft && JSON.stringify(existingDraft.baseValue) !== JSON.stringify(system.realms)
      const restored = rebaseProjectEditorDraft(ledger(), session.projectPath, system.realms, (_base, draft) => draft)
      // Preserve the original base on conflict, so reopening cannot bypass conflict review.
      if (conflicted && existingDraft) restored.ledger.projects = restored.ledger.projects.map(entry => entry.projectKey === session.projectPath ? existingDraft : entry)
      persist(restored.ledger)
      set({ system, realms: restored.value, roster, dirty: JSON.stringify(system.realms) !== JSON.stringify(restored.value), loading: false, conflicted,
        error: conflicted ? '等级配置已在其他会话更新；草稿已保留。请检查草稿后放弃修改，重新读取当前配置。 / Settings changed in another session; draft retained. Review and discard the draft to use the current configuration.' : null })
    } catch (error) {
      if (current(session) && sequence === loadSequence) set({ error: String(error), loading: false })
    }
  },
  edit: realms => {
    const state = get()
    if (!current(state.session) || !state.system || state.loading || state.saving) return
    persist(recordProjectEditorEdit(ledger(), state.session!.projectPath, state.realms, realms))
    set({ realms, dirty: JSON.stringify(realms) !== JSON.stringify(state.system.realms), error: state.conflicted ? state.error : null })
  },
  discard: () => {
    const state = get()
    if (!current(state.session) || !state.system || state.saving) return
    persist(settleProjectEditorSave(ledger(), state.session!.projectPath, state.system.realms, state.system.realms))
    set({ realms: state.system.realms, dirty: false, error: null, conflicted: false })
  },
  save: async resolutions => {
    const state = get()
    const session = state.session
    if (!current(session) || !state.system || !state.roster || state.saving || state.conflicted) return false
    set({ saving: true, error: null })
    try {
      // Refresh the impact roster so ordinary character saves do not force a settings reload.
      const roster = await ipc.invokeWithProjectSession(session!, 'db:character-roster-read', session!.projectPath)
      if (!current(session)) return false
      const response = await ipc.invokeWithProjectSession(session!, 'db:cultivation-save', {
        expectedRevision: state.system.revision, expectedRosterRevision: roster.revision, realms: state.realms, resolutions,
      }, session!.projectPath)
      if (!current(session)) return false
      if (!response.success || !response.result) throw new Error(response.error ?? 'Could not save cultivation settings')
      useCharacterStore.getState().acceptCultivationSnapshot(response.result.roster, session!, new Set(cultivationLevels(response.result.system.realms).map(level => level.id)))
      persist(settleProjectEditorSave(ledger(), session!.projectPath, response.result.system.realms, response.result.system.realms))
      set({ system: response.result.system, realms: response.result.system.realms, roster: response.result.roster, dirty: false, saving: false })
      return true
    } catch (error) {
      if (current(session)) set({ saving: false, error: String(error) })
      return false
    }
  },
}))
