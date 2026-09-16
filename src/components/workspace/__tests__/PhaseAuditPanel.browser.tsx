import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhaseAuditPanel from '../PhaseAuditPanel'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { phase3To8Service } from '../../../services/phase3-8-service'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const originalLocale = useLocaleStore.getState(); const originalProject = useProjectStore.getState()
let root: Root; let container: HTMLDivElement
beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true }); useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as never })
  vi.spyOn(phase3To8Service, 'auditChapter').mockResolvedValue({ runId: 'run-1', findings: [{ findingId: 'f-1', runId: 'run-1', projectId: 'main', severity: 'high', ruleCode: 'P4-FR-002', status: 'open', location: { chapter: 31 }, evidence: [], explanation: '角色状态冲突', suggestion: '检查回忆场景', createdAt: '' }] })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(<PhaseAuditPanel />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); useLocaleStore.setState(originalLocale, true); useProjectStore.setState(originalProject, true) })
describe('PhaseAuditPanel browser acceptance', () => {
  it('runs a chapter audit and renders a sourced finding summary', async () => {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, '林越出现')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('运行审核')) as HTMLButtonElement; await act(async () => button.click())
    expect(container.textContent).toContain('P4-FR-002'); expect(container.textContent).toContain('角色状态冲突')
  })
})
