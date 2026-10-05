import { describe, expect, it } from 'vitest'

import { createBusinessFieldDocumentIdentity, createProjectDocumentIdentity } from '../document-editing'

describe('document editing identities', () => {
  it('includes the project and normalized relative path for project documents', () => {
    const windowsPath = createProjectDocumentIdentity({
      projectId: 'project/a',
      documentPath: ' notes\\chapter 1.md ',
    })
    expect(windowsPath).toBe('project/project%2Fa/document/notes/chapter%201.md')
    expect(windowsPath).toBe(createProjectDocumentIdentity({
      projectId: 'project/a',
      documentPath: 'notes/chapter 1.md',
    }))
  })

  it('separates project, entity, and field identities while encoding each segment', () => {
    const premise = createBusinessFieldDocumentIdentity({
      projectId: 'project/a',
      entityType: 'architecture-file',
      entityId: 'vela://core/premise',
      fieldId: 'markdown',
    })
    const world = createBusinessFieldDocumentIdentity({
      projectId: 'project/a',
      entityType: 'architecture-file',
      entityId: 'vela://core/worldbuilding',
      fieldId: 'markdown',
    })
    const otherProject = createBusinessFieldDocumentIdentity({
      projectId: 'project/b',
      entityType: 'architecture-file',
      entityId: 'vela://core/premise',
      fieldId: 'markdown',
    })

    expect(premise).not.toBe(world)
    expect(premise).not.toBe(otherProject)
    expect(premise).toBe('project/project%2Fa/entity/architecture-file/vela%3A%2F%2Fcore%2Fpremise/field/markdown')
  })

  it('requires a stable value for each identity segment', () => {
    expect(() => createBusinessFieldDocumentIdentity({
      projectId: 'project/a', entityType: 'architecture-file', entityId: ' ', fieldId: 'markdown',
    })).toThrow('Entity ID is required')
  })
})
