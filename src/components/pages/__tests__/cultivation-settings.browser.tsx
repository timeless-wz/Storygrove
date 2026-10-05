import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import '../../../index.css'
import '../../../styles/literary-themes.css'
import CultivationSettingsPage from '../CultivationSettingsPage'
import CharacterEditor from '../../editor/CharacterEditor'
import { useCultivationStore } from '../../../stores/cultivation-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import type { CultivationSystem } from '../../../shared/cultivation'
import type { CharacterRosterSnapshot } from '../../../shared/character-roster'
import type { CharacterRosterEntry } from '../../../shared/character-roster'

declare module 'vitest/browser' {
  interface BrowserCommands { cultivationIpc: (channel: string, ...args: unknown[]) => Promise<unknown> }
}
let root: Root
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let session: ProjectSessionContext
let pendingUiIpc = new Set<Promise<unknown>>()
const initialCultivation = useCultivationStore.getState()
const initialCharacter = useCharacterStore.getState()
const initialEditor = useEditorStore.getState()
const initialProject = useProjectStore.getState()
function setProject() {
  setActiveProjectSessionContext(session)
  useProjectStore.setState({ currentProject: { id: session.projectId, sessionLease: session.leaseId, path: session.projectPath, name: '修炼等级测试项目', novelConfig: { genre: '玄幻', subGenre: '', targetAudience: '全龄', totalChapters: 10, wordsPerChapter: 2000, plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '' }, characterStates: '', createdAt: '', updatedAt: '' } as ProjectData })
}
async function invoke<T>(channel: string, ...args: unknown[]) { return await commands.cultivationIpc(channel, ...args, session.projectPath, session) as T }
async function actWithPendingUiIpc(action: () => Promise<unknown>) {
  await act(async () => {
    await action()
    while (pendingUiIpc.size) await Promise.all([...pendingUiIpc])
    // The UI handler awaits the same IPC promise after the tracker resolves;
    // yield one task so its post-save React updates finish inside this act.
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}
async function actOnUi(action: () => Promise<unknown>) {
  await act(async () => { await action() })
}
async function openLevelsTab() {
  const label = useLocaleStore.getState().locale === 'en-US' ? 'Levels' : '等级结构'
  await actOnUi(() => page.getByRole('tab', { name: label }).click())
}
async function setCultivationMarkdown(markdown: string) {
  const surface = container.querySelector<HTMLElement>('[data-testid="cultivation-settings"] [data-document-layout="long-document"]')
  await vi.waitFor(() => expect(surface?.querySelector('[data-vditor-ready="true"]')).not.toBeNull())
  const sourceMode = surface?.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-mode="sv"]')
  expect(sourceMode).not.toBeNull()
  await actOnUi(async () => { sourceMode?.click() })
  const textarea = surface?.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
  expect(textarea).not.toBeNull()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, markdown)
    textarea?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function dismissToasts() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#vela-toast-root button'))
  for (const button of buttons) await act(async () => { button.click() })
}
async function render(kind: 'settings' | 'character') {
  await act(async () => { await useCultivationStore.getState().load(session) })
  await act(async () => { root.render(kind === 'settings' ? <CultivationSettingsPage projectKey={session.projectPath} tabId="cultivation-settings" initialContent="" initialDirty={false} /> : <CharacterEditor projectKey={session.projectPath} />) })
  if (kind === 'character') {
    // CharacterEditor loads the roster-repair status on a zero-delay timer.
    // Mount first so passive effects schedule that timer, then settle its real
    // read and resulting React update in a separate act scope.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
      while (pendingUiIpc.size) await Promise.all([...pendingUiIpc])
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}
async function seed() {
  const roster = await invoke<CharacterRosterSnapshot>('db:character-roster-read')
  await invoke('db:cultivation-save', { expectedRevision: 0, expectedRosterRevision: roster.revision, resolutions: {}, realms: [
    { id: 'qi', name: '炼气', levelId: 'qi-base', stages: [{ id: 'qi-1', name: '一层' }, { id: 'qi-2', name: '二层' }] },
    { id: 'foundation', name: '筑基', levelId: 'foundation-base', stages: [] },
  ] })
  await act(async () => { await useCharacterStore.getState().load(session.projectPath, session) })
}
async function reopen() {
  await act(async () => {
    session = await commands.cultivationIpc('fixture:reopen') as ProjectSessionContext
    useCultivationStore.setState(initialCultivation)
    setProject()
    await useCultivationStore.getState().load(session)
    await useCharacterStore.getState().load(session.projectPath, session)
  })
}
async function addSecondBoundCharacter() {
  const roster = await invoke<CharacterRosterSnapshot>('db:character-roster-read')
  const first = roster.entries.find(entry => entry.name === '沈砺')!
  const second: CharacterRosterEntry = { ...first, name: '顾衡', role: 'supporting', cultivationLevelId: 'qi-2' }
  const entries = roster.entries.map(entry => entry.name === '沈砺' ? { ...entry, cultivationLevelId: 'qi-1' } : entry)
  entries.push(second)
  await invoke('db:character-roster-commit', {
    operationId: `browser-multi-binding-${Date.now()}`, expectedRevision: roster.revision, schemaVersion: 1,
    intent: 'manual_edit', expectedLegacyMarkdown: roster.legacyMarkdown ?? '', entries,
  })
  await act(async () => { await useCharacterStore.getState().load(session.projectPath, session) })
}
beforeEach(async () => {
  await page.viewport(1100, 900)
  session = await commands.cultivationIpc('fixture:reset') as ProjectSessionContext
  await act(async () => {
    useCultivationStore.setState(initialCultivation); useCharacterStore.setState(initialCharacter); useEditorStore.setState({ ...initialEditor, draftLedgers: {}, tabs: [] })
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    setProject()
  })
  pendingUiIpc = new Set()
  ;(window as unknown as { velaAPI: unknown }).velaAPI = {
    invoke: (channel: string, ...args: unknown[]) => {
      const tracked = commands.cultivationIpc(channel, ...args).finally(() => pendingUiIpc.delete(tracked))
      pendingUiIpc.add(tracked)
      return tracked
    },
    on: () => () => {}, once: () => {}, send: () => {},
  }
  container = document.createElement('div'); container.style.height = '760px'; document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => {
  await dismissToasts()
  await act(async () => root.unmount()); container.remove()
  await commands.cultivationIpc('fixture:dispose')
  await act(async () => {
    useCultivationStore.setState(initialCultivation); useCharacterStore.setState(initialCharacter); useEditorStore.setState(initialEditor); useProjectStore.setState(initialProject); setActiveProjectSessionContext(null)
  })
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.theme
})

it('creates editable presets, persists names/order, and reads the same SQLite configuration after reopen', async () => {
  await render('settings')
  document.documentElement.dataset.theme = 'verdant'
  await actOnUi(() => page.getByRole('tab', { name: '机制说明' }).click())
  await vi.waitFor(() => expect(container.querySelector('[data-document-layout="long-document"] [data-vditor-ready="true"]')).not.toBeNull())
  const mechanismText = '## 力量源头\n\n力量来自潮汐晶核，成长需要承担对应代价。'
  await setCultivationMarkdown(mechanismText)
  const mechanismSurface = container.querySelector<HTMLElement>('[data-document-layout="long-document"]')!
  const irMode = mechanismSurface.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-mode="ir"]')
  await actOnUi(async () => { irMode?.click() })
  await vi.waitFor(() => expect(mechanismSurface.querySelector('.vditor-ir h2')?.textContent).toContain('力量源头'))
  expect(mechanismSurface.dataset.editorAppearance).toBe('plain')
  const mechanismTextSurface = mechanismSurface.querySelector('.vditor-ir pre.vditor-reset')!
  expect(getComputedStyle(mechanismTextSurface).borderTopWidth).toBe('0px')
  expect(getComputedStyle(mechanismTextSurface).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  for (const selector of ['.vditor-prose-host', '.vditor', '.vditor-content', '.vditor-ir']) {
    expect(getComputedStyle(mechanismSurface.querySelector(selector)!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  }
  expect(container.querySelector<HTMLElement>('[data-document-layout="long-document"]')?.dataset.toolbarEnabled).toBe('false')
  expect(getComputedStyle(mechanismSurface.querySelector('.vditor-toolbar')!).display).toBe('none')
  await expect.element(page.getByRole('button', { name: '目录' })).toHaveAttribute('aria-expanded', 'false')
  expect(container.querySelector<HTMLElement>('nav[aria-label="文档目录"]')?.hidden).toBe(true)
  await page.screenshot({ path: '../../../../output/playwright/cultivation-settings-mechanism.png' })
  await actOnUi(() => page.getByRole('tab', { name: '等级结构' }).click())
  expect(container.querySelector<HTMLTextAreaElement>('[data-testid="cultivation-settings"] [data-document-layout="long-document"] textarea.vditor-sv')?.value).toBe(mechanismText)
  await expect.element(page.getByTestId('cultivation-levels-empty')).toBeVisible()
  await actOnUi(() => page.getByRole('button', { name: '新增大境界', exact: true }).click())
  await actOnUi(() => page.getByRole('textbox', { name: '大境界 1 名称' }).fill('炼气'))
  await actOnUi(() => page.getByRole('button', { name: '一到九层', exact: true }).click())
  await actOnUi(() => page.getByRole('textbox', { name: '小境界 1 名称' }).fill('入门'))
  await actOnUi(() => page.getByRole('button', { name: '下移小境界 1', exact: true }).click())
  await actOnUi(() => page.getByRole('button', { name: '新增大境界', exact: true }).click())
  await actOnUi(() => page.getByRole('textbox', { name: '大境界 2 名称' }).fill('筑基'))
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '保存力量体系', exact: true }).click())
  await expect.element(page.getByText('力量体系已保存', { exact: true })).toBeVisible()
  const system = await invoke<CultivationSystem>('db:cultivation-read')
  expect(system.realms[0].stages[1].name).toBe('入门')
  expect(system.realms[1].stages).toEqual([])
  expect(system.markdown?.trimEnd()).toBe(mechanismText)
  await page.screenshot({ path: '../../../../output/playwright/cultivation-settings-desktop.png' })
  await reopen(); await render('settings')
  await actOnUi(() => page.getByRole('tab', { name: '等级结构' }).click())
  await expect.element(page.getByRole('textbox', { name: '大境界 2 名称' })).toHaveValue('筑基')
  expect(await invoke('db:cultivation-read')).toEqual(system)
  await page.viewport(380, 850)
  await page.screenshot({ path: '../../../../output/playwright/cultivation-settings-narrow.png' })
  expect(container.scrollWidth).toBeLessThanOrEqual(380)
  expect((await invoke<CharacterRosterSnapshot>('db:character-roster-read')).entries[0].currentState?.powerLevel).toBe('旧修为：筑基中期')
})

it('explicitly binds, crosses realm boundaries, validates numbers, clears and preserves free text', async () => {
  await seed(); await render('character')
  await expect.element(page.getByRole('button', { name: '提高一级' })).toBeDisabled()
  await actOnUi(() => page.getByRole('combobox', { name: '选择大境界' }).selectOptions('qi'))
  await actWithPendingUiIpc(() => page.getByRole('combobox', { name: '选择小境界' }).selectOptions('qi-2'))
  await expect.element(page.getByText('未保存：请保存角色档案', { exact: true })).toBeVisible()
  expect((await invoke<CharacterRosterSnapshot>('db:character-roster-read')).entries[0].cultivationLevelId).toBeUndefined()
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '提高一级' }).click())
  await expect.element(page.getByText('3 = 筑基', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: '提高一级' })).toBeDisabled()
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '降低一级' }).click())
  await expect.element(page.getByText('2 = 炼气·二层', { exact: true })).toBeVisible()
  for (const invalid of ['1.5', '-1', '4']) {
    await actOnUi(() => page.getByRole('textbox', { name: '等级序号' }).fill(invalid))
    await actOnUi(() => page.getByRole('button', { name: '应用等级' }).click())
    await expect.element(page.getByText('请输入 1–3 的整数等级')).toBeVisible()
  }
  await actOnUi(() => page.getByRole('textbox', { name: '等级序号' }).fill('1'))
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '应用等级' }).click())
  await expect.element(page.getByRole('button', { name: '降低一级' })).toBeDisabled()
  await page.screenshot({ path: '../../../../output/playwright/cultivation-character-overview.png' })
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '清除绑定' }).click())
  await expect.element(page.getByRole('button', { name: '提高一级' })).toBeDisabled()
  await reopen()
  const persisted = await invoke<CharacterRosterSnapshot>('db:character-roster-read')
  expect(persisted.entries[0].cultivationLevelId).toBeUndefined()
  expect(persisted.entries[0].currentState?.powerLevel).toBe('旧修为：筑基中期')
})

