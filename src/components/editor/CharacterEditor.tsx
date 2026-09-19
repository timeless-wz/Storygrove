import { useEffect, useRef, useState } from 'react'
import { Save, Trash2, Users, Network, PencilLine, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { registerEditorExitSaveHandler } from '../../stores/editor-store'
import { useLayoutStore, type CharacterProfileView } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { confirm } from '../ui/Confirm'
import {
  useCharacterStore,
  type CharacterCard,
} from '../../stores/character-store'
import RelationshipGraph from './RelationshipGraph'
import CharacterProfileOverview from './character-profile/CharacterProfileOverview'
import CharacterProfileForm from './character-profile/CharacterProfileForm'
import { EmptyState as BaseEmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'
import { useLocaleStore } from '../../stores/locale-store'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../project-session-gate'
import {
  canExplicitlyRepairCharacterRoster,
  getCharacterRosterRepairPresentation,
} from './character-roster-repair-state'
import { useCharacterRosterRepair } from './use-character-roster-repair'

/**
 * 角色档案 — 唯一的角色入口。
 *
 * 默认是概览（摘要 + 优先字段 + 折叠细节），完整字段留在显式的“编辑档案”里；
 * 关系图谱只是角色名单的只读投影，不持有任何角色事实。
 */
export default function CharacterEditor({ projectKey }: { projectKey: string }) {
  const currentProject = useProjectStore(s => s.currentProject)
  const addLog = useWorkflowStore(s => s.addLog)
  const characters = useCharacterStore(s => s.characters)
  const dataProjectKey = useCharacterStore(s => s.dataProjectKey)
  const loadingProjectKey = useCharacterStore(s => s.loadingProjectKey)
  const lastError = useCharacterStore(s => s.lastError)
  const selectedName = useCharacterStore(s => s.selectedName)
  const setSelectedName = useCharacterStore(s => s.setSelectedName)
  const saving = useCharacterStore(s => s.saving)
  const identityBusy = useCharacterStore(s => s.identityBusy)
  const renameCharacter = useCharacterStore(s => s.renameCharacter)
  const updateField = useCharacterStore(s => s.updateField)
  const deleteCharacter = useCharacterStore(s => s.deleteCharacter)
  const clearAllCharacters = useCharacterStore(s => s.clearAllCharacters)
  const saveAll = useCharacterStore(s => s.saveAll)
  const [localViewMode, setLocalViewMode] = useState<CharacterProfileView>('overview')
  const text = useLocaleStore(s => s.text)
  const projectMatches = currentProject?.path === projectKey
  const dataReady = Boolean(
    projectMatches
    && dataProjectKey === projectKey
    && loadingProjectKey === null
    && lastError === null,
  )

  /*
   * 角色档案是唯一的角色入口；旧标签页、旧路由或旧项目可能请求直接落到某个
   * 内部视图（尤其是“关系图谱”）。请求在作者于本页手动切换视图前一直生效，
   * 因此这里用派生值而不是 effect 同步，避免额外的一次级联渲染。
   */
  const characterViewRequest = useLayoutStore(s => s.characterViewRequest)
  const [dismissedViewRequestId, setDismissedViewRequestId] = useState<number | null>(null)
  const requestedView = characterViewRequest && characterViewRequest.requestId !== dismissedViewRequestId
    ? characterViewRequest.view
    : null
  const viewMode: CharacterProfileView = requestedView ?? localViewMode
  const setViewMode = (next: CharacterProfileView) => {
    if (characterViewRequest) setDismissedViewRequestId(characterViewRequest.requestId)
    setLocalViewMode(next)
  }

  // 旧项目可能只有 Markdown 角色图谱而没有角色卡；修复入口随角色入口一起收敛到这里。
  const {
    snapshot: rosterSnapshot,
    repairError: rosterRepairError,
    isRepairing: repairingRoster,
    refresh: loadRosterStatus,
    migrate: repairRoster,
  } = useCharacterRosterRepair({ projectKey, enabled: projectMatches })
  const rosterPresentation = getCharacterRosterRepairPresentation(
    rosterSnapshot,
    text,
    rosterRepairError,
  )
  const canRepairRoster = canExplicitlyRepairCharacterRoster(rosterPresentation)

  // 数据由 ProjectService 统一加载，组件只消费 store 数据

  const selectedCard = dataReady
    ? characters.find((c) => c.name === selectedName) || null
    : null

  const handleDelete = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!selectedCard || !projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const ok = await confirm(
      text(`确定要删除角色「${selectedCard.name || '未命名'}」吗？此操作不可撤销。`, `Delete character “${selectedCard.name || 'Untitled'}”? This cannot be undone.`),
      { title: text('删除角色', 'Delete character'), confirmText: text('删除', 'Delete'), danger: true }
    )
    if (!ok || !isProjectSessionCurrent(projectSession)) return
    const deleted = await deleteCharacter(selectedCard.name, projectKey)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!deleted) {
      addLog(
        'error',
        text(
          '角色删除失败：项目可能已切换，请刷新后重试',
          'Could not delete the character. The project may have changed; refresh and try again.',
        ),
      )
    }
  }

  const handleSave = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    try {
      await saveAll(projectKey)
      if (!isProjectSessionCurrent(projectSession)) return
      addLog('info', text(`已保存 ${characters.length} 个角色卡`, `Saved ${characters.length} character cards`))
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      addLog('error', text(`角色卡保存失败：${error}`, 'Could not save character cards.'))
    }
  }

  const exitSaveRef = useRef(handleSave)
  useEffect(() => {
    exitSaveRef.current = handleSave
  })
  useEffect(() => {
    registerEditorExitSaveHandler({
      type: 'character',
      projectKey,
      save: () => exitSaveRef.current(),
    })
  }, [projectKey])

  const handleDeleteAllCharacters = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (
      !dataReady
      || characters.length === 0
      || !projectSession
      || !isProjectSessionPath(projectSession, projectKey)
    ) return
    const ok = await confirm(
      text(
        `确定删除全部 ${characters.length} 个角色及其关系吗？角色图谱是角色名单的投影，无法单独清空。此操作不可撤销。`,
        `Delete all ${characters.length} characters and their relationships? The graph is a projection of the roster and cannot be cleared independently. This cannot be undone.`,
      ),
      {
        title: text('删除全部角色与关系', 'Delete all characters and relationships'),
        confirmText: text('确认删除全部', 'Delete all'),
        danger: true,
      },
    )
    if (!ok || !isProjectSessionCurrent(projectSession)) return
    const cleared = await clearAllCharacters(projectKey, projectSession)
    if (!isProjectSessionCurrent(projectSession)) return
    addLog(
      cleared ? 'info' : 'error',
      cleared
        ? text('已删除全部角色及关系', 'Deleted all characters and relationships')
        : text('删除全部角色失败，请刷新后重试', 'Could not delete all characters. Refresh and try again.'),
    )
  }

  const updateCurrentField = <K extends Exclude<keyof CharacterCard, 'name'>>(
    name: string,
    key: K,
    value: CharacterCard[K],
  ) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    updateField(name, key, value)
  }

  const renameCurrentCharacter = (name: string, nextName: string) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    renameCharacter(name, nextName)
  }

  /** 关系行与图谱节点都只是“选中并打开”某张已有角色卡的入口。 */
  const openCharacterCard = (name: string) => {
    setSelectedName(name)
    setViewMode('overview')
  }

  // ===== 渲染 =====

  if (!projectMatches) {
    return (
      <BaseEmptyState
        icon={<Users size={36} />}
        message={text('此标签属于另一个项目，请切回原项目后继续。', 'This tab belongs to another project. Switch back to continue.')}
        opacity={0.4}
      />
    )
  }

  const viewTitle = viewMode === 'graph'
    ? text('角色档案 — 关系图谱（只读投影）', 'Character profile — relationship graph (read-only projection)')
    : selectedCard
      ? `${selectedCard.name || text('新角色', 'New character')} ${viewMode === 'edit' ? text('— 编辑档案', '— Edit profile') : text('— 人物概览', '— Character overview')}`
      : text('角色档案', 'Character profile')

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* 统一顶部工具栏 */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
            {viewTitle}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {viewMode === 'graph' ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAllCharacters}
                disabled={identityBusy || !dataReady || characters.length === 0}
                title={text('清空图谱会删除作为事实源的全部角色', 'Clearing the graph deletes every character in the source roster')}
              >
                <Trash2 size={12} /> {text('删除全部角色与关系', 'Delete all characters and relationships')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setViewMode('overview')} title={text('返回人物档案', 'Back to the character profile')}>
                <Users size={12} /> {text('返回档案', 'Back to profile')}
              </Button>
            </>
          ) : selectedCard ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title={text('查看全员关系网', 'View all character relationships')}>
                <Network size={12} /> {text('关系图谱', 'Relationship graph')}
              </Button>
              {viewMode === 'edit' ? (
                <Button variant="outline" size="sm" onClick={() => setViewMode('overview')} title={text('返回人物概览', 'Back to the character overview')}>
                  <Check size={12} /> {text('完成', 'Done')}
                </Button>
              ) : (
                <Button variant="default" size="sm" onClick={() => setViewMode('edit')} title={text('编辑全部角色字段', 'Edit every character field')}>
                  <PencilLine size={12} /> {text('编辑档案', 'Edit profile')}
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={identityBusy || !dataReady}>
                <Trash2 size={12} /> {text('删除', 'Delete')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSave} disabled={identityBusy || !dataReady}>
                <Save size={12} /> {saving ? text('保存中...', 'Saving...') : text('保存', 'Save')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title={text('查看全员关系网', 'View all character relationships')}>
              <Network size={12} /> {text('关系图谱', 'Relationship graph')}
            </Button>
          )}
        </div>
      </div>

      {/* 旧项目安全修复：角色档案是唯一入口，修复动作始终由作者显式触发。 */}
      {rosterPresentation
        && rosterPresentation.kind !== 'ready'
        && rosterPresentation.kind !== 'empty' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs flex-shrink-0"
          style={{
            color: 'var(--color-warning-text)',
            backgroundColor: 'var(--color-editor-bg)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <AlertTriangle size={13} className="flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <strong>{rosterPresentation.label}</strong> · {rosterPresentation.description}
          </span>
          {canRepairRoster && rosterPresentation.actionLabel && (
            <Button
              size="sm"
              disabled={repairingRoster}
              onClick={() => { void repairRoster() }}
              title={rosterPresentation.actionTitle}
            >
              {repairingRoster
                ? <RefreshCw size={12} className="animate-spin" />
                : <AlertTriangle size={12} />}
              {repairingRoster ? text('处理中…', 'Working…') : rosterPresentation.actionLabel}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { void loadRosterStatus() }}>
            <RefreshCw size={12} /> {text('刷新状态', 'Refresh status')}
          </Button>
        </div>
      )}

      {viewMode === 'graph' && (
        <div
          role="note"
          className="px-3 py-1.5 text-[11px] flex-shrink-0"
          style={{
            color: 'var(--color-text-secondary)',
            backgroundColor: 'var(--color-editor-bg)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {text(
            '关系图谱由角色档案推导，只读展示。点击节点会打开对应人物卡，修改关系请切回「编辑档案」。',
            'The relationship graph is derived from character profiles and is read-only. Clicking a node opens that character card; switch back to Edit profile to change relationships.',
          )}
        </div>
      )}

      {/* 主体区 */}
      <div className="flex-1 overflow-y-auto relative">
        {viewMode === 'graph' ? (
          <RelationshipGraph
            characters={characters}
            projectKey={projectKey}
            onCharacterSelect={openCharacterCard}
          />
        ) : !selectedCard ? (
          <BaseEmptyState
            icon={<Users size={36} />}
            message={lastError
              ? text(`角色卡读取失败：${lastError}`, `Could not load character cards: ${lastError}`)
              : (currentProject ? text('在左侧选择或创建角色卡', 'Select or create a character card on the left') : text('请先打开项目', 'Open a project first'))}
            opacity={currentProject ? 0.3 : 0.4}
          />
        ) : (
          viewMode === 'edit' ? (
            <CharacterProfileForm
              key={selectedCard.name}
              card={selectedCard}
              characters={characters}
              identityBusy={identityBusy}
              onRename={(nextName) => renameCurrentCharacter(selectedCard.name, nextName)}
              onUpdateField={(key, value) => updateCurrentField(selectedCard.name, key, value)}
            />
          ) : (
            <CharacterProfileOverview
              card={selectedCard}
              characters={characters}
              onOpenCharacter={openCharacterCard}
            />
          )
        )}
      </div>
    </div>
  )
}
