import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  confirmBlueprintBookOutlineImport,
  confirmBlueprintVolumeOutlineImport,
  exportBlueprintPlanningPackage,
  exportBlueprintVolumeOutlineMarkdown,
  prepareBlueprintBookOutlineImport,
  prepareBlueprintVolumeOutlineImport,
  sha256PlanningText,
} from '../blueprint-planning-exchange'
import { ipc } from '../ipc-client'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { BlueprintPlanningExportPackage, BlueprintVolumeOutline } from '../../shared/blueprint-planning'

vi.mock('../ipc-client', () => ({
  ipc: {
    invoke: vi.fn(),
    invokeWithProjectSession: vi.fn(),
  },
}))

const session: ProjectSessionContext = {
  projectId: 'planning-exchange-project',
  leaseId: 'planning-exchange-lease',
  projectPath: 'C:/novels/planning-exchange',
}
const importedMarkdown = '# 第二卷\r\n\r\n保留原始换行。\r\n'
const volume: BlueprintVolumeOutline = {
  volumeId: 'volume-2', schemaVersion: 1, markdown: importedMarkdown, revision: 1,
  contentHash: sha256PlanningText(importedMarkdown), origin: 'import', sourceSnapshotId: null,
  createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  setActiveProjectSessionContext(session)
  vi.mocked(ipc.invoke).mockImplementation((async (channel: string) => {
    if (channel === 'dialog:select-markdown-files') return [{ grantId: 'read-grant', displayName: '卷纲.md' }]
    if (channel === 'fs:grant-read-file') return { success: true, content: importedMarkdown }
    if (channel === 'dialog:select-export-directory') return { grantId: 'write-grant' }
    if (channel === 'fs:grant-write-file') return { success: true }
    throw new Error(`Unexpected unscoped IPC channel: ${channel}`)
  }) as never)
  vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (
    _projectSession: ProjectSessionContext,
    channel: string,
  ) => {
    if (channel === 'db:blueprint-volume-outline-get') return null
    if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-2', name: '第二卷', sortOrder: 2 }]
    if (channel === 'db:project-core-get') return { synopsis: '旧总纲' }
    if (channel === 'db:project-core-update') return { success: true }
    throw new Error(`Unexpected project IPC channel: ${channel}`)
  }) as never)
})

afterEach(() => {
  setActiveProjectSessionContext(null)
})

describe('blueprint planning Markdown exchange', () => {
  it('previews one granted volume Markdown file and confirms it through revision CAS plus database read-back', async () => {
    let outlineReads = 0
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (
      _projectSession: ProjectSessionContext,
      channel: string,
    ) => {
      if (channel === 'db:blueprint-volume-outline-get') return outlineReads++ === 0 ? null : volume
      if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-2', name: '第二卷', sortOrder: 2 }]
      if (channel === 'db:blueprint-volume-outline-save') return { success: true, outline: volume }
      throw new Error(`Unexpected project IPC channel: ${channel}`)
    }) as never)

    const prepared = await prepareBlueprintVolumeOutlineImport(session, 'volume-2')
    expect(prepared).toMatchObject({
      success: true,
      preview: {
        volumeId: 'volume-2', fileName: '卷纲.md', markdown: importedMarkdown,
        importHash: sha256PlanningText(importedMarkdown), expectedRevision: 0,
        currentMarkdown: null, currentHash: null,
      },
    })
    if (!prepared.success || !prepared.preview) return

    await expect(confirmBlueprintVolumeOutlineImport(session, prepared.preview))
      .resolves.toMatchObject({ success: true, outline: { markdown: importedMarkdown, revision: 1 } })
    expect(ipc.invoke).toHaveBeenCalledWith('fs:grant-read-file', 'read-grant')
    expect(ipc.invokeWithProjectSession).toHaveBeenCalledWith(
      session,
      'db:blueprint-volume-outline-save',
      { volumeId: 'volume-2', expectedRevision: 0, markdown: importedMarkdown, origin: 'import' },
      session.projectPath,
    )
  })

  it('imports the legacy total outline into synopsis with the frozen hash and returns exact read-back', async () => {
    let coreReads = 0
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (
      _projectSession: ProjectSessionContext,
      channel: string,
    ) => {
      if (channel === 'db:project-core-get') return { synopsis: coreReads++ === 0 ? '旧总纲' : importedMarkdown }
      if (channel === 'db:project-core-update') return { success: true }
      throw new Error(`Unexpected project IPC channel: ${channel}`)
    }) as never)

    const prepared = await prepareBlueprintBookOutlineImport(session)
    expect(prepared).toMatchObject({ success: true, preview: { currentSynopsis: '旧总纲', markdown: importedMarkdown } })
    if (!prepared.success || !prepared.preview) return
    await expect(confirmBlueprintBookOutlineImport(session, prepared.preview))
      .resolves.toEqual({ success: true, content: importedMarkdown })
    expect(ipc.invokeWithProjectSession).toHaveBeenCalledWith(
      session,
      'db:project-core-update',
      { synopsis: importedMarkdown, expectedSynopsisHash: sha256PlanningText('旧总纲') },
      session.projectPath,
    )
  })

  it('exports exact volume Markdown and the versioned planning package through granted file writes', async () => {
    const packageValue: BlueprintPlanningExportPackage = {
      manifest: { schemaVersion: 1, exportedAt: '2026-10-03T00:00:00.000Z' },
      synopsis: '全书总纲',
      volumes: [{ volumeId: 'volume-2', name: '第二卷', sortOrder: 2, outline: volume }],
      chapters: [{ chapterNumber: 22, volumeId: 'volume-2', blueprint: { title: '章纲' }, detail: null }],
    }
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (
      _projectSession: ProjectSessionContext,
      channel: string,
    ) => {
      if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-2', name: '第二:/卷', sortOrder: 2 }]
      if (channel === 'db:blueprint-volume-outline-get') return volume
      if (channel === 'db:blueprint-planning-export') return packageValue
      throw new Error(`Unexpected project IPC channel: ${channel}`)
    }) as never)

    await expect(exportBlueprintVolumeOutlineMarkdown(session, 'volume-2'))
      .resolves.toMatchObject({ success: true, fileName: '第二--卷-卷纲.md' })
    expect(ipc.invoke).toHaveBeenCalledWith('fs:grant-write-file', 'write-grant', '第二--卷-卷纲.md', importedMarkdown)

    await expect(exportBlueprintPlanningPackage(session))
      .resolves.toMatchObject({ success: true, fileName: 'blueprint-planning-export.json', package: packageValue })
    const packageWrite = vi.mocked(ipc.invoke).mock.calls.find(call => (
      call[0] === 'fs:grant-write-file' && String(call[3]).includes('"manifest"')
    ))
    expect(packageWrite?.[3]).toContain('"synopsis": "全书总纲"')
    expect(packageWrite?.[3]).toContain('"volumeId": "volume-2"')
    expect(packageWrite?.[3]).not.toContain('drafts')
  })
})