it('cancels preset replacement and impact resolution without writes, then atomically remaps the character', async () => {
  await seed()
  useCharacterStore.getState().updateField('沈砺', 'cultivationLevelId', 'qi-2')
  await actWithPendingUiIpc(() => useCharacterStore.getState().saveAll(session.projectPath, session))
  const before = await invoke('db:cultivation-read')
  await render('settings')
  await openLevelsTab()
  await actOnUi(() => page.getByRole('button', { name: '初期到圆满', exact: true }).click())
  await act(async () => {
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await new Promise(resolve => setTimeout(resolve, 250))
  })
  expect(await invoke('db:cultivation-read')).toEqual(before)
  expect(useCultivationStore.getState().dirty).toBe(false)
  await actOnUi(() => page.getByRole('button', { name: '初期到圆满', exact: true }).click())
  await act(async () => {
    await page.getByRole('button', { name: '替换', exact: true }).click()
    await new Promise(resolve => setTimeout(resolve, 250))
  })
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '保存力量体系', exact: true }).click())
  await expect.element(page.getByRole('dialog', { name: '处理受影响角色' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: '确认并原子保存' })).toBeDisabled()
  await actOnUi(() => page.getByRole('button', { name: '取消影响处理' }).click())
  expect(await invoke('db:cultivation-read')).toEqual(before)
  expect((await invoke<CharacterRosterSnapshot>('db:character-roster-read')).entries[0].cultivationLevelId).toBe('qi-2')
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '保存力量体系', exact: true }).click())
  await actOnUi(() => page.getByRole('combobox', { name: '沈砺 的新等级' }).selectOptions('foundation-base'))
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '确认并原子保存' }).click())
  await expect.element(page.getByText('等级与角色绑定已一并保存')).toBeVisible()
  await reopen()
  expect((await invoke<CharacterRosterSnapshot>('db:character-roster-read')).entries[0].cultivationLevelId).toBe('foundation-base')
  expect((await invoke<CultivationSystem>('db:cultivation-read')).realms[0].stages.map(stage => stage.name)).toEqual(['初期', '中期', '后期', '圆满'])
})

