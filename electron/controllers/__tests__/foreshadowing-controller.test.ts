import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  currentProjectPath: 'C:/projects/A',
  handlers: new Map<string, IpcHandler>(),
  assertCurrentProjectContext: vi.fn(),
  foreshadowingListAll: vi.fn(() => []),
  foreshadowingListByDraft: vi.fn(() => []),
  foreshadowingCreate: vi.fn(() => 'fsh-123'),
  foreshadowingUpdate: vi.fn(),
  foreshadowingToggleCompleted: vi.fn(),
  foreshadowingDelete: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../../database', () => ({
  getCurrentProjectPath: () => mocks.currentProjectPath,
  getProjectDb: vi.fn(),
  closeProjectDatabase: vi.fn(),
}))

vi.mock('../../services/project-access', () => ({
  projectAccess: {
    assertCurrentProjectContext: mocks.assertCurrentProjectContext,
    invalidateCurrentSession: vi.fn(),
  },
}))

vi.mock('../../repositories/foreshadowing-repository', () => ({
  ForeshadowingRepository: {
    listAll: mocks.foreshadowingListAll,
    listByDraft: mocks.foreshadowingListByDraft,
    create: mocks.foreshadowingCreate,
    update: mocks.foreshadowingUpdate,
    toggleCompleted: mocks.foreshadowingToggleCompleted,
    delete: mocks.foreshadowingDelete,
  },
}))

describe('Foreshadowing IPC Controller', () => {
  beforeAll(async () => {
    const { registerDatabaseController } = await import('../db-controller')
    registerDatabaseController()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentProjectPath = 'C:/projects/A'
    mocks.assertCurrentProjectContext.mockReturnValue({
      projectId: 'project-A',
      leaseId: 'lease-A',
      rootPath: 'C:/projects/A',
    })
  })

  it('handles db:foreshadowing-list with path validation', async () => {
    const handler = mocks.handlers.get('db:foreshadowing-list')
    expect(handler).toBeDefined()

    const session = { projectId: 'project-A', leaseId: 'lease-A', projectPath: 'C:/projects/A' }
    await handler!({}, 'pending', 'C:/projects/A', session)

    expect(mocks.assertCurrentProjectContext).toHaveBeenCalledWith(session, 'C:/projects/A')
    expect(mocks.foreshadowingListAll).toHaveBeenCalledWith('pending')
  })

  it('rejects db:foreshadowing-list when expectedProjectPath mismatches', async () => {
    const handler = mocks.handlers.get('db:foreshadowing-list')
    expect(handler).toBeDefined()

    const session = { projectId: 'project-A', leaseId: 'lease-A', projectPath: 'C:/projects/A' }
    await expect(handler!({}, 'all', 'C:/projects/B', session)).rejects.toThrow()
  })

  it('handles db:foreshadowing-list-by-draft with path validation', async () => {
    const handler = mocks.handlers.get('db:foreshadowing-list-by-draft')
    expect(handler).toBeDefined()

    const session = { projectId: 'project-A', leaseId: 'lease-A', projectPath: 'C:/projects/A' }
    await handler!({}, 42, 'C:/projects/A', session)

    expect(mocks.foreshadowingListByDraft).toHaveBeenCalledWith(42)
  })

  it('handles mutating db:foreshadowing-create with success response', async () => {
    const handler = mocks.handlers.get('db:foreshadowing-create')
    expect(handler).toBeDefined()

    const session = { projectId: 'project-A', leaseId: 'lease-A', projectPath: 'C:/projects/A' }
    const input = {
      draftId: 1,
      chapterNumber: 1,
      selectedText: '线索',
      startOffset: 0,
      endOffset: 2,
      note: '重要线索',
    }

    const result = await handler!({}, input, 'C:/projects/A', session) as { success: boolean; id?: string }
    expect(result.success).toBe(true)
    expect(result.id).toBe('fsh-123')
    expect(mocks.foreshadowingCreate).toHaveBeenCalledWith(input)
  })

  it('catches error and returns { success: false, error } on mutating channel failure', async () => {
    const handler = mocks.handlers.get('db:foreshadowing-create')
    expect(handler).toBeDefined()

    mocks.foreshadowingCreate.mockImplementationOnce(() => {
      throw new Error('选中文本不能为空')
    })

    const session = { projectId: 'project-A', leaseId: 'lease-A', projectPath: 'C:/projects/A' }
    const result = await handler!({}, { draftId: 1, selectedText: '' }, 'C:/projects/A', session) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('选中文本不能为空')
  })

  it('handles db:foreshadowing-toggle-completed with mutating whitelist protection', async () => {
    const handler = mocks.handlers.get('db:foreshadowing-toggle-completed')
    expect(handler).toBeDefined()

    const session = { projectId: 'project-A', leaseId: 'lease-A', projectPath: 'C:/projects/A' }
    const result = await handler!({}, 'fsh-1', true, 'C:/projects/A', session) as { success: boolean }
    expect(result.success).toBe(true)
    expect(mocks.foreshadowingToggleCompleted).toHaveBeenCalledWith('fsh-1', true)
  })

  it('handles db:foreshadowing-update and db:foreshadowing-delete', async () => {
    const updateHandler = mocks.handlers.get('db:foreshadowing-update')
    const deleteHandler = mocks.handlers.get('db:foreshadowing-delete')
    expect(updateHandler).toBeDefined()
    expect(deleteHandler).toBeDefined()

    const session = { projectId: 'project-A', leaseId: 'lease-A', projectPath: 'C:/projects/A' }

    const updateRes = await updateHandler!({}, 'fsh-1', { note: '新说明' }, 'C:/projects/A', session) as { success: boolean }
    expect(updateRes.success).toBe(true)
    expect(mocks.foreshadowingUpdate).toHaveBeenCalledWith('fsh-1', { note: '新说明' })

    const deleteRes = await deleteHandler!({}, 'fsh-1', 'C:/projects/A', session) as { success: boolean }
    expect(deleteRes.success).toBe(true)
    expect(mocks.foreshadowingDelete).toHaveBeenCalledWith('fsh-1')
  })
})
