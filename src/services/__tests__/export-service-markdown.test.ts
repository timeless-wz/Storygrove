import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '../ipc-client'
import { exportSelectedMarkdown, loadBasicSettingsExportSnapshot, renderBasicSettingsMarkdown, type BasicSettingsExportSnapshot } from '../export-service'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { DraftMarkdownSelectedChapter } from '../../shared/markdown-exchange'
import { useLocaleStore } from '../../stores/locale-store'

vi.mock('../ipc-client', () => ({
  ipc: { invoke: vi.fn(), invokeWithProjectSession: vi.fn() },
}))

const session: ProjectSessionContext = {
  projectId: 'isolated-export-project',
  leaseId: 'isolated-export-lease',
  projectPath: 'C:/temporary/isolated-export-project',
}
const project = {
  id: session.projectId,
  sessionLease: session.leaseId,
  path: session.projectPath,
  name: '隔离测试小说',
  novelConfig: { genre: '测试', targetAudience: '测试', writingLanguage: 'zh-CN' as const },
}
let outputRoot: string
let selected: DraftMarkdownSelectedChapter[]
let settingsData: BasicSettingsExportSnapshot

function receipt(chapter: DraftMarkdownSelectedChapter) {
  return {
    draftId: chapter.draftId,
    kind: chapter.kind,
    chapterNumber: chapter.chapterNumber,
    version: chapter.version,
    status: chapter.status,
    contentHash: chapter.contentHash,
    titleHash: chapter.titleHash,
    finalizationId: chapter.finalizationId,
  }
}

beforeEach(() => {
  outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-export-isolated-'))
  useLocaleStore.setState({ locale: 'zh-CN' })
  setActiveProjectSessionContext(session)
  selected = [{
    draftId: 11,
    kind: 'draft',
    chapterNumber: 1,
    version: 2,
    status: 'revised',
    title: '夜航',
    contentHash: 'a'.repeat(64),
    titleHash: 'b'.repeat(64),
    finalizationId: null,
    content: '# 第1章 夜航\r\nCafé 与月光\r\n第二行',
  }]
  settingsData = {
    core: { premise: '', worldSetting: '沿海群岛', worldbuilding: '雾港与灯塔' },
    roster: { renderedMarkdown: '', legacyMarkdown: '## 主角：林舟' },
    characters: [{
      name: '林舟', role: 'protagonist', gender: '', age: '', appearance: '黑发', personality: '谨慎',
      background: '', abilities: '', motivation: '找回航图', relationships: '', arc: '', notes: '',
    }],
  } as unknown as BasicSettingsExportSnapshot

  vi.clearAllMocks()
  vi.mocked(ipc.invoke).mockImplementation(async (channel, ...args) => {
    if (channel === 'fs:grant-mkdir') {
      fs.mkdirSync(path.join(outputRoot, String(args[1])))
      return { success: true } as never
    }
    if (channel === 'fs:grant-write-file') {
      const [relativePath, content] = args.slice(1) as [string, string]
      fs.writeFileSync(path.join(outputRoot, ...relativePath.split('/')), content, 'utf8')
      return { success: true, commitState: 'committed' } as never
    }
    throw new Error(`Unexpected write channel: ${String(channel)}`)
  })
  vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (_context: ProjectSessionContext, channel: string) => {
    if (channel === 'db:draft-export-selection') return { chapters: selected, receipt: selected.map(receipt) } as never
    if (channel === 'db:draft-export-selection-current') return true as never
    if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-1', name: '第1卷', sortOrder: 1 }] as never
    if (channel === 'db:blueprint-list-summary') return [{ chapterNumber: 1, volumeId: 'volume-1' }] as never
    if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 1, volumeId: 'volume-1' }] as never
    if (channel === 'db:project-core-get') return settingsData.core as never
    if (channel === 'db:character-roster-read') return settingsData.roster as never
    if (channel === 'db:character-get-all') return settingsData.characters as never
    if (channel === 'db:cultivation-read') return {
      revision: 1,
      realms: [{ id: 'qi', name: '炼气', levelId: 'qi-base', stages: [{ id: 'qi-1', name: '一层' }, { id: 'qi-2', name: '二层' }] }],
    } as never
    throw new Error(`Unexpected project channel: ${String(channel)}`)
  }) as never)
})

afterEach(() => {
  setActiveProjectSessionContext(null)
  fs.rmSync(outputRoot, { recursive: true, force: true })
})

