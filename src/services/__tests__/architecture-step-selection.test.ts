import { describe, expect, it } from 'vitest'
import {
  createDefaultArchitectureSelection,
  getArchitecturePrerequisites,
  getMissingArchitecturePrerequisites,
  getRequiredArchitectureSteps,
  includeMissingArchitecturePrerequisites,
  type ArchStepKey,
} from '../architecture-step-selection'

const emptyStatus = {
  premise: false,
  characters: false,
  worldbuilding: false,
  synopsis: false,
}

describe('architecture launch selection contract', () => {
  it('starts batch mode empty regardless of content status', () => {
    expect(createDefaultArchitectureSelection({ kind: 'batch' }))
      .toEqual({ premise: false, characters: false, worldbuilding: false, synopsis: false })
  })

  it.each<ArchStepKey>(['premise', 'characters', 'worldbuilding', 'synopsis'])(
    'preselects only the requested single step: %s',
    step => {
      const selection = createDefaultArchitectureSelection({ kind: 'single', step })
      expect(Object.keys(selection).filter(key => selection[key as ArchStepKey])).toEqual([step])
    },
  )

  it.each(['worldbuilding', 'synopsis'] as const)(
    'pins resume mode to its one checkpoint step: %s',
    step => {
      const selection = createDefaultArchitectureSelection({ kind: 'resume', step })
      expect(Object.keys(selection).filter(key => selection[key as ArchStepKey])).toEqual([step])
    },
  )

  it('matches command source requirements instead of assuming character data is a worldbuilding prerequisite', () => {
    expect(getArchitecturePrerequisites('worldbuilding')).toEqual(['premise'])
    expect(getArchitecturePrerequisites('synopsis')).toEqual(['premise', 'characters', 'worldbuilding'])
    expect(getRequiredArchitectureSteps(['synopsis'])).toEqual(['premise', 'characters', 'worldbuilding'])
  })

  it('reports missing prerequisites without adding them to the selection', () => {
    expect(getMissingArchitecturePrerequisites(['worldbuilding'], emptyStatus)).toEqual(['premise'])
    expect(getMissingArchitecturePrerequisites(['synopsis'], emptyStatus)).toEqual(['premise', 'characters', 'worldbuilding'])
    expect(getMissingArchitecturePrerequisites(['premise', 'synopsis'], emptyStatus)).toEqual(['characters', 'worldbuilding'])
  })

  it('adds missing prerequisites only when explicitly requested and in workflow order', () => {
    expect(includeMissingArchitecturePrerequisites(['synopsis'], emptyStatus)).toEqual([
      'premise', 'characters', 'worldbuilding', 'synopsis',
    ])
    expect(includeMissingArchitecturePrerequisites(['worldbuilding'], { ...emptyStatus, premise: true }))
      .toEqual(['worldbuilding'])
  })

  it('treats manually supplied prerequisite status as authoritative regardless of content origin', () => {
    const handWrittenPremise = { ...emptyStatus, premise: true }
    expect(getMissingArchitecturePrerequisites(['worldbuilding'], handWrittenPremise)).toEqual([])
  })
})
