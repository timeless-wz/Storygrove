/**
 * BlueprintV2Editor — 章节蓝图 v2（细纲）的分区/分镜编辑视图。
 *
 * 纯编辑视图组件：内容与变更回调由 ChapterCardEditor 提供（草稿账本、保存、
 * IPC 都在上层）。布局遵循契约 §3 的七个 canonical 分区 + 未归类（custom）
 * 分区；分镜是 storyboard 分区内可排序、可增删的正式条目，正文用 Markdown
 * 逐字保存，不拆固定子字段。
 */

import { useMemo } from 'react'
import { ArrowDown, ArrowUp, GripVertical, ListPlus, Plus, SquarePen, Trash2 } from 'lucide-react'

import {
  BLUEPRINT_V2_CANONICAL_SECTIONS,
  createBlueprintV2ItemId,
  createBlueprintV2SceneId,
  getBlueprintV2Scenes,
  moveBlueprintV2Scene,
  type BlueprintV2BulletItem,
  type BlueprintV2CheckMode,
  type BlueprintV2FieldItem,
  type BlueprintV2Section,
  type BlueprintV2SectionItem,
  type BlueprintV2SectionId,
  type BlueprintChapterPlanning,
  type ChapterBlueprintV2Content,
} from '../../shared/blueprint-v2'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { createBusinessFieldDocumentIdentity } from '../../shared/document-editing'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { Textarea } from '../ui/Textarea'
import { confirm } from '../ui/Confirm'
import { cn } from '../../lib/utils'
import { captureProjectSession } from '../project-session-gate'
import DocumentEditingSurface from './DocumentEditingSurface'
import './chapter-blueprint-v2.css'

const SECTION_ICONS: Record<BlueprintV2SectionId, string> = {
  positioning: '◎',
  conflict: '⚔',
  storyboard: '🎬',
  rules: '⚗',
  cliffhanger: '⚡',
  foreshadow: '🧩',
  taboos: '⛔',
}

const CHECK_MODE_LABELS: Record<BlueprintV2CheckMode, [string, string]> = {
  must: ['必达', 'Must'],
  reference: ['参考', 'Reference'],
  forbid: ['禁写', 'Forbid'],
}

function textareaRows(markdown: string, min = 3, max = 22): number {
  const lines = markdown.split('\n').length
  return Math.max(min, Math.min(max, lines + 1))
}

export interface BlueprintV2EditorProps {
  content: ChapterBlueprintV2Content
  onChange(next: ChapterBlueprintV2Content): void
  /** 输入框失焦不触发保存；上层以受控 state + 账本持有未保存内容。 */
}

