import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { WorldMapRepository } from '../world-map-repository'

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/world-map-layers-repository-tests')

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
})

afterEach(() => {
  closeProjectDatabase()
  // Electron ABI verification on Windows can retain WAL handles until process exit.
  // These directories are regenerable .runtime test cache only.
})

describe('WorldMapRepository project layers', () => {
  it('materializes legacy layers as editable project data', () => {
    const layers = WorldMapRepository.getAll().layers
    expect(layers.map(layer => layer.id)).toEqual(['surface', 'underground', 'astral'])
    expect(layers.map(layer => layer.name)).toEqual(['主世界', '里世界', '星界'])

    WorldMapRepository.upsertLayer({ ...layers[0], name: '人间界' })
    expect(WorldMapRepository.getAll().layers.find(layer => layer.id === 'surface')?.name).toBe('人间界')
  })

  it('allows author-created layers, ordering, and safe deletion with node migration', () => {
    WorldMapRepository.getAll()
    WorldMapRepository.upsertLayer({ id: 'dream', name: '梦境层', sortOrder: 4 })
    WorldMapRepository.upsertNode({
      id: 'dream-gate',
      name: '月眠门',
      type: 'landmark',
      description: '',
      parentId: null,
      mapLayer: 'dream',
      x: 10,
      y: 10,
      sourceRefs: [],
    })

    WorldMapRepository.reorderLayers(['dream', 'surface', 'underground', 'astral'])
    expect(WorldMapRepository.getAll().layers[0].id).toBe('dream')

    WorldMapRepository.deleteLayer('dream', 'surface')
    const snapshot = WorldMapRepository.getAll()
    expect(snapshot.layers.some(layer => layer.id === 'dream')).toBe(false)
    expect(snapshot.nodes.find(node => node.id === 'dream-gate')?.mapLayer).toBe('surface')
  })
})
