import { afterEach, describe, expect, it } from 'vitest'
import {
  buildRelationshipGraphModel,
  readRelationshipGraphPositions,
  relationshipGraphLayoutStorageKey,
  relationshipGraphNodeId,
  writeRelationshipGraphPositions,
} from '../relationship-graph-model'

const PROJECT_KEY = 'C:\\fiction\\relationship-graph'

afterEach(() => {
  window.localStorage.clear()
})

describe('RelationshipGraph directed relationship model', () => {
  it('keeps reciprocal and parallel relationships as separate directed graph edges', () => {
    const model = buildRelationshipGraphModel([
      {
        name: '林墨',
        role: 'protagonist',
        relationships: JSON.stringify([
          { target: '周砧', relation: '共同追查' },
          { target: '周砧', relation: '互相信任' },
        ]),
      },
      {
        name: '周砧',
        role: 'supporting',
        relationships: JSON.stringify([{ target: '林墨', relation: '仍然怀疑' }]),
      },
    ])

    expect(model.nodes).toHaveLength(2)
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: '林墨', targetName: '周砧', label: '共同追查' }),
      expect.objectContaining({ sourceName: '林墨', targetName: '周砧', label: '互相信任' }),
      expect.objectContaining({ sourceName: '周砧', targetName: '林墨', label: '仍然怀疑' }),
    ]))
    expect(new Set(model.edges.map(edge => edge.id)).size).toBe(3)
    expect(new Set(model.edges.map(edge => edge.lane)).size).toBeGreaterThan(1)
  })

  it('does not invent dangling graph nodes from an unrecognised relationship target', () => {
    const model = buildRelationshipGraphModel([
      {
        name: '林墨',
        role: 'protagonist',
        relationships: '周砧：盟友；不存在的人：敌对',
      },
      { name: '周砧', role: 'supporting', relationships: '' },
    ])

    expect(model.nodes.map(node => node.name)).toEqual(['林墨', '周砧'])
    expect(model.edges).toEqual([
      expect.objectContaining({ sourceName: '林墨', targetName: '周砧', label: '盟友', tone: 'alliance' }),
    ])
  })

  it('uses stable character IDs and keeps a saved local layout separate from roster facts', () => {
    const aliceId = relationshipGraphNodeId('林墨')
    const bobId = relationshipGraphNodeId('周砧')
    writeRelationshipGraphPositions(PROJECT_KEY, {
      [aliceId]: { x: 420, y: -35 },
      [bobId]: { x: -280, y: 180 },
    })

    expect(window.localStorage.getItem(relationshipGraphLayoutStorageKey(PROJECT_KEY))).toBeTruthy()
    expect(readRelationshipGraphPositions(PROJECT_KEY)).toEqual({
      [aliceId]: { x: 420, y: -35 },
      [bobId]: { x: -280, y: 180 },
    })

    const model = buildRelationshipGraphModel([
      { name: '林墨', role: 'protagonist', relationships: '' },
      { name: '周砧', role: 'supporting', relationships: '' },
    ], readRelationshipGraphPositions(PROJECT_KEY))
    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: aliceId, position: { x: 420, y: -35 } }),
      expect.objectContaining({ id: bobId, position: { x: -280, y: 180 } }),
    ]))
  })

  it('falls back safely when the local presentation cache is corrupt', () => {
    window.localStorage.setItem(relationshipGraphLayoutStorageKey(PROJECT_KEY), '{not valid JSON')
    expect(readRelationshipGraphPositions(PROJECT_KEY)).toEqual({})
  })
})
