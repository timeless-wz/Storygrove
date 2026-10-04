/**
 * applyOutlineSyncPatchItems 纯函数测试（knowledge-action-outline-sync-contract §5）。
 * 覆盖验收矩阵 8/9：快照过期不应用、只动被点名的条目、未接受条目不参与。
 */

import { describe, expect, it } from 'vitest'
import {
  applyOutlineSyncPatchItems,
  buildOutlineSyncIdMap,
} from '../outline-sync'
import { buildBlueprintV2MigrationContent, findBlueprintV2CanonicalSection, getBlueprintV2Scenes } from '../blueprint-v2'
import type { OutlineSyncPatchItem } from '../outline-sync'

function makeContent() {
  const content = buildBlueprintV2MigrationContent({
    chapterNumber: 1,
    title: '接错的人',
    purpose: '让周晓误判身份',
    keyEvents: '事件一\n事件二',
    suspenseHook: '末班车开出地图',
  }, { origin: 'manual' })
  // 逐场分镜区手工加两个分镜，模拟已细化的细纲。
  const storyboard = findBlueprintV2CanonicalSection(content, 'storyboard')!
  storyboard.items = [
    { kind: 'scene', id: 'bps-scene-1', level: 5, title: '场景一：冷汗', markdown: '周晓在隔离席上惊醒。\n', presence: 'off-canvas' },
    { kind: 'scene', id: 'bps-scene-2', level: 5, title: '场景二：审讯', markdown: '许渡出示物证。\n', presence: 'off-canvas' },
  ]
  return content
}

function item(partial: Partial<OutlineSyncPatchItem> & { id: string; op: OutlineSyncPatchItem['op'] }): OutlineSyncPatchItem {
  return {
    changeKind: 'scene-content',
    explanation: 'test',
    proseEvidence: 'test',
    status: 'pending',
    ...partial,
  } as OutlineSyncPatchItem
}

describe('applyOutlineSyncPatchItems', () => {
  it('replace-item：只替换目标分镜的 markdown，其余条目原文保真', () => {
    const content = makeContent()
    const result = applyOutlineSyncPatchItems(content, [
      item({ id: 'osi-1', op: { kind: 'replace-item', sectionId: 'storyboard', itemId: 'bps-scene-1', beforeMarkdown: '周晓在隔离席上惊醒。\n', afterMarkdown: '周晓在冷汗中核对时间戳：02:14。\n' } }),
    ], ['osi-1'])
    expect(result.appliedItemIds).toEqual(['osi-1'])
    expect(result.skipped).toHaveLength(0)
    const scenes = getBlueprintV2Scenes(result.content)
    expect(scenes[0]!.markdown).toBe('周晓在冷汗中核对时间戳：02:14。\n')
    expect(scenes[1]!.markdown).toBe('许渡出示物证。\n')
    // 未涉及的 conflict 分区逐字保真。
    const conflict = findBlueprintV2CanonicalSection(result.content, 'conflict')!
    const original = findBlueprintV2CanonicalSection(content, 'conflict')!
    expect(conflict.items.map(entry => entry.markdown)).toEqual(original.items.map(entry => entry.markdown))
  })

  it('beforeMarkdown 与当前内容不一致 → 该条目被跳过，内容不变', () => {
    const content = makeContent()
    const result = applyOutlineSyncPatchItems(content, [
      item({ id: 'osi-2', op: { kind: 'replace-item', sectionId: 'storyboard', itemId: 'bps-scene-1', beforeMarkdown: '过期快照', afterMarkdown: 'x' } }),
    ], ['osi-2'])
    expect(result.appliedItemIds).toHaveLength(0)
    expect(result.skipped[0]!.itemId).toBe('osi-2')
    expect(getBlueprintV2Scenes(result.content)[0]!.markdown).toBe('周晓在隔离席上惊醒。\n')
  })

  it('remove-item / add-scene / reorder-scenes 各自生效且 ID 分配唯一', () => {
    const content = makeContent()
    const result = applyOutlineSyncPatchItems(content, [
      item({ id: 'osi-3', changeKind: 'scene-omitted', op: { kind: 'remove-item', sectionId: 'storyboard', itemId: 'bps-scene-2', beforeMarkdown: '许渡出示物证。\n' } }),
      item({ id: 'osi-4', changeKind: 'scene-added', op: { kind: 'add-scene', afterSceneId: 'bps-scene-1', title: '场景三：末班车', markdown: '车灯扫过站台。\n' } }),
    ], ['osi-3', 'osi-4'])
    expect(result.appliedItemIds).toEqual(['osi-3', 'osi-4'])
    const scenes = getBlueprintV2Scenes(result.content)
    expect(scenes.map(scene => scene.title)).toEqual(['场景一：冷汗', '场景三：末班车'])
    expect(scenes[1]!.sceneId).toMatch(/^bps-/)
    expect(scenes[1]!.sceneId).not.toBe('bps-scene-1')

    const reorder = applyOutlineSyncPatchItems(result.content, [
      item({ id: 'osi-5', changeKind: 'scene-order', op: { kind: 'reorder-scenes', orderedSceneIds: [scenes[1]!.sceneId, scenes[0]!.sceneId] } }),
    ], ['osi-5'])
    expect(getBlueprintV2Scenes(reorder.content).map(scene => scene.title)).toEqual(['场景三：末班车', '场景一：冷汗'])
  })

  it('reorder-scenes 引用不存在的分镜 → 跳过', () => {
    const content = makeContent()
    const result = applyOutlineSyncPatchItems(content, [
      item({ id: 'osi-6', changeKind: 'scene-order', op: { kind: 'reorder-scenes', orderedSceneIds: ['bps-ghost', 'bps-scene-1'] } }),
    ], ['osi-6'])
    expect(result.skipped).toHaveLength(1)
    expect(getBlueprintV2Scenes(result.content).map(scene => scene.sceneId)).toEqual(['bps-scene-1', 'bps-scene-2'])
  })

  it('未接受的条目不参与应用', () => {
    const content = makeContent()
    const result = applyOutlineSyncPatchItems(content, [
      item({ id: 'osi-7', op: { kind: 'replace-item', sectionId: 'storyboard', itemId: 'bps-scene-1', beforeMarkdown: '周晓在隔离席上惊醒。\n', afterMarkdown: '被拒绝的改动\n' } }),
    ], []) // 作者全部拒绝
    expect(result.appliedItemIds).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
    expect(getBlueprintV2Scenes(result.content)[0]!.markdown).toBe('周晓在隔离席上惊醒。\n')
  })

  it('ID 清单覆盖全部条目并携带当前 markdown', () => {
    const content = makeContent()
    const idMap = buildOutlineSyncIdMap(content)
    const storyboard = idMap.find(section => section.sectionId === 'storyboard')!
    expect(storyboard.items.map(entry => entry.id)).toEqual(['bps-scene-1', 'bps-scene-2'])
    expect(storyboard.items[0]!.markdown).toBe('周晓在隔离席上惊醒。\n')
  })
})
