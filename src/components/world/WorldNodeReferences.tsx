/**
 * 地图地点上的世界资料视图。
 *
 * 在地图里选中一个地点时，作者可以直接看到它被哪些世界资料引用
 * （秘境位置/入口、势力驻地、人物出生地与目前所在地、行踪、通道端点、
 * 规则范围），并跳转到对应的世界分区。这里只读取既有事实，不复制一份。
 */
import { MapPin } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorldWorkbenchStore, type WorldSectionKey } from '../../stores/world-workbench-store'
import { Button } from '../ui/Button'
import { openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'

interface Reference {
  key: string
  label: string
  section: WorldSectionKey
  worldId: string | null
}

export default function WorldNodeReferences({ nodeId }: { nodeId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const loadAll = useWorldWorkbenchStore(s => s.loadAll)
  const setSelectedWorldId = useWorldWorkbenchStore(s => s.setSelectedWorldId)
  const setSection = useWorldWorkbenchStore(s => s.setSection)
  const loadedProjectKey = useWorldWorkbenchStore(s => s.loadedProjectKey)
  const projectPath = useProjectStore(s => s.currentProject?.path)

  // 地图册不必先打开世界页：这里按需拉取一次世界资料，读的是同一份事实。
  useEffect(() => {
    if (!projectPath || loadedProjectKey === projectPath) return
    void loadAll(projectPath)
  }, [projectPath, loadedProjectKey, loadAll])

  const references = useMemo<Reference[]>(() => {
    const found: Reference[] = []
    for (const relic of data.relics) {
      if (relic.nodeId === nodeId) {
        found.push({ key: `relic-${relic.id}`, label: text(`秘境位置「${relic.name}」`, `Relic place “${relic.name}”`), section: 'relics', worldId: relic.worldId })
      } else if (relic.entranceNodeId === nodeId) {
        found.push({ key: `relic-entry-${relic.id}`, label: text(`秘境入口「${relic.name}」`, `Relic entrance “${relic.name}”`), section: 'relics', worldId: relic.worldId })
      }
    }
    for (const place of data.factionPlaces) {
      if (place.nodeId !== nodeId) continue
      const faction = data.factions.find(item => item.id === place.factionId)
      found.push({
        key: `place-${place.id}`,
        label: text(`势力驻地「${faction?.name ?? place.factionId}」`, `Faction seat “${faction?.name ?? place.factionId}”`),
        section: 'factions',
        worldId: faction?.worldId ?? null,
      })
    }
    for (const location of data.characterLocations) {
      if (location.nodeId !== nodeId) continue
      const name = data.characterRefs.find(ref => ref.id === location.characterId)?.name ?? location.characterId
      found.push({
        key: `location-${location.id}`,
        label: location.kind === 'birth'
          ? text(`${name} 的出生地`, `${name}’s birth place`)
          : text(`${name} 的目前所在地`, `${name}’s current location`),
        section: 'characters',
        worldId: location.worldId,
      })
    }
    for (const trail of data.trails) {
      if (trail.nodeId !== nodeId) continue
      const name = data.characterRefs.find(ref => ref.id === trail.characterId)?.name ?? trail.characterId
      found.push({ key: `trail-${trail.id}`, label: text(`${name} 的行踪（${trail.arrivedLabel || '未设定时间'}）`, `${name}’s trail (${trail.arrivedLabel || 'no time'})`), section: 'trails', worldId: trail.worldId })
    }
    for (const portal of data.portals) {
      if (portal.fromNodeId !== nodeId && portal.toNodeId !== nodeId) continue
      const other = portal.fromNodeId === nodeId ? portal.toWorldId : portal.fromWorldId
      const otherName = data.worlds.find(world => world.id === other)?.name ?? other
      found.push({
        key: `portal-${portal.id}`,
        label: text(`世界通道「${portal.name}」→ ${otherName}`, `Portal “${portal.name}” → ${otherName}`),
        section: 'portals',
        worldId: portal.fromNodeId === nodeId ? portal.fromWorldId : portal.toWorldId,
      })
    }
    for (const target of data.ruleTargets) {
      if (target.targetKind !== 'node' || target.targetId !== nodeId) continue
      const rule = data.rules.find(item => item.id === target.ruleId)
      found.push({
        key: `rule-${target.id}`,
        label: target.role === 'exception'
          ? text(`规则例外「${rule?.name ?? target.ruleId}」`, `Rule exception “${rule?.name ?? target.ruleId}”`)
          : text(`规则适用范围「${rule?.name ?? target.ruleId}」`, `Rule scope “${rule?.name ?? target.ruleId}”`),
        section: 'rules',
        worldId: rule?.worldId ?? null,
      })
    }
    return found
  }, [data, nodeId, text])

  if (references.length === 0) {
    return (
      <div className="shrink-0 border-t border-[var(--color-border)] pt-2" data-testid="world-node-references">
        <p className="text-[11px] text-[var(--color-text-muted)]">
          <MapPin size={11} className="inline" />
          {text('这个世界资料里还没有引用这个地点的地方。', 'No world record references this place yet.')}
        </p>
      </div>
    )
  }

  return (
    <div className="shrink-0 space-y-1 border-t border-[var(--color-border)] pt-2" data-testid="world-node-references">
      <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">
        {text('关联的世界资料', 'Referenced by world records')}
      </p>
      <ul className="space-y-1">
        {references.map(reference => (
          <li key={reference.key} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-[var(--color-text-muted)]">{reference.label}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                // 跳到那个世界的对应分区：目标视图与来源视图读同一份关系。
                if (reference.worldId) setSelectedWorldId(reference.worldId)
                setSection(reference.section)
                openBuiltinEditor('world-workbench', text('世界管理', 'World management'), 'world')
              }}
            >
              {text('查看', 'Open')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
