/**
 * 世界资料工作台 store。
 *
 * 与 world-map-store 同一套会话纪律：
 * - 每个异步动作在开始时捕获冻结的项目会话，结束时用 isProjectSessionCurrent
 *   复核；A 项目的迟到响应绝不写进 B 项目的 store。
 * - 只用 projectKey 比较路径是不够的：同一路径关闭再打开会拿到新 lease，
 *   因此判断始终基于「项目 id + lease + 路径」三者。
 * - 写入失败时保持当前世界与当前实体选中不变，界面据此保留作者输入。
 */
import { toast } from '../components/ui/Toast'
import { create } from 'zustand'

import { captureProjectSession, isProjectSessionCurrent } from '../components/project-session-gate'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import {
  createWorldEntityId,
  type WorldCharacterLink,
  type WorldCharacterLocation,
  type WorldCharacterTrail,
  type WorldCurrentLocationCommitOptions,
  type WorldDeletePlan,
  type WorldEventLink,
  type WorldFaction,
  type WorldFactionCharacter,
  type WorldFactionPlace,
  type WorldFactionRelation,
  type WorldMapAssignmentPlan,
  type WorldPortal,
  type WorldPortalCharacter,
  type WorldPortalFaction,
  type WorldRecord,
  type WorldRelic,
  type WorldRelicCharacter,
  type WorldRelicFaction,
  type WorldRule,
  type WorldRuleTarget,
  type WorldEntityKind,
  type WorldWorkbenchSnapshot,
} from '../shared/world-workbench'
import { ipc } from '../services/ipc-client'
import { useProjectStore } from './project-store'

export type WorldSectionKey =
  | 'overview'
  | 'maps'
  | 'factions'
  | 'relics'
  | 'characters'
  | 'portals'
  | 'rules'
  | 'events'
  | 'trails'

export const WORLD_SECTION_KEYS: WorldSectionKey[] = [
  'overview', 'maps', 'factions', 'relics', 'characters', 'portals', 'rules', 'events', 'trails',
]

export const EMPTY_WORLD_SNAPSHOT: WorldWorkbenchSnapshot = {
  worlds: [],
  mapWorldLinks: [],
  factions: [],
  factionPlaces: [],
  factionRelations: [],
  factionCharacters: [],
  relics: [],
  relicFactions: [],
  relicCharacters: [],
  portals: [],
  portalFactions: [],
  portalCharacters: [],
  rules: [],
  ruleTargets: [],
  characterLinks: [],
  characterLocations: [],
  characterLocationViews: [],
  trails: [],
  eventWorlds: [],
  eventLinks: [],
  characterRefs: [],
  migration: null,
}

interface WriteResult {
  success: boolean
  error?: string
}

interface WorldWorkbenchState {
  loading: boolean
  loadedProjectKey: string | null
  data: WorldWorkbenchSnapshot
  selectedWorldId: string | null
  section: WorldSectionKey
  /** 最近一次真实失败原因；界面据此显示实际状态而不是成功提示。 */
  lastError: string | null

  setSelectedWorldId: (worldId: string | null) => void
  setSection: (section: WorldSectionKey) => void
  reset: () => void

  loadAll: (projectPath: string) => Promise<void>

  saveWorld: (world: Partial<WorldRecord> & { name: string }, projectPath: string) => Promise<WorldRecord | null>
  planWorldDelete: (worldId: string, projectPath: string) => Promise<WorldDeletePlan | null>
  deleteWorld: (worldId: string, projectPath: string) => Promise<boolean>

  planMapAssignment: (mapId: string, nextWorldId: string | null, projectPath: string) => Promise<WorldMapAssignmentPlan | null>
  applyMapAssignment: (mapId: string, nextWorldId: string | null, projectPath: string) => Promise<boolean>

  saveFaction: (faction: Partial<WorldFaction> & { worldId: string; name: string }, projectPath: string) => Promise<WorldFaction | null>
  deleteFaction: (factionId: string, detachEventLinks: boolean, projectPath: string) => Promise<boolean>
  saveFactionPlace: (place: WorldFactionPlace, projectPath: string) => Promise<boolean>
  saveFactionRelation: (relation: WorldFactionRelation, projectPath: string) => Promise<boolean>
  saveFactionCharacter: (link: WorldFactionCharacter, projectPath: string) => Promise<boolean>

