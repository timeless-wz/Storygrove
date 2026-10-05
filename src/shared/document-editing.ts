import { normalizeProjectDocumentPath } from './project-documents'

export interface ProjectDocumentIdentityInput {
  projectId: string
  documentPath: string
}

export interface BusinessFieldDocumentIdentityInput {
  projectId: string
  entityType: string
  entityId: string
  fieldId: string
}

function encodeIdentitySegment(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required to identify an editing document`)
  return encodeURIComponent(value)
}

/** Stable identity for a Markdown file in a project's controlled document area. */
export function createProjectDocumentIdentity({ projectId, documentPath }: ProjectDocumentIdentityInput): string {
  const normalizedPath = normalizeProjectDocumentPath(documentPath)
  if (!normalizedPath) throw new Error('A valid project-relative document path is required')

  const encodedPath = normalizedPath.split('/').map(segment => encodeIdentitySegment(segment, 'Document path')).join('/')
  return `project/${encodeIdentitySegment(projectId, 'Project ID')}/document/${encodedPath}`
}

/** Stable identity for one editable Markdown field on a project entity. */
export function createBusinessFieldDocumentIdentity({
  projectId,
  entityType,
  entityId,
  fieldId,
}: BusinessFieldDocumentIdentityInput): string {
  return [
    'project', encodeIdentitySegment(projectId, 'Project ID'),
    'entity', encodeIdentitySegment(entityType, 'Entity type'), encodeIdentitySegment(entityId, 'Entity ID'),
    'field', encodeIdentitySegment(fieldId, 'Field ID'),
  ].join('/')
}