it('retains failed settings and profile edits, disables quick writes over a pending profile, and saves on retry', async () => {
  await seed(); await render('settings')
  await openLevelsTab()
  await actOnUi(() => page.getByRole('textbox', { name: '大境界 1 名称' }).fill('气海'))
  await commands.cultivationIpc('fixture:fail-save', true)
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '保存力量体系', exact: true }).click())
  await expect.element(page.getByRole('alert')).toHaveTextContent('Forced test save failure')
  await expect.element(page.getByRole('textbox', { name: '大境界 1 名称' })).toHaveValue('气海')
  expect((await invoke<CultivationSystem>('db:cultivation-read')).realms[0].name).toBe('炼气')
  await commands.cultivationIpc('fixture:fail-save', false)
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '保存力量体系', exact: true }).click())
  await expect.element(page.getByText('力量体系已保存', { exact: true })).toBeVisible()
  await render('character')
  await actOnUi(() => page.getByRole('textbox', { name: '等级序号' }).fill('2'))
  await actOnUi(() => page.getByRole('button', { name: '应用等级', exact: true }).click())
  expect(useCharacterStore.getState().characters[0].cultivationLevelId).toBe('qi-2')
  expect((await invoke<CharacterRosterSnapshot>('db:character-roster-read')).entries[0].cultivationLevelId).toBeUndefined()
  await act(async () => { useCharacterStore.getState().updateField('沈砺', 'notes', '尚未保存的作者备注') })
  await actOnUi(() => page.getByRole('button', { name: '返回概览', exact: true }).click())
  await expect.element(page.getByRole('button', { name: '提高一级' })).toBeDisabled()
  await expect.element(page.getByText('角色档案有未保存修改，请先保存或在编辑档案中调整等级。')).toBeVisible()
  await commands.cultivationIpc('fixture:fail-save', true)
  await actWithPendingUiIpc(() => useCharacterStore.getState().saveAll(session.projectPath, session).then(
    () => { throw new Error('Expected the simulated profile save to fail') },
    error => { expect(String(error)).toContain('Forced test save failure') },
  ))
  expect(useCharacterStore.getState().characters[0].notes).toBe('尚未保存的作者备注')
  await commands.cultivationIpc('fixture:fail-save', false)
  await actWithPendingUiIpc(() => useCharacterStore.getState().saveAll(session.projectPath, session))
  await reopen()
  const saved = (await invoke<CharacterRosterSnapshot>('db:character-roster-read')).entries[0]
  expect(saved.cultivationLevelId).toBe('qi-2'); expect(saved.notes).toBe('尚未保存的作者备注')
})