  saveRelic: (relic: Partial<WorldRelic> & { worldId: string; name: string }, projectPath: string) => Promise<WorldRelic | null>
  deleteRelic: (relicId: string, projectPath: string) => Promise<boolean>
  saveRelicFaction: (link: WorldRelicFaction, projectPath: string) => Promise<boolean>
  saveRelicCharacter: (link: WorldRelicCharacter, projectPath: string) => Promise<boolean>

  savePortal: (portal: Partial<WorldPortal> & { name: string; fromWorldId: string; toWorldId: string }, projectPath: string) => Promise<WorldPortal | null>
  deletePortal: (portalId: string, detachEventLinks: boolean, projectPath: string) => Promise<boolean>
  savePortalFaction: (link: WorldPortalFaction, projectPath: string) => Promise<boolean>
  savePortalCharacter: (link: WorldPortalCharacter, projectPath: string) => Promise<boolean>

  saveRule: (rule: Partial<WorldRule> & { worldId: string; name: string }, projectPath: string) => Promise<WorldRule | null>
  deleteRule: (ruleId: string, detachEventLinks: boolean, projectPath: string) => Promise<boolean>
  saveRuleTarget: (target: Partial<WorldRuleTarget> & { ruleId: string; role: WorldRuleTarget['role']; targetKind: WorldRuleTarget['targetKind']; targetId: string }, projectPath: string) => Promise<boolean>

  saveCharacterLink: (link: WorldCharacterLink, projectPath: string) => Promise<boolean>
  saveBirthLocation: (location: WorldCharacterLocation, projectPath: string) => Promise<boolean>
  commitCurrentLocation: (
    characterId: string,
    worldId: string | null,
    nodeId: string | null,
    options: WorldCurrentLocationCommitOptions,
    projectPath: string,
  ) => Promise<{ ok: boolean; locationText?: string; error?: string }>
  clearCurrentLocation: (characterId: string, projectPath: string) => Promise<boolean>

  commitTrail: (request: { trail: WorldCharacterTrail; alsoSetCurrentLocation: boolean; currentLocation?: WorldCurrentLocationCommitOptions }, projectPath: string) => Promise<boolean>
  planTrailDelete: (trailId: string, projectPath: string) => Promise<WorldDeletePlan | null>
  deleteTrail: (trailId: string, releaseCurrentLocation: boolean, projectPath: string) => Promise<boolean>

  saveEventLinks: (eventId: string, worldIds: string[], links: WorldEventLink[], projectPath: string) => Promise<boolean>
  deleteRelation: (table: string, id: string, projectPath: string) => Promise<boolean>
  /** 统一入口：与实体类型无关的删除影响预览。 */
  planDeleteFor: (kind: WorldEntityKind, entityId: string) => Promise<WorldDeletePlan | null>
  deleteFor: (
    kind: WorldEntityKind,
    entityId: string,
    options: { detachEventLinks?: boolean; releaseCurrentLocation?: boolean },
    projectPath: string,
  ) => Promise<boolean>
  loadCharacterLinks: (projectPath: string) => Promise<void>
}

/** 生成新实体 id 时使用；让新建表单在保存前就能拿到稳定 ID。 */
export const newWorldId = () => createWorldEntityId('world')
export const newFactionId = () => createWorldEntityId('faction')
export const newRelicId = () => createWorldEntityId('relic')
export const newPortalId = () => createWorldEntityId('portal')
export const newRuleId = () => createWorldEntityId('rule')
export const newTrailId = () => createWorldEntityId('trail')

/** 冻结当前会话；路径不一致说明调用方拿的是别的项目的 projectKey。 */
function sessionFor(projectPath: string): ProjectSessionContext | null {
  const session = captureProjectSession(useProjectStore.getState().currentProject)
  if (!session || session.projectPath !== projectPath) return null
  return session
}