export default function BlueprintV2Editor({ content, onChange }: BlueprintV2EditorProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const documentProjectId = captureProjectSession(currentProject)?.projectId
    ?? currentProject?.id
    ?? `inactive:${currentProject?.path ?? 'blueprint-v2'}`

  const scenes = useMemo(() => getBlueprintV2Scenes(content), [content])
  const missingCanonicalSections = BLUEPRINT_V2_CANONICAL_SECTIONS.filter(entry => (
    !content.sections.some(section => section.kind === 'canonical' && section.id === entry.id)
  ))

  const patchSection = (sectionIndex: number, patch: Partial<Extract<BlueprintV2Section, { kind: 'canonical' }>>) => {
    const sections = content.sections.map((section, index) => (
      index === sectionIndex && section.kind === 'canonical' ? { ...section, ...patch } : section
    ))
    onChange({ ...content, sections })
  }

  const patchItem = (sectionIndex: number, itemId: string, patch: (item: BlueprintV2SectionItem) => BlueprintV2SectionItem) => {
    const section = content.sections[sectionIndex]
    if (!section || section.kind !== 'canonical') return
    const items = section.items.map(item => (item.id === itemId ? patch(item) : item))
    patchSection(sectionIndex, { items })
  }

  const patchCustomBody = (sectionIndex: number, body: string) => {
    const sections = content.sections.map((section, index) => (
      index === sectionIndex && section.kind === 'custom' ? { ...section, body } : section
    ))
    onChange({ ...content, sections })
  }

  const appendItem = (sectionIndex: number, item: BlueprintV2SectionItem) => {
    const section = content.sections[sectionIndex]
    if (!section || section.kind !== 'canonical') return
    patchSection(sectionIndex, { items: [...section.items, item] })
  }

  const moveScene = (_sectionIndex: number, sceneId: string, direction: -1 | 1) => {
    const currentOrder = scenes.findIndex(scene => scene.sceneId === sceneId) + 1
    const nextOrder = currentOrder + direction
    if (currentOrder <= 0 || nextOrder < 1 || nextOrder > scenes.length) return
    onChange(moveBlueprintV2Scene(content, sceneId, nextOrder))
  }

  const removeScene = async (sectionIndex: number, scene: Extract<BlueprintV2SectionItem, { kind: 'scene' }>) => {
    const ok = await confirm(text(
      `删除正式分镜「${scene.title}」？\n\n这是破坏性操作：分镜正文将从蓝图细纲中移除；关联的画布场景卡会保留并显示「引用失效」，不会被连带删除。\n\n——— 完整分镜正文 ———\n${scene.markdown}`,
      `Delete the storyboard scene “${scene.title}”?\n\nThis is destructive: the scene body will be removed from the blueprint. Any linked canvas card stays and shows a “broken reference” badge; it will not be deleted.\n\n——— Full scene body ———\n${scene.markdown}`,
    ), {
      title: text('删除蓝图分镜', 'Delete blueprint scene'),
      confirmText: text('删除分镜', 'Delete scene'),
      danger: true,
    })
    if (!ok) return
    const section = content.sections[sectionIndex]
    if (!section || section.kind !== 'canonical') return
    patchSection(sectionIndex, { items: section.items.filter(item => item.id !== scene.id) })
  }

  const addScene = (sectionIndex: number) => {
    const nextNumber = scenes.length + 1
    appendItem(sectionIndex, {
      kind: 'scene',
      id: createBlueprintV2SceneId(),
      level: 5,
      title: text(`场景${nextNumber}：新分镜`, `Scene ${nextNumber}: New scene`),
      markdown: '',
      presence: 'off-canvas',
    })
  }

  const addListItem = (sectionIndex: number) => {
    appendItem(sectionIndex, {
      kind: 'bullet',
      id: createBlueprintV2ItemId(),
      label: null,
      markdown: text('- 新条目：', '- New item: '),
    })
  }

  const addFieldItem = (sectionIndex: number) => {
    appendItem(sectionIndex, {
      kind: 'field',
      id: createBlueprintV2ItemId(),
      label: text('新字段', 'New field'),
      markdown: text('- **新字段**：', '- **New field**: '),
    })
  }

  const addBlockItem = (sectionIndex: number) => {
    appendItem(sectionIndex, {
      kind: 'block',
      id: createBlueprintV2ItemId(),
      markdown: '',
    })
  }

  const addCanonicalSection = (id: BlueprintV2SectionId) => {
    const entry = BLUEPRINT_V2_CANONICAL_SECTIONS.find(section => section.id === id)
    if (!entry || content.sections.some(section => section.kind === 'canonical' && section.id === id)) return
    onChange({
      ...content,
      sections: [...content.sections, {
        kind: 'canonical',
        id,
        title: `【${entry.title}】`,
        preamble: '',
        items: [],
        postamble: '',
      }],
    })
  }

  const setCheckMode = (sectionIndex: number, item: BlueprintV2FieldItem | BlueprintV2BulletItem, mode: BlueprintV2CheckMode) => {
    patchItem(sectionIndex, item.id, current => {
      if (current.kind !== 'field' && current.kind !== 'bullet') return current
      return { ...current, check: { mode, source: 'explicit' } }
    })
  }

  const patchPlanning = (key: keyof BlueprintChapterPlanning, value: string) => {
    const planning = { ...(content.planning ?? {}) }
    if (value.trim()) planning[key] = value
    else delete planning[key]
    onChange({ ...content, planning: Object.keys(planning).length > 0 ? planning : undefined })
  }

  return (
    <div className="blueprint-v2" data-testid="blueprint-v2-editor">
      <section className="blueprint-v2__planning" data-testid="blueprint-v2-planning">
        <header>
          <div>
            <strong>{text('本章承担的卷内规划任务', 'Chapter task within the volume plan')}</strong>
            <span>{text('仅表示计划，不会写入角色事实或正文。', 'Planning only; this does not update character facts or prose.')}</span>
          </div>
        </header>
        <label>
          {text('本章承担的卷内任务', 'Task this chapter carries within the volume')}
          <Textarea value={content.planning?.volumeTask ?? ''} rows={2} onChange={event => patchPlanning('volumeTask', event.target.value)} />
        </label>
        <label>
          {text('承接内容', 'Handoff from prior material')}
          <Textarea value={content.planning?.handoff ?? ''} rows={2} onChange={event => patchPlanning('handoff', event.target.value)} />
        </label>
        <label>
          {text('预期结束变化', 'Expected change by the end')}
          <Textarea value={content.planning?.expectedEndChange ?? ''} rows={2} onChange={event => patchPlanning('expectedEndChange', event.target.value)} />
        </label>
      </section>
      {content.sections.map((section, sectionIndex) => {
        if (section.kind === 'custom') {
          const documentIdentity = createBusinessFieldDocumentIdentity({
            projectId: documentProjectId,
            entityType: 'blueprint-v2-custom-section',
            entityId: `chapter-${content.chapterNumber}:${section.id}`,
            fieldId: 'body',
          })
          return (
            <section key={section.id + sectionIndex} className="blueprint-v2__section blueprint-v2__section--custom" data-testid="blueprint-v2-custom-section">
              <header className="blueprint-v2__section-header">
                <span className="blueprint-v2__section-title" title={text('未归类的自定义分区（原文逐字保留）', 'Unclassified custom section (kept verbatim)')}>
                  {section.title}
                </span>
                <span className="blueprint-v2__section-tag">{text('未归类', 'Unclassified')}</span>
              </header>
              <div className="blueprint-v2__markdown-field" data-testid="blueprint-v2-custom-body-editor" data-document-identity={documentIdentity}>
                <DocumentEditingSurface
                  documentIdentity={documentIdentity}
                  layout="business-field"
                  ariaLabel={text(`分区「${section.title}」正文`, `Body of section “${section.title}”`)}
                  content={section.body}
                  onChange={body => patchCustomBody(sectionIndex, body)}
                  placeholder={text(`分区「${section.title}」正文`, `Body of section “${section.title}”`)}
                />
              </div>
            </section>
          )
        }
        const registry = BLUEPRINT_V2_CANONICAL_SECTIONS.find(entry => entry.id === section.id)
        const isStoryboard = section.id === 'storyboard'
        const sectionScenes = isStoryboard ? section.items.filter((item): item is Extract<BlueprintV2SectionItem, { kind: 'scene' }> => item.kind === 'scene') : []
        return (
          <section key={section.id} className="blueprint-v2__section" data-testid={`blueprint-v2-section-${section.id}`}>
            <header className="blueprint-v2__section-header">
              <span className="blueprint-v2__section-icon" aria-hidden="true">{SECTION_ICONS[section.id]}</span>
              <span className="blueprint-v2__section-title">{section.title}</span>
              {isStoryboard && (
                <span className="blueprint-v2__section-tag" data-testid="blueprint-v2-scene-count">
                  {text(`${sectionScenes.length} 个分镜`, `${sectionScenes.length} scene(s)`)}
                </span>
              )}
              <span className="blueprint-v2__section-hint">
                {registry ? text('规范分区', 'Canonical section') : ''}
              </span>
            </header>

            {section.preamble.trim() !== '' && (
              <details className="blueprint-v2__preamble">
                <summary>{text('分区前导说明', 'Section preamble')}</summary>
                <Textarea
                  value={section.preamble}
                  rows={textareaRows(section.preamble, 2, 10)}
                  onChange={event => patchSection(sectionIndex, { preamble: event.target.value })}
                />
              </details>
            )}

            <div className="blueprint-v2__items">
              {section.items.map(item => {
                if (item.kind === 'scene') {
                  const order = sectionScenes.findIndex(scene => scene.id === item.id) + 1
                  const documentIdentity = createBusinessFieldDocumentIdentity({
                    projectId: documentProjectId,
                    entityType: 'blueprint-v2-scene',
                    entityId: `chapter-${content.chapterNumber}:${item.id}`,
                    fieldId: 'markdown',
                  })
                  return (
                    <article
                      key={item.id}
                      className="blueprint-v2__scene"
                      data-testid="blueprint-v2-scene"
                      data-scene-id={item.id}
                      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
                      onDrop={event => {
                        event.preventDefault()
                        const draggedSceneId = event.dataTransfer.getData('text/plain')
                        if (draggedSceneId) onChange(moveBlueprintV2Scene(content, draggedSceneId, order))
                      }}
                    >
                      <div className="blueprint-v2__scene-header">
                        <button
                          type="button"
                          draggable
                          className="blueprint-v2__drag-handle"
                          onDragStart={event => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', item.id)
                          }}
                          title={text('拖动以调整分镜顺序', 'Drag to reorder scenes')}
                          aria-label={text(`拖动分镜「${item.title}」以调整顺序`, `Drag scene “${item.title}” to reorder`)}
                          data-testid={`blueprint-v2-scene-drag-${item.id}`}
                        >
                          <GripVertical size={13} />
                        </button>
                        <span className="blueprint-v2__scene-order" title={text('分镜顺序（按列表位次）', 'Scene order (list position)')}>#{order || '?'}</span>
                        <Input
                          value={item.title}
                          onChange={event => patchItem(sectionIndex, item.id, current => (
                            current.kind === 'scene' ? { ...current, title: event.target.value } : current
                          ))}
                          className="blueprint-v2__scene-title"
                          aria-label={text('分镜标题', 'Scene title')}
                          title={text('标题含「场景N：」编号；编号是小说内容的一部分，不会被自动改写', 'The title carries the “场景N：” number; numbers are part of the novel text and are never rewritten automatically.')}
                        />
                        <span
                          className={cn('blueprint-v2__presence', item.presence === 'on-canvas' && 'is-on-canvas')}
                          title={item.presence === 'on-canvas'
                            ? text('该分镜已排上场景画布', 'This scene is on the chapter canvas')
                            : text('该分镜尚未排上场景画布', 'This scene is not on the chapter canvas')}
                        >
                          {item.presence === 'on-canvas' ? text('在画布上', 'On canvas') : text('未排上画布', 'Off canvas')}
                        </span>
                        <div className="blueprint-v2__scene-actions">
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6"
                            disabled={order <= 1}
                            onClick={() => moveScene(sectionIndex, item.id, -1)}
                            title={text('上移分镜', 'Move scene up')}
                            aria-label={text('上移分镜', 'Move scene up')}
                          >
                            <ArrowUp size={12} />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6"
                            disabled={order <= 0 || order >= sectionScenes.length}
                            onClick={() => moveScene(sectionIndex, item.id, 1)}
                            title={text('下移分镜', 'Move scene down')}
                            aria-label={text('下移分镜', 'Move scene down')}
                          >
                            <ArrowDown size={12} />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => void removeScene(sectionIndex, item)}
                            title={text('删除蓝图分镜（破坏性，需确认）', 'Delete blueprint scene (destructive, requires confirmation)')}
                            aria-label={text('删除蓝图分镜', 'Delete blueprint scene')}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                      <div className="blueprint-v2__markdown-field" data-testid={`blueprint-v2-scene-markdown-${item.id}`} data-document-identity={documentIdentity}>
                        <DocumentEditingSurface
                          documentIdentity={documentIdentity}
                          layout="business-field"
                          ariaLabel={text('分镜正文', 'Scene body')}
                          content={item.markdown}
                          onChange={markdown => patchItem(sectionIndex, item.id, current => (
                            current.kind === 'scene' ? { ...current, markdown } : current
                          ))}
                          placeholder={text('分镜正文：时空环境、动作细节、对白……小标题与嵌套列表会逐字保留。', 'Scene body: setting, action, dialogue… sub-headings and nested lists are kept verbatim.')}
                          className="blueprint-v2__scene-markdown"
                        />
                      </div>
                    </article>
                  )
                }
                if (item.kind === 'field') {
                  return (
                    <div key={item.id} className={cn('blueprint-v2__item', (item.markdown.length > 240 || item.markdown.split('\n').length > 5) && 'blueprint-v2__item--wide')} data-testid="blueprint-v2-field-item">
                      <div className="blueprint-v2__item-header">
                        <Label className="blueprint-v2__item-label">
                          <SquarePen size={11} />
                          {item.label}
                        </Label>
                        {renderCheckControls(sectionIndex, section.id, item)}
                      </div>
                      <Textarea
                        value={item.markdown}
                        rows={textareaRows(item.markdown)}
                        onChange={event => patchItem(sectionIndex, item.id, current => (
                          current.kind === 'field' ? { ...current, markdown: event.target.value } : current
                        ))}
                      />
                    </div>
                  )
                }
                if (item.kind === 'bullet') {
                  return (
                    <div key={item.id} className={cn('blueprint-v2__item', (item.markdown.length > 240 || item.markdown.split('\n').length > 5) && 'blueprint-v2__item--wide')} data-testid="blueprint-v2-bullet-item">
                      <div className="blueprint-v2__item-header">
                        <Label className="blueprint-v2__item-label">
                          <ListPlus size={11} />
                          {text('列表条目', 'List item')}
                        </Label>
                        {renderCheckControls(sectionIndex, section.id, item)}
                      </div>
                      <Textarea
                        value={item.markdown}
                        rows={textareaRows(item.markdown)}
                        onChange={event => patchItem(sectionIndex, item.id, current => (
                          current.kind === 'bullet' ? { ...current, markdown: event.target.value } : current
                        ))}
                      />
                    </div>
                  )
                }
                return (
                  <div key={item.id} className="blueprint-v2__item blueprint-v2__item--wide" data-testid="blueprint-v2-block-item">
                    <div className="blueprint-v2__item-header">
                      <Label className="blueprint-v2__item-label">{text('自由块（引用/表格/段落）', 'Free block (quote / table / paragraph)')}</Label>
                    </div>
                    <Textarea
                      value={item.markdown}
                      rows={textareaRows(item.markdown)}
                      onChange={event => patchItem(sectionIndex, item.id, current => (
                        current.kind === 'block' ? { ...current, markdown: event.target.value } : current
                      ))}
                    />
                  </div>
                )
              })}
              {section.items.length === 0 && (
                <p className="blueprint-v2__empty" data-testid={`blueprint-v2-empty-${section.id}`}>
                  {isStoryboard
                    ? text('本章还没有分镜。可手动新增，或通过「导入 Markdown」载入完整细纲。', 'No scenes yet. Add one manually, or import a full outline via “Import Markdown”.')
                    : text('此分区暂无条目。', 'No items in this section yet.')}
                </p>
              )}
            </div>

            {section.postamble.trim() !== '' && (
              <details className="blueprint-v2__postamble">
                <summary>{text('分区结尾散块', 'Section trailing blocks')}</summary>
                <Textarea
                  value={section.postamble}
                  rows={textareaRows(section.postamble, 2, 10)}
                  onChange={event => patchSection(sectionIndex, { postamble: event.target.value })}
                />
              </details>
            )}

            <div className="blueprint-v2__section-actions">
              {isStoryboard && (
                <Button variant="outline" size="sm" onClick={() => addScene(sectionIndex)} data-testid="blueprint-v2-add-scene">
                  <Plus size={12} /> {text('新增分镜', 'Add scene')}
                </Button>
              )}
              {section.id !== 'storyboard' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => addFieldItem(sectionIndex)}>
                    <Plus size={12} /> {text('新增字段条目', 'Add field item')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => addListItem(sectionIndex)}>
                    <ListPlus size={12} /> {text('新增列表条目', 'Add list item')}
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => addBlockItem(sectionIndex)}>
                <Plus size={12} /> {text('新增自由块', 'Add free block')}
              </Button>
            </div>
          </section>
        )
      })}
      {missingCanonicalSections.map(entry => (
        <section
          key={`missing-${entry.id}`}
          className="blueprint-v2__section blueprint-v2__section--missing"
          data-testid={`blueprint-v2-missing-section-${entry.id}`}
        >
          <header className="blueprint-v2__section-header">
            <span className="blueprint-v2__section-icon" aria-hidden="true">{SECTION_ICONS[entry.id]}</span>
            <span className="blueprint-v2__section-title">【{entry.title}】</span>
            <span className="blueprint-v2__section-tag">{text('尚未录入', 'Not added')}</span>
          </header>
          <p className="blueprint-v2__empty">
            {text('导入文档未包含此规范分区。添加后可继续编辑；导入原文不会因缺项被改写。', 'The imported document did not include this canonical section. Add it to edit; missing sections never rewrite the imported source.')}
          </p>
          <div className="blueprint-v2__section-actions">
            <Button variant="outline" size="sm" onClick={() => addCanonicalSection(entry.id)} data-testid={`blueprint-v2-add-section-${entry.id}`}>
              <Plus size={12} /> {text('添加此分区', 'Add section')}
            </Button>
          </div>
        </section>
      ))}
    </div>
  )

  function renderCheckControls(
    sectionIndex: number,
    sectionId: BlueprintV2SectionId,
    item: BlueprintV2FieldItem | BlueprintV2BulletItem,
  ) {
    if (sectionId !== 'foreshadow' && sectionId !== 'taboos') return null
    const mode = item.check?.mode ?? 'reference'
    return (
      <div className="blueprint-v2__check">
        <NativeSelect
          value={mode}
          onChange={event => setCheckMode(sectionIndex, item, event.target.value as BlueprintV2CheckMode)}
          aria-label={text('检查语义', 'Check semantics')}
          title={text('必达：写作后一致性检查会核对；参考：仅作背景；禁写：命中即产出证据。', 'Must: checked by consistency review; Reference: context only; Forbid: hits become evidence.')}
          className="blueprint-v2__check-select"
          data-testid="blueprint-v2-check-mode"
        >
          {(Object.keys(CHECK_MODE_LABELS) as BlueprintV2CheckMode[]).map(key => (
            <option key={key} value={key}>{text(...CHECK_MODE_LABELS[key])}</option>
          ))}
        </NativeSelect>
        {item.check?.source === 'explicit' && (
          <span className="blueprint-v2__check-source">{text('已标注', 'Marked')}</span>
        )}
      </div>
    )
  }
}