it('rebases atomic level migration into a renamed unsaved profile without overwriting other edits', async () => {
  await seed()
  useCharacterStore.getState().updateField('沈砺', 'cultivationLevelId', 'qi-2')
  await actWithPendingUiIpc(() => useCharacterStore.getState().saveAll(session.projectPath, session))
  await render('character')
  await actOnUi(() => page.getByRole('textbox', { name: '姓名', exact: true }).fill('沈砺改名'))
  await act(async () => { useCharacterStore.getState().updateField('沈砺改名', 'notes', '与等级迁移同时保留的草稿') })
  await render('settings')
  await openLevelsTab()
  await actOnUi(() => page.getByRole('button', { name: '删除大境界 1', exact: true }).click())
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '保存力量体系', exact: true }).click())
  await actOnUi(() => page.getByRole('combobox', { name: '沈砺 的新等级' }).selectOptions('foundation-base'))
  await actWithPendingUiIpc(() => page.getByRole('button', { name: '确认并原子保存' }).click())
  await expect.element(page.getByText('等级与角色绑定已一并保存')).toBeVisible()
  expect(useCharacterStore.getState().characters[0]).toMatchObject({ name: '沈砺改名', notes: '与等级迁移同时保留的草稿', cultivationLevelId: 'foundation-base' })
  await actWithPendingUiIpc(() => useCharacterStore.getState().saveAll(session.projectPath, session))
  await reopen()
  const saved = (await invoke<CharacterRosterSnapshot>('db:character-roster-read')).entries[0]
  expect(saved).toMatchObject({ name: '沈砺改名', notes: '与等级迁移同时保留的草稿', cultivationLevelId: 'foundation-base' })
})