export const useWorldWorkbenchStore = create<WorldWorkbenchState>((set, get) => {
  /**
   * 统一的写入口：捕获会话 → 调用 → 失败只提示、绝不改动本地状态。
   * 成功后才刷新快照，因此「保存失败保留输入」是默认行为而不是特例。
   */
  async function write(
    projectPath: string,
    fallbackError: string,
    invoke: (session: ProjectSessionContext) => Promise<WriteResult>,
    options: { silent?: boolean } = {},
  ): Promise<WriteResult | null> {
    const session = sessionFor(projectPath)
    if (!session) {
      set({ lastError: '当前项目会话已失效，已拒绝写入' })
      if (!options.silent) toast.error('当前项目会话已失效，已拒绝写入')
      return null
    }
    try {
      const result = await invoke(session)
      if (!result?.success) {
        const message = result?.error || fallbackError
        set({ lastError: message })
        if (!options.silent) toast.error(message)
        return result ?? null
      }
      if (!isProjectSessionCurrent(session)) return result
      set({ lastError: null })
      await get().loadAll(projectPath)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ lastError: message })
      if (!options.silent) toast.error(message)
      return null
    }
  }

  const loadFrom = async (projectPath: string): Promise<WorldWorkbenchSnapshot | null> => {
    const session = sessionFor(projectPath)
    if (!session) return null
    const data = await ipc.invokeWithProjectSession(session, 'db:world-get-all', projectPath)
    if (!isProjectSessionCurrent(session)) return null
    return data ?? null
  }

  return {
    loading: false,
    loadedProjectKey: null,
    data: EMPTY_WORLD_SNAPSHOT,
    selectedWorldId: null,
    section: 'overview',
    lastError: null,

    setSelectedWorldId: (worldId) => set({ selectedWorldId: worldId }),
    setSection: (section) => set({ section }),
    reset: () => set({
      loading: false,
      loadedProjectKey: null,
      data: EMPTY_WORLD_SNAPSHOT,
      selectedWorldId: null,
      section: 'overview',
      lastError: null,
    }),

    loadAll: async (projectPath) => {
      const session = sessionFor(projectPath)
      if (!session) return
      set({ loading: true })
      try {
        const data = await loadFrom(projectPath)
        // 会话已切换（含同路径重开）时直接放弃：迟到结果不能污染新会话的 store。
        if (!data) return
        const worlds = data.worlds ?? []
        const currentWorldId = get().selectedWorldId
        const selectedWorldId = currentWorldId && worlds.some(world => world.id === currentWorldId)
          ? currentWorldId
          : worlds[0]?.id ?? null
        set({
          data: { ...EMPTY_WORLD_SNAPSHOT, ...data },
          selectedWorldId,
          loadedProjectKey: projectPath,
          loading: false,
          lastError: null,
        })
      } catch (error) {
        if (!isProjectSessionCurrent(session)) return
        set({ loading: false, lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    saveWorld: async (world, projectPath) => {
      const result = await write(projectPath, '保存世界失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-upsert', {
          id: world.id ?? newWorldId(),
          name: world.name,
          summary: world.summary ?? '',
          background: world.background ?? '',
          notes: world.notes ?? '',
          sortOrder: world.sortOrder ?? (get().data.worlds.length + 1),
          createdAt: world.createdAt,
        } as WorldRecord, projectPath))
      const saved = (result as { world?: WorldRecord } | null)?.world ?? null
      if (saved) set({ selectedWorldId: saved.id })
      return saved
    },

    planWorldDelete: async (worldId, projectPath) => {
      const session = sessionFor(projectPath)
      if (!session) return null
      try {
        const result = await ipc.invokeWithProjectSession(session, 'db:world-delete-plan', worldId, projectPath)
        return result?.plan ?? null
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
        return null
      }
    },

    deleteWorld: async (worldId, projectPath) => {
      const result = await write(projectPath, '删除世界失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-delete', worldId, projectPath))
      if (!result?.success) return false
      if (get().selectedWorldId === worldId) set({ selectedWorldId: null })
      return true
    },

    planMapAssignment: async (mapId, nextWorldId, projectPath) => {
      const session = sessionFor(projectPath)
      if (!session) return null
      try {
        const result = await ipc.invokeWithProjectSession(session, 'db:world-map-assignment-plan', mapId, nextWorldId, projectPath)
        return result?.plan ?? null
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
        return null
      }
    },

    applyMapAssignment: async (mapId, nextWorldId, projectPath) => {
      const result = await write(projectPath, '修改地图世界归属失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-map-assignment-apply', mapId, nextWorldId, projectPath))
      return Boolean(result?.success)
    },

    saveFaction: async (faction, projectPath) => {
      const result = await write(projectPath, '保存势力失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-faction-upsert', {
          id: faction.id ?? newFactionId(),
          worldId: faction.worldId,
          name: faction.name,
          type: faction.type ?? '',
          summary: faction.summary ?? '',
          description: faction.description ?? '',
          seat: faction.seat ?? '',
          domainNote: faction.domainNote ?? '',
          notes: faction.notes ?? '',
          createdAt: faction.createdAt,
        } as WorldFaction, projectPath))
      return (result as { faction?: WorldFaction } | null)?.faction ?? null
    },

    deleteFaction: async (factionId, detachEventLinks, projectPath) => {
      const result = await write(projectPath, '删除势力失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-faction-delete', factionId, detachEventLinks, projectPath))
      return Boolean(result?.success)
    },

    saveFactionPlace: async (place, projectPath) => {
      const result = await write(projectPath, '保存势力地点失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-faction-place-upsert', place, projectPath))
      return Boolean(result?.success)
    },

    saveFactionRelation: async (relation, projectPath) => {
      const result = await write(projectPath, '保存势力关系失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-faction-relation-upsert', relation, projectPath))
      return Boolean(result?.success)
    },

    saveFactionCharacter: async (link, projectPath) => {
      const result = await write(projectPath, '保存势力人物失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-faction-character-upsert', link, projectPath))
      return Boolean(result?.success)
    },

    saveRelic: async (relic, projectPath) => {
      const result = await write(projectPath, '保存秘境失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-relic-upsert', {
          id: relic.id ?? newRelicId(),
          worldId: relic.worldId,
          name: relic.name,
          type: relic.type ?? '',
          summary: relic.summary ?? '',
          description: relic.description ?? '',
          locationNote: relic.locationNote ?? '',
          nodeId: relic.nodeId ?? null,
          entranceNodeId: relic.entranceNodeId ?? null,
          entryCondition: relic.entryCondition ?? '',
          danger: relic.danger ?? '',
          rewards: relic.rewards ?? '',
          availabilityNote: relic.availabilityNote ?? '',
          status: relic.status ?? 'undiscovered',
          customStatusLabel: relic.customStatusLabel ?? '',
          notes: relic.notes ?? '',
          createdAt: relic.createdAt,
        } as WorldRelic, projectPath))
      return (result as { relic?: WorldRelic } | null)?.relic ?? null
    },

    deleteRelic: async (relicId, projectPath) => {
      const result = await write(projectPath, '删除秘境失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-relic-delete', relicId, projectPath))
      return Boolean(result?.success)
    },

    saveRelicFaction: async (link, projectPath) => {
      const result = await write(projectPath, '保存秘境势力关联失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-relic-faction-upsert', link, projectPath))
      return Boolean(result?.success)
    },

    saveRelicCharacter: async (link, projectPath) => {
      const result = await write(projectPath, '保存秘境人物关联失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-relic-character-upsert', link, projectPath))
      return Boolean(result?.success)
    },

    savePortal: async (portal, projectPath) => {
      const result = await write(projectPath, '保存世界通道失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-portal-upsert', {
          id: portal.id ?? newPortalId(),
          name: portal.name,
          type: portal.type ?? 'teleport',
          customTypeLabel: portal.customTypeLabel ?? '',
          fromWorldId: portal.fromWorldId,
          toWorldId: portal.toWorldId,
          fromNodeId: portal.fromNodeId ?? null,
          toNodeId: portal.toNodeId ?? null,
          bidirectional: portal.bidirectional !== false,
          condition: portal.condition ?? '',
          cost: portal.cost ?? '',
          scheduleNote: portal.scheduleNote ?? '',
          status: portal.status ?? 'active',
          customStatusLabel: portal.customStatusLabel ?? '',
          description: portal.description ?? '',
          notes: portal.notes ?? '',
          createdAt: portal.createdAt,
        } as WorldPortal, projectPath))
      return (result as { portal?: WorldPortal } | null)?.portal ?? null
    },

    deletePortal: async (portalId, detachEventLinks, projectPath) => {
      const result = await write(projectPath, '删除世界通道失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-portal-delete', portalId, detachEventLinks, projectPath))
      return Boolean(result?.success)
    },

    savePortalFaction: async (link, projectPath) => {
      const result = await write(projectPath, '保存通道势力关联失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-portal-faction-upsert', link, projectPath))
      return Boolean(result?.success)
    },

    savePortalCharacter: async (link, projectPath) => {
      const result = await write(projectPath, '保存通道人物关联失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-portal-character-upsert', link, projectPath))
      return Boolean(result?.success)
    },

    saveRule: async (rule, projectPath) => {
      const result = await write(projectPath, '保存世界规则失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-rule-upsert', {
          id: rule.id ?? newRuleId(),
          worldId: rule.worldId,
          name: rule.name,
          category: rule.category ?? 'custom',
          customCategoryLabel: rule.customCategoryLabel ?? '',
          content: rule.content ?? '',
          scopeNote: rule.scopeNote ?? '',
          restriction: rule.restriction ?? '',
          consequence: rule.consequence ?? '',
          notes: rule.notes ?? '',
          sourceKind: rule.sourceKind ?? 'author',
          sourceRefId: rule.sourceRefId ?? '',
          sourceStatus: rule.sourceStatus ?? '',
          createdAt: rule.createdAt,
        } as WorldRule, projectPath))
      return (result as { rule?: WorldRule } | null)?.rule ?? null
    },

    deleteRule: async (ruleId, detachEventLinks, projectPath) => {
      const result = await write(projectPath, '删除世界规则失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-rule-delete', ruleId, detachEventLinks, projectPath))
      return Boolean(result?.success)
    },

    saveRuleTarget: async (target, projectPath) => {
      const result = await write(projectPath, '保存规则适用范围失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-rule-target-upsert', {
          id: target.id ?? `wrltgt-${crypto.randomUUID()}`,
          ruleId: target.ruleId,
          role: target.role,
          targetKind: target.targetKind,
          targetId: target.targetId,
          note: target.note ?? '',
        } as WorldRuleTarget, projectPath))
      return Boolean(result?.success)
    },

    saveCharacterLink: async (link, projectPath) => {
      const result = await write(projectPath, '保存世界人物关联失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-character-link-upsert', link, projectPath))
      return Boolean(result?.success)
    },

    saveBirthLocation: async (location, projectPath) => {
      const result = await write(projectPath, '保存出生地失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-character-location-birth-save', location, projectPath))
      return Boolean(result?.success)
    },

    commitCurrentLocation: async (characterId, worldId, nodeId, options, projectPath) => {
      const session = sessionFor(projectPath)
      if (!session) return { ok: false, error: '当前项目会话已失效，已拒绝写入' }
      try {
        const result = await ipc.invokeWithProjectSession(
          session, 'db:world-character-current-location-commit',
          characterId, worldId, nodeId, options, projectPath,
        )
        if (!result?.success) {
          const message = result?.error || '设置目前所在地失败'
          toast.error(message)
          return { ok: false, error: message }
        }
        if (!isProjectSessionCurrent(session)) return { ok: true, locationText: result.locationText }
        await get().loadAll(projectPath)
        return { ok: true, locationText: result.locationText }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error(message)
        return { ok: false, error: message }
      }
    },

    clearCurrentLocation: async (characterId, projectPath) => {
      const result = await write(projectPath, '解除目前所在地失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-character-current-location-clear', characterId, projectPath))
      return Boolean(result?.success)
    },

    commitTrail: async (request, projectPath) => {
      const result = await write(projectPath, '保存人物行踪失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-trail-commit', request, projectPath))
      return Boolean(result?.success)
    },

    planTrailDelete: async (trailId, projectPath) => {
      const session = sessionFor(projectPath)
      if (!session) return null
      try {
        const result = await ipc.invokeWithProjectSession(session, 'db:world-trail-delete-plan', trailId, projectPath)
        return result?.plan ?? null
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
        return null
      }
    },

    deleteTrail: async (trailId, releaseCurrentLocation, projectPath) => {
      const result = await write(projectPath, '删除人物行踪失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-trail-delete', trailId, releaseCurrentLocation, projectPath))
      return Boolean(result?.success)
    },

    saveEventLinks: async (eventId, worldIds, links, projectPath) => {
      const result = await write(projectPath, '保存历史事件关联失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-event-links-save', eventId, worldIds, links, projectPath))
      return Boolean(result?.success)
    },

    deleteRelation: async (table, id, projectPath) => {
      const result = await write(projectPath, '解除关联失败', session =>
        ipc.invokeWithProjectSession(session, 'db:world-relation-delete', table, id, projectPath))
      return Boolean(result?.success)
    },

    planDeleteFor: async (kind, entityId) => {
      const projectPath = useProjectStore.getState().currentProject?.path
      if (!projectPath) return null
      const session = sessionFor(projectPath)
      if (!session) return null
      try {
        const result = await deletePlanChannel(kind)(session, entityId, projectPath)
        return result?.plan ?? null
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
        return null
      }
    },

    deleteFor: async (kind, entityId, options, projectPath) => {
      const result = await write(projectPath, '删除失败', session => deleteChannel(kind, options)(session, entityId, projectPath))
      return Boolean(result?.success)
    },

    loadCharacterLinks: async (projectPath) => {
      await get().loadAll(projectPath)
    },
  }
})

