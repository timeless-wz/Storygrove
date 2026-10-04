/**
 * 世界资料与其它模块之间的真实跳转。
 *
 * 所有跳转都落到既有编辑器上：地图册、角色管理、故事时间线。
 * 地图跳转会把目标地图与目标地点同时设为当前选中，因此打开的是那一层空间
 * 的图上位置，而不是地图首页。
 */
import { useEditorStore } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useLocaleStore } from '../../stores/locale-store'
import { openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'

function projectKey(): string | undefined {
  return useProjectStore.getState().currentProject?.path
}

/** 打开地图册，并选中指定地图；mapId 为 null 时只打开地图册。 */
export function openMapAt(mapId: string | null, nodeId: string | null = null): void {
  if (mapId) {
    // 先切地图再选地点：切换地图会清空地点选择，顺序反过来会丢掉目标地点。
    useWorldMapStore.getState().setSelectedMapId(mapId)
    useWorldMapStore.setState({ selectedNodeId: nodeId })
    useWorldMapStore.setState({ focusNodeRequest: nodeId ? { nodeId, mapId, token: Date.now() } : null })
  }
  openBuiltinEditor('world-map-editor', useLocaleStore.getState().text('地图册', 'Map atlas'), 'world-map')
}

/** 打开角色管理；角色资料始终只有一份项目角色事实。 */
export function openCharacterEditor(): void {
  openBuiltinEditor('character-editor', '角色管理', 'character')
}

/** 打开故事时间线。 */
export function openStoryTimeline(): void {
  openBuiltinEditor('story-timeline-editor', '故事时间线', 'story-timeline')
}

/** 当前是否已经打开了某个类型的编辑器页签。 */
export function hasOpenEditor(type: 'world-map' | 'character' | 'story-timeline' | 'world'): boolean {
  return useEditorStore.getState().tabs.some(tab => tab.type === type)
}

export { projectKey }
