import { computeBlueprintV2TextHash } from './blueprint-v2'

/** Shared contracts for the book -> volume -> chapter planning hierarchy. */

export type BlueprintPlanningSelection =
  | { kind: 'book' }
  | { kind: 'volume'; volumeId: string }
  | { kind: 'chapter'; chapterNumber: number }

export type BlueprintPlanningTargetKind = BlueprintPlanningSelection['kind']

/** Canonical JSON and SHA-256 helpers shared by render and main processes. */
export function stableBlueprintPlanningJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableBlueprintPlanningJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableBlueprintPlanningJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function blueprintPlanningTextHash(value: string): string {
  return computeBlueprintV2TextHash(value)
}

export function blueprintPlanningChapterSummaryHash(summary: { title: string; purpose: string; keyEvents: string }): string {
  return blueprintPlanningTextHash(stableBlueprintPlanningJson(summary))
}

export function blueprintPlanningChapterVolumeHash(volumeId: string): string {
  return blueprintPlanningTextHash(volumeId)
}

export function blueprintPlanningVolumeMetadataHash(volume: { id: string; name: string; sortOrder: number }): string {
  return blueprintPlanningTextHash(stableBlueprintPlanningJson(volume))
}

export function blueprintPlanningVolumeDirectoryHash(volumes: Array<{ id: string; name: string; sortOrder: number }>): string {
  const sorted = [...volumes].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
  return blueprintPlanningTextHash(stableBlueprintPlanningJson(sorted))
}

export const blueprintPlanningVolumeIndexHash = blueprintPlanningVolumeDirectoryHash

export function blueprintPlanningChapterIndexHash(chapters: Array<{
  chapterNumber: number
  title: string
  purpose: string
  keyEvents: string
  volumeId: string
}>): string {
  const sorted = [...chapters].sort((left, right) => left.chapterNumber - right.chapterNumber)
  return blueprintPlanningTextHash(stableBlueprintPlanningJson(sorted))
}

export type BlueprintPlanningErrorCode =
  | 'REVISION_CONFLICT'
  | 'STALE_SOURCE'
  | 'OPERATION_ID_REUSE'
  | 'CANDIDATE_NOT_FOUND'
  | 'VOLUME_NOT_FOUND'
  | 'CHAPTER_NUMBER_CONFLICT'
  | 'INVALID_SELECTION'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_CONTENT'
  | 'PROJECT_SESSION_MISMATCH'
  | 'STORAGE_ERROR'

export type BlueprintVolumeOutlineOrigin = 'manual' | 'import' | 'ai' | 'template'

export interface BlueprintVolumeOutline {
  volumeId: string
  schemaVersion: number
  markdown: string
  revision: number
  contentHash: string
  origin: BlueprintVolumeOutlineOrigin
  sourceSnapshotId: string | null
  createdAt: string
  updatedAt: string
}

export interface BlueprintVolumeOutlineSummary {
  volumeId: string
  revision: number
  contentHash: string
  origin: BlueprintVolumeOutlineOrigin
  updatedAt: string
  /** Bounded preview; never the authoritative full Markdown body. */
  summary: string
}

export interface BlueprintVolumeOutlineSaveInput {
  volumeId: string
  expectedRevision: number
  markdown: string
  origin: BlueprintVolumeOutlineOrigin
  sourceSnapshotId?: string | null
}

export interface BlueprintVolumeOutlineDeleteInput {
  volumeId: string
  expectedRevision: number
}

export type BlueprintPlanningCandidateKind =
  | 'book-outline'
  | 'volume-plan'
  | 'volume-outline'
  | 'chapter-plan'
  | 'chapter-expand'
  | 'connection-check'

export type BlueprintPlanningCandidateState = 'candidate' | 'stale' | 'committed' | 'cancelled'

export interface BlueprintPlanningSourceReference {
  kind: 'synopsis' | 'volume' | 'volume-directory' | 'volume-index' | 'volume-outline' | 'chapter-detail' | 'chapter-summary' | 'chapter-volume' | 'chapter-index' | 'input' | 'template'
  targetId: string
  revision?: number | null
  contentHash: string
  volumeId?: string | null
  chapterNumber?: number | null
  /** Optional source range, prompt-input key, or author-visible citation. */
  range?: string
  label?: string
}

export interface BlueprintPlanningSourceSnapshot {
  snapshotId: string
  operationId?: string | null
  targetKind: BlueprintPlanningTargetKind
  targetId: string
  targetRevision?: number | null
  targetHash: string
  sources: BlueprintPlanningSourceReference[]
  createdAt?: string
}