/**
 * 各实体类型的删除预览 / 删除通道。写成映射而不是一长串 if，
 * 是为了让新增实体类型时只补一处，且类型上不会漏掉分支。
 */
const DELETE_PLAN_CHANNEL = {
  world: 'db:world-delete-plan',
  faction: 'db:world-faction-delete-plan',
  relic: 'db:world-relic-delete-plan',
  portal: 'db:world-portal-delete-plan',
  rule: 'db:world-rule-delete-plan',
  trail: 'db:world-trail-delete-plan',
} as const satisfies Partial<Record<WorldEntityKind, string>>

export function deletePlanChannel(kind: WorldEntityKind) {
  const channel = DELETE_PLAN_CHANNEL[kind as keyof typeof DELETE_PLAN_CHANNEL]
  if (!channel) throw new Error('该实体类型不支持删除影响预览')
  return (session: ProjectSessionContext, entityId: string, projectPath: string) =>
    ipc.invokeWithProjectSession(session, channel, entityId, projectPath)
}

export function deleteChannel(
  kind: WorldEntityKind,
  options: { detachEventLinks?: boolean; releaseCurrentLocation?: boolean },
) {
  return (session: ProjectSessionContext, entityId: string, projectPath: string) => {
    switch (kind) {
      case 'world':
        return ipc.invokeWithProjectSession(session, 'db:world-delete', entityId, projectPath)
      case 'faction':
        return ipc.invokeWithProjectSession(session, 'db:world-faction-delete', entityId, options.detachEventLinks ?? false, projectPath)
      case 'relic':
        return ipc.invokeWithProjectSession(session, 'db:world-relic-delete', entityId, projectPath)
      case 'portal':
        return ipc.invokeWithProjectSession(session, 'db:world-portal-delete', entityId, options.detachEventLinks ?? false, projectPath)
      case 'rule':
        return ipc.invokeWithProjectSession(session, 'db:world-rule-delete', entityId, options.detachEventLinks ?? false, projectPath)
      case 'trail':
        return ipc.invokeWithProjectSession(session, 'db:world-trail-delete', entityId, options.releaseCurrentLocation ?? false, projectPath)
      default:
        throw new Error('该实体类型不支持删除')
    }
  }
}

