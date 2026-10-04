import type { CharacterRosterCommitReceipt, CharacterRosterEntry } from './character-roster'
import type { NovelConfig } from './ipc-channels'

export interface ImportGlobalFactsCore {
  genre: string
  subGenre: string
  targetAudience: string
  totalChapters: number
  wordsPerChapter: number
  plotStructure: NovelConfig['plotStructure']
  narrativePov: NovelConfig['narrativePOV']
  goldenFinger: string
  globalGuidance: string
  coreOutline: string
  worldSetting: string
  protagonistProfile: string
  premise: string
  worldbuilding: string
  synopsis: string
}

export interface ImportGlobalFactsRequest {
  operationId: string
  expectedRosterRevision: number
  /** SHA-256 of project_core.synopsis captured before the import inference ran. */
  expectedSynopsisHash: string
  core: ImportGlobalFactsCore
  characterEntries: CharacterRosterEntry[]
}

export interface ImportGlobalFactsReceipt {
  operationId: string
  payloadHash: string
  idempotent: boolean
  core: ImportGlobalFactsCore
  roster: CharacterRosterCommitReceipt
}