export type BlueprintPlanningSourceState = 'current' | 'stale' | 'unlinked'

export interface BlueprintPlanningSourceStatusRecord {
  snapshotId: string
  state: BlueprintPlanningSourceState
}

export interface BlueprintPlanningTargetSourceReference {
  targetKind: BlueprintPlanningTargetKind
  targetId: string
}

export interface BlueprintPlanningTargetSourceStatusRecord {
  snapshotId: string | null
  operationId: string | null
  state: BlueprintPlanningSourceState
  targetKind: BlueprintPlanningTargetKind
  targetId: string
}

export interface BlueprintPlanningCandidateRecord<T = unknown> {
  operationId: string
  kind: BlueprintPlanningCandidateKind
  scope: BlueprintPlanningSelection
  state: BlueprintPlanningCandidateState
  schemaVersion: number
  payloadHash: string
  candidate: T
  sourceSnapshot: BlueprintPlanningSourceSnapshot
  createdAt: string
  updatedAt: string
  committedAt: string | null
  commitReceipt: unknown | null
}

export interface BlueprintPlanningCandidateSaveInput<T = unknown> {
  operationId: string
  kind: BlueprintPlanningCandidateKind
  scope: BlueprintPlanningSelection
  schemaVersion: number
  candidate: T
  sourceSnapshot: BlueprintPlanningSourceSnapshot
}

/** Persist an author's candidate edits with a payload-hash compare-and-set. */
export interface BlueprintPlanningCandidateUpdateInput<T = unknown> {
  operationId: string
  expectedPayloadHash: string
  candidate: T
}

export interface BlueprintPlanningCandidateListScope {
  selection?: BlueprintPlanningSelection
  states?: BlueprintPlanningCandidateState[]
  limit?: number
}

export interface BlueprintChapterPlanning {
  volumeTask?: string
  handoff?: string
  expectedEndChange?: string
}

/** Explicit author selection for committing a persisted planning candidate. */
export interface BlueprintPlanningConfirmSelection {
  volumeIds?: string[]
  chapterNumbers?: number[]
  /** Explicitly selects the volume receiving newly planned chapter rows. */
  targetVolumeId?: string
  /** Existing chapter changes require explicit chapter selection and CAS edits. */
  replaceChapterNumbers?: number[]
}

export interface BlueprintPlanningConfirmInput {
  operationId: string
  expectedSourceSnapshot: BlueprintPlanningSourceSnapshot
  selection: BlueprintPlanningConfirmSelection
  /** Author edits applied to the persisted candidate before the atomic commit. */
  edits?: unknown
}

export interface BlueprintPlanningCommitReceipt {
  operationId: string
  kind: BlueprintPlanningCandidateKind
  payloadHash: string
  committedAt: string
  selectedVolumeIds: string[]
  chapterNumbers: number[]
  sourceSnapshotId: string
  confirmationHash: string
  idempotent: boolean
}

export type BlueprintPlanningConfirmResult =
  | { success: true; receipt: BlueprintPlanningCommitReceipt }
  | { success: false; code: BlueprintPlanningErrorCode; error: string; current?: unknown }

export interface BlueprintPlanningCheckIssue {
  code: string
  severity: 'error' | 'warning' | 'suggestion'
  message: string
  sourceSnapshotId?: string
  volumeId?: string
  chapterNumber?: number
  citation?: string
}

export interface BlueprintPlanningCheckReport {
  checkId: string
  kind: 'book-volume' | 'volume-chapters'
  targetKind: BlueprintPlanningTargetKind
  targetId: string
  targetRevision: number | null
  targetHash: string
  sourceSnapshot: BlueprintPlanningSourceSnapshot
  deterministic: BlueprintPlanningCheckIssue[]
  aiSuggestions: BlueprintPlanningCheckIssue[]
  createdAt?: string
}

export interface BlueprintPlanningCheckListScope {
  selection?: BlueprintPlanningSelection
  limit?: number
}

export interface BlueprintPlanningCheckRecord extends BlueprintPlanningCheckReport {
  currentState: 'current' | 'stale' | 'unlinked'
}

export type BlueprintPlanningCheckSaveResult =
  | { success: true; report: BlueprintPlanningCheckRecord }
  | { success: false; code: BlueprintPlanningErrorCode; error: string }

export interface BlueprintPlanningExportPackage {
  manifest: { schemaVersion: number; exportedAt: string }
  synopsis: string
  volumes: Array<{
    volumeId: string
    name: string
    sortOrder: number
    outline: BlueprintVolumeOutline | null
  }>
  chapters: Array<{ chapterNumber: number; volumeId: string; blueprint: unknown; detail: unknown | null }>
}