// ============================================================
// 读选择器（纯函数，界面与测试共用）
// ============================================================

/** 世界内的势力：只显示本世界势力。 */
export function factionsOfWorld(data: WorldWorkbenchSnapshot, worldId: string | null) {
  if (!worldId) return []
  return data.factions.filter(faction => faction.worldId === worldId)
}

export function relicsOfWorld(data: WorldWorkbenchSnapshot, worldId: string | null) {
  if (!worldId) return []
  return data.relics.filter(relic => relic.worldId === worldId)
}

export function rulesOfWorld(data: WorldWorkbenchSnapshot, worldId: string | null) {
  if (!worldId) return []
  return data.rules.filter(rule => rule.worldId === worldId)
}

/** 两个端点世界都能看到同一个通道，因此这里不是「复制两份」而是查询同一行的两端。 */
export function portalsOfWorld(data: WorldWorkbenchSnapshot, worldId: string | null) {
  if (!worldId) return []
  return data.portals.filter(portal => portal.fromWorldId === worldId || portal.toWorldId === worldId)
}

export function trailsOfWorld(data: WorldWorkbenchSnapshot, worldId: string | null) {
  if (!worldId) return []
  return data.trails.filter(trail => trail.worldId === worldId)
}

export function mapsOfWorld(data: WorldWorkbenchSnapshot, worldId: string | null): string[] {
  if (!worldId) return []
  return data.mapWorldLinks.filter(link => link.worldId === worldId).map(link => link.mapId)
}