describe('selected Markdown export', () => {
  it('writes an isolated UTF-8 single-chapter .md and keeps source line breaks without duplicating its heading', async () => {
    const response = await exportSelectedMarkdown({
      range: 'chapter', format: 'merged-md', grantId: 'temporary-export-grant',
      selections: [{ draftId: 11, kind: 'draft' }], scopeName: '第 1 章',
    }, project, session, selected.map(receipt))

    expect(response.success).toBe(true)
    const file = path.join(outputRoot, response.path!)
    const saved = fs.readFileSync(file, 'utf8')
    expect(saved.match(/# 第1章 夜航/gu)).toHaveLength(1)
    expect(saved).toContain('Café 与月光\r\n第二行')
  })

  it('exports the selected single-chapter current finalized body', async () => {
    selected = [{
      ...selected[0]!,
      kind: 'finalized',
      status: 'finalized',
      finalizationId: 'current-finalization-1',
      content: '权威正文第一行\n权威正文第二行',
      contentHash: 'c'.repeat(64),
    }]
    const response = await exportSelectedMarkdown({
      range: 'chapter', format: 'merged-md', grantId: 'temporary-export-grant',
      selections: [{ draftId: 11, kind: 'finalized' }], scopeName: '第 1 章',
    }, project, session, selected.map(receipt))

    expect(response.success).toBe(true)
    const saved = fs.readFileSync(path.join(outputRoot, response.path!), 'utf8')
    expect(saved.match(/# 第1章 夜航/gu)).toHaveLength(1)
    expect(saved).toContain('权威正文第一行\n权威正文第二行')
  })

  it('writes four selected basic-setting sections from their database sources and marks empty fields', async () => {
    const keys = ['premise', 'worldview', 'character-graph', 'character-profiles'] as const
    const response = await exportSelectedMarkdown({
      range: 'settings', format: 'merged-md', grantId: 'temporary-export-grant', selections: [], settings: [...keys],
    }, project, session, [], settingsData)

    expect(response.success).toBe(true)
    const saved = fs.readFileSync(path.join(outputRoot, response.path!), 'utf8')
    expect(saved).toContain('故事前提')
    expect(saved).toContain('（暂无内容）')
    expect(saved).toContain('沿海群岛')
    expect(saved).toContain('雾港与灯塔')
    expect(saved).toContain('## 主角：林舟')
    expect(saved).toContain('角色档案')
    expect(saved).toContain('动机: 找回航图')

    const split = await exportSelectedMarkdown({
      range: 'settings', format: 'split-md', grantId: 'temporary-export-grant', selections: [], settings: [...keys],
    }, project, session, [], settingsData)
    const separateFiles = fs.readdirSync(path.join(outputRoot, split.path!)).filter(file => file.endsWith('.md'))
    expect(separateFiles).toHaveLength(4)
    expect(fs.readFileSync(path.join(outputRoot, split.path!, '01-story-premise.md'), 'utf8')).toContain('（暂无内容）')
    expect(fs.readFileSync(path.join(outputRoot, split.path!, '03-character-graph.md'), 'utf8')).toContain('## 主角：林舟')
  })

  it('exports a bound level with its number and full name while preserving labeled legacy free text', async () => {
    const character = {
      ...settingsData.characters[0]!,
      cultivationLevelId: 'qi-2',
      currentState: {
        location: '', powerLevel: '旧修为：筑基中期', physicalState: '', mentalState: '', keyItems: '', recentEvents: '', updatedAtChapter: 0,
      },
    }
    settingsData.characters = [character]
    const snapshot = await loadBasicSettingsExportSnapshot(session)
    const chinese = renderBasicSettingsMarkdown(snapshot, ['character-profiles'], 'zh-CN')[0]!.content
    expect(chinese).toContain('- 修炼等级: 2 = 炼气·二层')
    expect(chinese).toContain('- 修为描述（自由文本）: 旧修为：筑基中期')

    const english = renderBasicSettingsMarkdown(snapshot, ['character-profiles'], 'en-US')[0]!.content
    expect(english).toContain('- Cultivation level: 2 = 炼气·二层')
    expect(english).toContain('- Power description (free text): 旧修为：筑基中期')
    expect(ipc.invokeWithProjectSession).toHaveBeenCalledWith(session, 'db:cultivation-read', session.projectPath)
  })

  it('writes each mixed-version volume chapter to its own Markdown file', async () => {
    const second: DraftMarkdownSelectedChapter = {
      draftId: 20, kind: 'finalized', chapterNumber: 2, version: 1, status: 'finalized',
      title: '落潮', content: '落潮正文\n下一行', contentHash: 'e'.repeat(64), titleHash: 'f'.repeat(64), finalizationId: 'final-20',
    }
    selected = [{ ...selected[0]!, content: 'v2 draft prose' }, second]
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (_context: ProjectSessionContext, channel: string) => {
      if (channel === 'db:draft-export-selection') return {
        chapters: selected,
        receipt: selected.map(receipt),
      } as never
      if (channel === 'db:draft-export-selection-current') return true as never
      if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-1', name: '第1卷', sortOrder: 1 }] as never
      if (channel === 'db:blueprint-list-summary') return [
        { chapterNumber: 1, volumeId: 'volume-1' }, { chapterNumber: 2, volumeId: 'volume-1' },
      ] as never
      throw new Error(`Unexpected project channel: ${channel}`)
    }) as never)
    const response = await exportSelectedMarkdown({
      range: 'volume', format: 'split-md', grantId: 'temporary-export-grant',
      selections: [{ draftId: 11, kind: 'draft' }, { draftId: 20, kind: 'finalized' }],
      volumeId: 'volume-1', expectedChapterNumbers: [1, 2],
    }, project, session, selected.map(receipt))

    expect(response.success).toBe(true)
    const files = fs.readdirSync(path.join(outputRoot, response.path!)).sort()
    expect(files).toEqual(['chapter-1-夜航.md', 'chapter-2-落潮.md'])
    expect(fs.readFileSync(path.join(outputRoot, response.path!, files[0]!), 'utf8')).toContain('v2 draft prose')
    expect(fs.readFileSync(path.join(outputRoot, response.path!, files[1]!), 'utf8')).toContain('落潮正文\n下一行')
  })

  it('refuses a volume export when one chapter has no explicitly selected version', async () => {
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (_context: ProjectSessionContext, channel: string) => {
      if (channel === 'db:draft-export-selection') return { chapters: selected, receipt: selected.map(receipt) } as never
      if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-1', name: '第1卷', sortOrder: 1 }] as never
      if (channel === 'db:blueprint-list-summary') return [
        { chapterNumber: 1, volumeId: 'volume-1' }, { chapterNumber: 2, volumeId: 'volume-1' },
      ] as never
      throw new Error(`Unexpected project channel: ${String(channel)}`)
    }) as never)

    const response = await exportSelectedMarkdown({
      range: 'volume', format: 'merged-md', grantId: 'temporary-export-grant',
      selections: [{ draftId: 11, kind: 'draft' }], volumeId: 'volume-1', expectedChapterNumbers: [1, 2],
    }, project, session, selected.map(receipt))

    expect(response.success).toBe(false)
    expect(response.error).toContain('数据已变化')
    expect(fs.readdirSync(outputRoot)).toHaveLength(0)
  })

  it('uses a new output directory for repeated exports so old chapter files cannot leak into the next run', async () => {
    const first = await exportSelectedMarkdown({
      range: 'chapter', format: 'merged-md', grantId: 'temporary-export-grant', selections: [{ draftId: 11, kind: 'draft' }],
    }, project, session, selected.map(receipt))
    selected = [{ ...selected[0]!, draftId: 12, chapterNumber: 2, version: 1, title: '新章', content: 'Only chapter two', contentHash: 'c'.repeat(64), titleHash: 'd'.repeat(64) }]
    const second = await exportSelectedMarkdown({
      range: 'chapter', format: 'merged-md', grantId: 'temporary-export-grant', selections: [{ draftId: 12, kind: 'draft' }],
    }, project, session, selected.map(receipt))
    expect(first.path).not.toBe(second.path)
    expect(fs.readFileSync(path.join(outputRoot, first.path!), 'utf8')).toContain('Café')
    expect(fs.readFileSync(path.join(outputRoot, second.path!), 'utf8')).toContain('Only chapter two')
    expect(fs.readdirSync(outputRoot)).toHaveLength(2)
  })

  it('refuses a volume export when the blueprint volume membership changed after preview', async () => {
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (_context: ProjectSessionContext, channel: string) => {
      if (channel === 'db:draft-export-selection') return { chapters: selected, receipt: selected.map(receipt) } as never
      if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-1', name: '第1卷', sortOrder: 1 }] as never
      if (channel === 'db:blueprint-list-summary') return [{ chapterNumber: 1, volumeId: 'volume-1' }, { chapterNumber: 2, volumeId: 'volume-1' }] as never
      throw new Error(`Unexpected project channel: ${String(channel)}`)
    }) as never)
    const response = await exportSelectedMarkdown({
      range: 'volume', format: 'merged-md', grantId: 'temporary-export-grant',
      selections: [{ draftId: 11, kind: 'draft' }], volumeId: 'volume-1', expectedChapterNumbers: [1],
    }, project, session, selected.map(receipt))
    expect(response.success).toBe(false)
    expect(response.error).toContain('数据已变化')
    expect(ipc.invoke).not.toHaveBeenCalledWith('fs:grant-write-file', expect.anything(), expect.anything(), expect.anything())
  })
})
