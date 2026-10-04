import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

it('preserves complete workflow titles in Chinese and English completion notifications', () => {
  const source = ts.createSourceFile('App.tsx', readFileSync(resolve('src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)
      && node.expression.getText(source) === 'globalEventBus.on'
      && node.arguments[0]?.getText(source) === "'WORKFLOW_COMPLETE'") {
      handler = node.arguments[1]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(handler).toBeDefined()
  const workflowComplete = vi.fn()
  const completedRun = { id: 'run-1', title: '' }
  let english = false
  // Execute the actual App event handler without mounting unrelated application panels.
  const notify = runInNewContext(`(${handler!.getText(source)})`, {
    sameProjectSessionContext: () => true,
    projectSessionContextFromProject: () => ({}),
    useProjectStore: { getState: () => ({ currentProject: {} }) },
    useWorkflowStore: { getState: () => ({ activeRuns: [], history: [completedRun] }) },
    useLocaleStore: { getState: () => ({ text: (zh: string, en: string) => english ? en : zh }) },
    actionToast: { workflowComplete },
  })

  for (const title of [
    '续写章节蓝图（从第 1 章）',
    'AI 生成小说配置',
    '写稿 — 第 1 章 · 初遇',
    'Continue chapter blueprints (from chapter 1)',
    'Apply review — Chapter 2 A New Term',
  ]) {
    completedRun.title = title
    for (english of [false, true]) {
      notify({ projectSession: {}, runId: completedRun.id })
      expect(workflowComplete).toHaveBeenLastCalledWith(
        english ? `“${title}” completed` : `「${title}」已完成`,
        expect.any(Function),
      )
    }
  }
})

it('opens the basic settings overview from architecture completion and falls back to the task when its project session changed', () => {
  const source = ts.createSourceFile('App.tsx', readFileSync(resolve('src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)
      && node.expression.getText(source) === 'globalEventBus.on'
      && node.arguments[0]?.getText(source) === "'WORKFLOW_COMPLETE'") {
      handler = node.arguments[1]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(handler).toBeDefined()

  const projectPath = 'C:\\novels\\overview'
  const projectSession = { projectId: 'overview', leaseId: 'lease-1', projectPath }
  let currentProject = { path: projectPath, projectSession }
  const completedRun = {
    id: 'architecture-run',
    title: 'Generate story settings',
    type: 'architecture_generation',
    projectPath,
    projectSession,
  }
  const workflowComplete = vi.fn()
  const openFile = vi.fn()
  const openBottomTab = vi.fn()
  const notify = runInNewContext(`(${handler!.getText(source)})`, {
    sameProjectSessionContext: (left: unknown, right: unknown) => left === right,
    projectSessionContextFromProject: (project: typeof currentProject) => project.projectSession,
    useProjectStore: { getState: () => ({ currentProject }) },
    useWorkflowStore: { getState: () => ({ activeRuns: [], history: [completedRun] }) },
    useLocaleStore: { getState: () => ({ text: (zh: string) => zh }) },
    useEditorStore: { getState: () => ({ openFile }) },
    useLayoutStore: { getState: () => ({ openBottomTab }) },
    actionToast: { workflowComplete },
  })

  notify({ projectSession, runId: completedRun.id })
  expect(workflowComplete).toHaveBeenCalledWith(
    '「Generate story settings」已完成',
    expect.any(Function),
    '打开基础设定总览',
  )
  const openOverview = workflowComplete.mock.calls[0][1] as () => void
  openOverview()
  expect(openFile).toHaveBeenCalledWith(expect.objectContaining({
    id: 'world-building',
    name: '基础设定总览',
    type: 'world-building',
    projectKey: projectPath,
    projectSessionLease: projectSession.leaseId,
  }))
  expect(openBottomTab).not.toHaveBeenCalled()

  currentProject = {
    path: 'C:\\novels\\other',
    projectSession: { ...projectSession, leaseId: 'lease-2' },
  }
  openOverview()
  expect(openBottomTab).toHaveBeenCalledWith('tasks')
  expect(openFile).toHaveBeenCalledTimes(1)
})
