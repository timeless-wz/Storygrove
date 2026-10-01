import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectStore } from '../../../../stores/project-store'
import { assertNoLossOnSerialize, parseChapterBlueprintMarkdown } from '../../../../shared/blueprint-v2-markdown'
import { readBlueprintTool } from '../read-blueprint.tool'
import { createAgentExecutionContext } from '../project-context'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../../ipc-client', () => ({
  ipc: { invokeWithProjectSession: (...args: unknown[]) => invoke(...args) },
}))

const project = {
  id: 'blueprint-reader-project', sessionLease: 'blueprint-reader-lease', name: 'Reader', path: 'C:\\novels\\reader',
  novelConfig: { writingLanguage: 'zh-CN' },
}
const fixture = readFileSync(path.join(__dirname, '../../../../../test/fixtures/blueprint-v2/chapter-01.md'), 'utf8')
const parsed = parseChapterBlueprintMarkdown(fixture).content
const detail = { ...parsed, revision: 1, contentHash: 'reader-hash' }

beforeEach(() => {
  invoke.mockReset()
  useProjectStore.setState({ currentProject: project as never })
})

afterEach(() => {
  useProjectStore.setState({ currentProject: null })
})

describe('read_blueprint bounded and full projections', () => {
  it('reads and returns the complete chapter-one v2 Markdown on an explicit chapter request', async () => {
    invoke.mockImplementation(async (_session: unknown, channel: string) => {
      if (channel === 'db:blueprint-get') return null
      if (channel === 'db:blueprint-v2-get') return detail
      throw new Error(`Unexpected channel: ${channel}`)
    })

    const result = await readBlueprintTool.execute({ chapter_number: 1 }, createAgentExecutionContext())

    expect(result).toMatchObject({ success: true })
    expect(result.content).toContain(assertNoLossOnSerialize(detail))
    expect(result.content).toContain('场景四：开出地图的末班车')
    expect(result.content).toContain('源-锚-桥-能参数')
    expect(result.content).toContain('写作禁忌与防坑自检')
    expect(invoke.mock.calls.map(([, channel]) => channel)).toEqual([
      'db:blueprint-get', 'db:blueprint-v2-get',
    ])
  })

  it('includes v2-only chapters in the bounded index without sending their full outlines', async () => {
    invoke.mockImplementation(async (_session: unknown, channel: string) => {
      if (channel === 'db:blueprint-list-summary') return []
      if (channel === 'db:blueprint-v2-summary-list') return [{
        chapterNumber: 1, revision: 1, contentHash: 'reader-hash', origin: 'import',
        updatedAt: '', sceneCount: 4, sceneTitles: ['场景一', '场景二'], wordBudget: 4200,
      }]
      throw new Error(`Unexpected channel: ${channel}`)
    })

    const result = await readBlueprintTool.execute({}, createAgentExecutionContext())

    expect(result).toMatchObject({ success: true })
    expect(result.content).toContain('第 1 章')
    expect(result.content).toContain('v2，4 个分镜')
    expect(result.content).not.toContain('源-锚-桥-能参数')
    expect(invoke.mock.calls.map(([, channel]) => channel)).toEqual([
      'db:blueprint-list-summary', 'db:blueprint-v2-summary-list',
    ])
  })
})