/**
 * 世界人物页的成员来源：显式关联 + 出生地/目前所在地落在本世界。
 * locationKind 标明来源差别，界面必须区别展示。
 */
export interface WorldMemberEntry {
  characterId: string
  relation: string
  note: string
  linkId: string | null
  /** 该人物以哪些位置事实出现在本世界。 */
  viaBirth: boolean
  viaCurrent: boolean
}

export function membersOfWorld(data: WorldWorkbenchSnapshot, worldId: string | null): WorldMemberEntry[] {
  if (!worldId) return []
  const byCharacter = new Map<string, WorldMemberEntry>()
  const ensure = (characterId: string): WorldMemberEntry => {
    const existing = byCharacter.get(characterId)
    if (existing) return existing
    const created: WorldMemberEntry = {
      characterId, relation: '', note: '', linkId: null, viaBirth: false, viaCurrent: false,
    }
    byCharacter.set(characterId, created)
    return created
  }
  for (const link of data.characterLinks) {
    if (link.worldId !== worldId) continue
    const entry = ensure(link.characterId)
    entry.relation = link.relation
    entry.note = link.note
    entry.linkId = link.id
  }
  for (const view of data.characterLocationViews) {
    if (view.birth?.worldId === worldId) ensure(view.characterId).viaBirth = true
    // 只有仍然有效的结构化目前所在地才算「目前所在」，失效绑定不再冒充当前事实。
    if (view.current?.worldId === worldId && view.currentState === 'bound') ensure(view.characterId).viaCurrent = true
  }
  return [...byCharacter.values()]
}

/** 地图地点上的行踪与人物：地图页据此显示「谁在此处」。 */
export function trailsOfNode(data: WorldWorkbenchSnapshot, nodeId: string | null) {
  if (!nodeId) return []
  return data.trails.filter(trail => trail.nodeId === nodeId)
}

export function relicsOfNode(data: WorldWorkbenchSnapshot, nodeId: string | null) {
  if (!nodeId) return []
  return data.relics.filter(relic => relic.nodeId === nodeId || relic.entranceNodeId === nodeId)
}

export function factionsOfNode(data: WorldWorkbenchSnapshot, nodeId: string | null) {
  if (!nodeId) return []
  const factionIds = new Set(data.factionPlaces.filter(place => place.nodeId === nodeId).map(place => place.factionId))
  return data.factions.filter(faction => factionIds.has(faction.id))
}
