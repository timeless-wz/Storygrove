/**
 * CharactersView — 角色管理列表视图
 */

import { useState } from 'react'
import { Users, RefreshCw, Plus, Search, X } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useCharacterStore, type CharacterCard } from '../../../stores/character-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { EmptyState } from '../../ui/EmptyState'
import { cn } from '../../../lib/utils'
import { useLocaleStore } from '../../../stores/locale-store'
import { getCharacterRoleLabels } from '../../../shared/character-role'
import {
  CHARACTER_STATE_FIELD_LABELS,
  selectCharacterStateSummary,
  truncateProfileText,
} from '../../../shared/character-profile-presentation'
import { CharacterCardImportButton } from '../../characters/CharacterCardImportButton'
import CharacterCreateDialog from '../../characters/CharacterCreateDialog'
import { characterRoleColors } from '../../characters/character-role-colors'

/**
 * 列表里的一行有用摘要：先讲“在哪、刚发生什么”，只在确实有更新章节时
 * 才补一行章节信息，避免每条都显示“第0章更新”。
 */
function CharacterStateSummary({ card }: { card: CharacterCard }) {
  const text = useLocaleStore(s => s.text)
  const summary = selectCharacterStateSummary(card.currentState)
  const chapter = card.currentState?.updatedAtChapter ?? 0
  if (!summary && chapter <= 0) return null
  return (
    <div className="mt-0.5 space-y-0.5">
      {summary && (
        <div className="text-[0.65rem] opacity-60" data-testid="character-state-summary">
          <span className="opacity-70">
            {text(
              `${CHARACTER_STATE_FIELD_LABELS[summary.field].shortZhCN}：`,
              `${CHARACTER_STATE_FIELD_LABELS[summary.field].shortEnUS}: `,
            )}
          </span>
          {truncateProfileText(summary.value, 32)}
        </div>
      )}
      {chapter > 0 && (
        <div className="text-[0.65rem] opacity-50">
          {text(`第${chapter}章更新`, `Updated in chapter ${chapter}`)}
        </div>
      )}
    </div>
  )
}

export default function CharactersView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const dataProjectKey = useCharacterStore(s => s.dataProjectKey)
  const loadingProjectKey = useCharacterStore(s => s.loadingProjectKey)
  const selectedName = useCharacterStore(s => s.selectedName)
  const load = useCharacterStore(s => s.load)
  const setSelectedName = useCharacterStore(s => s.setSelectedName)
  const addCharacter = useCharacterStore(s => s.addCharacter)
  const identityBusy = useCharacterStore(s => s.identityBusy)
  const lastError = useCharacterStore(s => s.lastError)
  const text = useLocaleStore(s => s.text)
  const roleLabel = (role: unknown) => {
    const { zhCN, enUS } = getCharacterRoleLabels(role)
    return text(zhCN, enUS)
  }
  const dataReady = Boolean(
    currentProject
    && dataProjectKey === currentProject.path
    && loadingProjectKey === null
    && lastError === null,
  )
  const visibleCharacters = dataReady ? characters : []
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const filteredCharacters = normalizedQuery
    ? visibleCharacters.filter(character => character.name.toLocaleLowerCase().includes(normalizedQuery))
    : visibleCharacters

  // 角色数据由 ProjectService 统一加载，组件只消费 store 数据

  if (!currentProject) {
    return (
      <EmptyState 
        icon={<Users size={36} />} 
        message={text('请先打开项目', 'Open a project first')}
        className="pb-[15vh]" 
        opacity={0.4} 
      />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-3 h-8.5 flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-sidebar)]">
        <span className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
          <Users size={12} className="text-[var(--color-text-muted)]" />
          <span>{text(`角色列表（${visibleCharacters.length}）`, `Characters (${visibleCharacters.length})`)}</span>
        </span>
        <div className="flex items-center gap-0.5">
          <CharacterCardImportButton projectKey={currentProject.path} compact disabled={identityBusy || !dataReady} />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 active:scale-[0.96] transition-transform text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            onClick={() => load(currentProject.path)}
            disabled={identityBusy || loadingProjectKey !== null}
            title={text('刷新列表', 'Refresh list')}
          >
            <RefreshCw size={13} strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 active:scale-[0.96] transition-transform text-[var(--color-accent)] hover:text-[var(--color-accent)]"
            onClick={() => setCreateOpen(true)}
            disabled={identityBusy || !dataReady}
            title={text('新建角色', 'New character')}
            aria-label={text('新建角色', 'New character')}
          >
            <Plus size={14} strokeWidth={2} />
          </Button>
        </div>
      </div>
      <div className="relative px-2 py-1.5 border-b border-[var(--color-border)]">
        <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
        <Input
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          aria-label={text('搜索角色', 'Search characters')}
          placeholder={text('搜索角色名称', 'Search character names')}
          className="h-7 pl-7 pr-7 text-xs"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            aria-label={text('清除搜索', 'Clear search')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {/* 角色列表 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {filteredCharacters.map((c) => {
          const roleStyle = characterRoleColors(c.role)
          const initial = c.name?.trim() ? c.name.trim().charAt(0) : '?'
          const isSelected = selectedName === c.name
          return (
            <div
              key={c.name}
              className={cn(
                'flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-all duration-150',
                isSelected
                  ? 'bg-[var(--color-active)] text-[var(--color-text)] shadow-xs border-l-2 border-l-[var(--color-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]'
              )}
              onClick={() => setSelectedName(c.name)}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs border flex-shrink-0 select-none mt-0.5 shadow-xs"
                style={roleStyle}
              >
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold truncate text-[var(--color-text)]">
                    {c.name || text('未命名', 'Untitled')}
                  </span>
                  <span
                    className="text-[9px] px-1.5 py-0.2 rounded-full font-medium border flex-shrink-0"
                    style={roleStyle}
                  >
                    {roleLabel(c.role)}
                  </span>
                </div>
                <CharacterStateSummary card={c} />
              </div>
            </div>
          )
        })}
        {visibleCharacters.length === 0 && (
          <div className="text-center py-6 opacity-50 text-xs">
            {lastError
                ? text(`角色列表读取失败：${lastError}`, 'Could not load character list.')
              : text('暂无角色', 'No characters')}
          </div>
        )}
        {visibleCharacters.length > 0 && filteredCharacters.length === 0 && (
          <div className="text-center py-6 opacity-50 text-xs">
            {text('没有匹配的角色', 'No matching characters')}
          </div>
        )}
      </div>
      <CharacterCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingNames={visibleCharacters.map(character => character.name)}
        create={addCharacter}
        onCreated={() => {
          // 创建后直接进入可编辑档案，不先落到只读概览。
          useLayoutStore.getState().openCharacterProfile('edit')
        }}
      />
    </div>
  )
}
