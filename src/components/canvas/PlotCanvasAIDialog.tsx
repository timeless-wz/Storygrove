import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

import type { DatabaseChannels } from '../../shared/ipc-channels'
import type { PlotCanvasGraph } from '../../shared/plot-canvas'
import { useLLMStore } from '../../stores/llm-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../project-session-gate'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { Textarea } from '../ui/Textarea'
import { buildPlotCanvasAIProposal, type PlotCanvasAIMode, type PlotCanvasAIProposal } from './plot-canvas-ai-proposal'
import { createPlotCanvasAIMessages } from './plot-canvas-ai-prompt'
import './plot-shell/plot-shell.css'

type Blueprint = DatabaseChannels['db:blueprint-get-all']['return'][number]

interface Props {
  mode: PlotCanvasAIMode
  graph: PlotCanvasGraph
  blueprints: Blueprint[]
  projectKey: string
  hasPendingWrites: boolean
  onClose: () => void
  onApplied: (graph: PlotCanvasGraph) => void
}

export function PlotCanvasAIDialog({ mode, graph, blueprints, projectKey, hasPendingWrites, onClose, onApplied }: Props) {
  const text = useLocaleStore(s => s.text)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const initModels = useLLMStore(s => s.init)
  const generate = useLLMStore(s => s.generate)
  const generationModels = models.filter(model => model.purposes.includes('generation'))
  const modelId = generationModels.some(model => model.id === defaultModelId)
    ? defaultModelId : generationModels[0]?.id ?? null
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState<PlotCanvasAIProposal | null>(null)
  const [history, setHistory] = useState<Array<{ instruction: string; explanation: string }>>([])
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const chosenModelId = selectedModelId ?? modelId

  useEffect(() => {
    void initModels().catch(() => setError(text('加载模型配置失败', 'Could not load model settings')))
  }, [initModels, text])

  const requestProposal = async () => {
    const project = useProjectStore.getState().currentProject
    const session = captureProjectSession(project)
    const request = instruction.trim() || (mode === 'initialize'
      ? text('请根据现有创作规划构建一版可编辑的剧情事件与关系。', 'Build editable plot events and links from the current writing plan.')
      : '')
    if (!project || !session || !isProjectSessionPath(session, projectKey)
      || !chosenModelId || !request || busy) return
    if (hasPendingWrites) {
      setError(text('请先保存或重试当前画布改动，再生成 AI 候选。', 'Save or retry pending canvas changes before generating an AI proposal.'))
      return
    }
    setBusy(true)
    setProposal(null)
    setError('')
    try {
      const savedGraph = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-graph-get', graph.canvas.id, projectKey)
      if (!isProjectSessionCurrent(session)) return
      const response = await generate(createPlotCanvasAIMessages({
        mode, instruction: request, graph: savedGraph, project, blueprints, history,
      }), chosenModelId, {
        purpose: 'plot-canvas',
        reasoningStage: 'planning',
        responseFormat: { type: 'json_object' },
        maxTokens: 3500,
        projectSession: session,
      })
      if (!isProjectSessionCurrent(session)) return
      if (!response.success) throw new Error(response.error || text('模型生成失败', 'Model generation failed'))
      setProposal(buildPlotCanvasAIProposal(
        response.content, savedGraph, mode, blueprints.map(item => item.chapterNumber),
      ))
    } catch (cause) {
      if (isProjectSessionCurrent(session)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setBusy(false)
    }
  }

  const applyProposal = async () => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session || !proposal || hasPendingWrites || applying) return
    setApplying(true)
    setError('')
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-graph-apply', {
        canvasId: graph.canvas.id,
        expectedNodes: proposal.expectedNodes,
        expectedEdges: proposal.expectedEdges,
        desiredNodes: proposal.desiredNodes,
        desiredEdges: proposal.desiredEdges,
      }, projectKey)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success || !result.graph) throw new Error(result.error || text('无法保存画布候选', 'Could not save canvas proposal'))
      onApplied(result.graph)
      setHistory(previous => [...previous, {
        instruction: instruction.trim() || text('初始化画布', 'Initialize canvas'),
        explanation: proposal.explanation,
      }])
      setProposal(null)
      setInstruction('')
    } catch (cause) {
      if (isProjectSessionCurrent(session)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isProjectSessionCurrent(session)) setApplying(false)
    }
  }

  const addedTitles = proposal?.desiredNodes
    .filter(node => !proposal.expectedNodes.some(old => old.id === node.id))
    .map(node => node.title) ?? []
  const removedTitles = proposal?.expectedNodes
    .filter(node => !proposal.desiredNodes.some(next => next.id === node.id))
    .map(node => node.title) ?? []

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy && !applying) onClose() }}>
      <DialogContent className="plot-canvas-ai-dialog" data-testid="plot-canvas-ai-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles size={17} />{mode === 'initialize'
            ? text('AI 构建剧情画布', 'Build plot canvas with AI')
            : text('与画布对话', 'Talk to the canvas')}</DialogTitle>
          <DialogDescription>{text(
            '当前模型会接收创作纲要、设定、章节蓝图摘要与画布内容。生成结果先供你预览，确认后才写入此画布；不会改动正文或蓝图。',
            'The selected external model receives your outline, setting, blueprint summaries, and canvas. Review the proposal before saving; prose and blueprints are untouched.',
          )}</DialogDescription>
        </DialogHeader>
        <div className="plot-canvas-ai-dialog__body">
          <label className="block">
            <Label htmlFor="plot-canvas-ai-model">{text('本次使用的生成模型', 'Generation model for this request')}</Label>
            <NativeSelect id="plot-canvas-ai-model" value={chosenModelId ?? ''}
              onChange={event => setSelectedModelId(event.target.value || null)} disabled={busy || applying}>
              <option value="" disabled>{text('请选择已配置模型', 'Select a configured model')}</option>
              {generationModels.map(model => <option key={model.id} value={model.id}>{model.name || model.modelName}</option>)}
            </NativeSelect>
          </label>
          {generationModels.length === 0 && <p role="alert" className="plot-canvas-ai-dialog__error">{text(
            '尚未配置可生成文本的外部模型，请先到设置中添加模型。',
            'No external text generation model is configured. Add one in Settings first.',
          )}</p>}
          {history.length > 0 && <ol className="plot-canvas-ai-dialog__history" aria-label={text('已应用的画布对话', 'Applied canvas conversation')}>
            {history.map((turn, index) => <li key={index}><strong>{turn.instruction}</strong><span>{turn.explanation}</span></li>)}
          </ol>}
          <label className="block">
            <Label htmlFor="plot-canvas-ai-instruction">{mode === 'initialize'
              ? text('希望这版剧情侧重什么（选填）', 'What should this plot emphasize? (optional)')
              : text('告诉 AI 要如何修改画布', 'Tell AI how to change the canvas')}</Label>
            <Textarea id="plot-canvas-ai-instruction" rows={3} value={instruction}
              onChange={event => { setInstruction(event.target.value); setProposal(null) }}
              disabled={busy || applying} maxLength={1500}
              placeholder={mode === 'initialize'
                ? text('例如：突出主角发现铜牌后的三次抉择', 'For example: focus on the protagonist’s three choices after finding the token')
                : text('例如：把“发现铜牌”拆为两个事件，并连接到“追查线索”', 'For example: split “Find the token” into two events and connect them to “Investigate”')} />
          </label>
          {error && <p role="alert" className="plot-canvas-ai-dialog__error">{error}</p>}
          {proposal && <section className="plot-canvas-ai-dialog__preview" data-testid="plot-canvas-ai-preview">
            <h3>{text('待确认的画布变更', 'Proposed canvas changes')}</h3>
            {proposal.explanation && <p>{proposal.explanation}</p>}
            <p>{text(
              `事件：新增 ${proposal.addedNodes}、修改 ${proposal.changedNodes}、删除 ${proposal.removedNodes}；连线：新增 ${proposal.addedEdges}、修改 ${proposal.changedEdges}、删除 ${proposal.removedEdges}`,
              `Events: +${proposal.addedNodes}, edited ${proposal.changedNodes}, removed ${proposal.removedNodes}; links: +${proposal.addedEdges}, edited ${proposal.changedEdges}, removed ${proposal.removedEdges}`,
            )}</p>
            {addedTitles.length > 0 && <p>{text('新增：', 'Add: ')}{addedTitles.join('、')}</p>}
            {removedTitles.length > 0 && <p className="plot-canvas-ai-dialog__error">{text('将删除：', 'Will remove: ')}{removedTitles.join('、')}</p>}
            {hasPendingWrites && <p role="alert">{text('请先保存或重试当前画布改动，再应用 AI 候选。', 'Save or retry pending canvas changes before applying this proposal.')}</p>}
          </section>}
        </div>
        <DialogFooter className="plot-canvas-ai-dialog__footer">
          <Button variant="ghost" disabled={busy || applying} onClick={onClose}>{text('关闭', 'Close')}</Button>
          {proposal && <Button variant="outline" disabled={busy || applying} onClick={() => setProposal(null)}>{text('放弃候选', 'Discard proposal')}</Button>}
          <Button variant="ai" disabled={!chosenModelId || hasPendingWrites || busy || applying || (mode === 'discuss' && !instruction.trim())}
            onClick={() => void requestProposal()}>{busy ? text('生成中…', 'Generating…') : text('生成候选', 'Generate proposal')}</Button>
          {proposal && <Button disabled={hasPendingWrites || busy || applying} onClick={() => void applyProposal()}>
            {applying ? text('保存中…', 'Saving…') : text('确认并应用', 'Review and apply')}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
