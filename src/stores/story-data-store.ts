import { create } from 'zustand'
import { storyDataService } from '../services/story-data-service'
import { getActiveProjectSessionContext, sameProjectSessionContext } from '../shared/project-session-context'
import type {
  StoryCandidateReviewStatus,
  StoryEntityType,
  StoryFact,
  StoryFactCandidate,
  StoryFactImpact,
  StoryFactVersion,
  StoryFactVersionCommitInput,
  StoryFactRelation,
  StoryRecordStatus,
} from '../shared/story-domain'

interface StoryDataState {
  candidates: StoryFactCandidate[]
  facts: StoryFact[]
  selectedFactId: string | null
  versions: StoryFactVersion[]
  impacts: StoryFactImpact[]
  relations: StoryFactRelation[]
  allRelations: StoryFactRelation[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
  selectFact: (factId: string | null) => Promise<void>
  approve: (candidateId: string, approvedBy?: string) => Promise<boolean>
  reject: (candidateId: string) => Promise<boolean>
  commit: (input: Omit<StoryFactVersionCommitInput, 'projectId' | 'changedBy'>, changedBy?: string) => Promise<boolean>
  addRelation: (toFactId: string, relationType: string) => Promise<boolean>
  reset: () => void
}

export const useStoryDataStore = create<StoryDataState>((set, get) => ({
  candidates: [],
  facts: [],
  selectedFactId: null,
  versions: [],
  impacts: [],
  relations: [],
  allRelations: [],
  loading: false,
  error: null,

  load: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) {
      set({ loading: false, error: '缺少当前项目会话' })
      return
    }
    set({ loading: true, error: null })
    try {
      const [candidates, facts, allRelations] = await Promise.all([
        storyDataService.listCandidates(session, undefined, 'pending'),
        storyDataService.listFacts(session),
        storyDataService.listRelations(session),
      ])
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ candidates, facts, allRelations, loading: false })
      const selected = get().selectedFactId
      if (selected) await get().selectFact(selected)
    } catch (error) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  selectFact: async (factId: string | null) => {
    const session = getActiveProjectSessionContext()
    if (!session || !factId) {
      set({ selectedFactId: null, versions: [], impacts: [], relations: [] })
      return
    }
    set({ selectedFactId: factId })
    try {
      const [versions, impacts, relations] = await Promise.all([
        storyDataService.listVersions(session, factId),
        storyDataService.listImpacts(session, factId),
        storyDataService.listRelations(session, factId),
      ])
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ versions, impacts, relations })
    } catch (error) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  approve: async (candidateId: string, approvedBy = 'author') => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    try {
      const result = await storyDataService.approveCandidate(session, {
        projectId: session.projectId,
        candidateId,
        approvedBy,
      })
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (!result.success) {
        set({ error: result.error || '确认失败' })
        return false
      }
      await get().load()
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return false
    }
  },

  reject: async (candidateId: string) => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    try {
      const result = await storyDataService.rejectCandidate(session, candidateId)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (!result.success) {
        set({ error: result.error || '拒绝失败' })
        return false
      }
      await get().load()
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return false
    }
  },

  commit: async (input, changedBy = 'author') => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    try {
      const result = await storyDataService.commitFactVersion(session, {
        ...input,
        projectId: session.projectId,
        changedBy,
      })
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if ('success' in result && result.success === false) {
        set({ error: result.error || '版本提交失败' })
        return false
      }
      await get().load()
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return false
    }
  },

  addRelation: async (toFactId, relationType) => {
    const session = getActiveProjectSessionContext()
    const fromFact = get().facts.find(fact => fact.factId === get().selectedFactId)
    if (!session || !fromFact || !toFactId.trim() || !relationType.trim()) return false
    try {
      const result = await storyDataService.addRelation(session, {
        projectId: session.projectId,
        fromFactId: fromFact.factId,
        toFactId,
        relationType,
        provenance: fromFact.provenance,
      })
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if ('success' in result && result.success === false) {
        set({ error: result.error || '关系提交失败' })
        return false
      }
      await get().selectFact(fromFact.factId)
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return false
    }
  },

  reset: () => set({ candidates: [], facts: [], selectedFactId: null, versions: [], impacts: [], relations: [], allRelations: [], loading: false, error: null }),
}))

export type StoryDataFilterStatus = StoryRecordStatus | StoryCandidateReviewStatus
export type StoryDataFilterEntity = StoryEntityType
