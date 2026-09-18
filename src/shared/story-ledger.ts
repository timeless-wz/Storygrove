export interface StoryEventRecord {
  eventId: string; projectId: string; title: string; chapterNumber?: number; storyTime?: string; location?: string
  participantFactIds: string[]; preconditions: string[]; result: Record<string, unknown>; source: Record<string, unknown>
  status: 'confirmed' | 'candidate' | 'deprecated'
}
export interface EntityStateSnapshot { snapshotId: string; projectId: string; entityFactId: string; chapterNumber: number; state: Record<string, unknown>; source: Record<string, unknown>; authorityStatus: 'confirmed' | 'candidate' | 'deprecated' }