it('applies a preset to every realm, resolves multiple affected characters, and verifies English dark UI and errors', async () => {
  await seed(); await addSecondBoundCharacter()
  await act(async () => { useLocaleStore.setState({ locale: 'en-US', initialized: true }) })
  document.documentElement.dataset.theme = 'starlight-dark'
  document.documentElement.classList.add('dark')
  await render('settings')
  await openLevelsTab()
  await page.screenshot({ path: '../../../../output/playwright/cultivation-settings-dark.png' })
  expect(getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim()).not.toBe('')
  await expect.element(page.getByRole('heading', { name: 'Power system' })).toBeVisible()
  await act(async () => { await page.getByRole('checkbox', { name: 'Apply to all realms' }).click() })
  // The preset action leaves its confirmation pending; scope act to the trigger,
  // then settle the separate dialog in a second step.
  await act(async () => { await page.getByRole('button', { name: 'Early to perfection', exact: true }).click() })
  await expect.element(page.getByRole('dialog', { name: 'Replace stages' })).toBeVisible()
  await act(async () => {
    await page.getByRole('button', { name: 'Replace', exact: true }).click()
    await new Promise(resolve => setTimeout(resolve, 250))
  })
  await actOnUi(() => page.getByText('Complete level preview', { exact: true }).click())
  await expect.element(page.getByText('8 = 筑基·圆满', { exact: true })).toBeVisible()
  expect(useCultivationStore.getState().realms.map(realm => realm.stages.map(stage => stage.name))).toEqual([
    ['初期', '中期', '后期', '圆满'], ['初期', '中期', '后期', '圆满'],
  ])
  await actWithPendingUiIpc(() => page.getByRole('button', { name: 'Save power system', exact: true }).click())
  await expect.element(page.getByRole('dialog', { name: 'Resolve affected characters' })).toBeVisible()
  const saveTogether = page.getByRole('button', { name: 'Confirm and save together', exact: true })
  await expect.element(saveTogether).toBeDisabled()
  const replacementStages = useCultivationStore.getState().realms[0]!.stages
  await act(async () => { await page.getByRole('combobox', { name: 'Replacement level for 沈砺' }).selectOptions(replacementStages[0]!.id) })
  await expect.element(saveTogether).toBeDisabled()
  await act(async () => { await page.getByRole('combobox', { name: 'Replacement level for 顾衡' }).selectOptions(replacementStages[1]!.id) })
  await expect.element(saveTogether).toBeEnabled()
  await actWithPendingUiIpc(() => saveTogether.click())
  await expect.element(page.getByText('Levels and character bindings saved together', { exact: true })).toBeVisible()
  const savedSystem = await invoke<CultivationSystem>('db:cultivation-read')
  const savedRoster = await invoke<CharacterRosterSnapshot>('db:character-roster-read')
  expect(savedRoster.entries.find(entry => entry.name === '沈砺')?.cultivationLevelId).toBe(savedSystem.realms[0]!.stages[0]!.id)
  expect(savedRoster.entries.find(entry => entry.name === '顾衡')?.cultivationLevelId).toBe(savedSystem.realms[0]!.stages[1]!.id)
  await render('character')
  await expect.element(page.getByText('1 = 炼气·初期', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Next level' })).toBeEnabled()
  await reopen(); await render('character')
  await expect.element(page.getByText('1 = 炼气·初期', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Next level' })).toBeEnabled()
  await page.screenshot({ path: 'output/cultivation-settings-english-dark.png' })

  await render('settings')
  await openLevelsTab()
  await act(async () => { await page.getByRole('textbox', { name: 'Realm 1 name' }).fill('气海') })
  await commands.cultivationIpc('fixture:fail-save', true)
  await actWithPendingUiIpc(() => page.getByRole('button', { name: 'Save power system', exact: true }).click())
  await expect.element(page.getByRole('alert')).toHaveTextContent('Forced test save failure')
  await expect.element(page.getByRole('textbox', { name: 'Realm 1 name' })).toHaveValue('气海')
})
