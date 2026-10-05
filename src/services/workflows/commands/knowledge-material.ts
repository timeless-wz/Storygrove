/**
 * 信息差写作材料（knowledge-action-outline-sync-contract §8）。
 *
 * 组装规则（冻结）：
 * - 按章节范围提供"角色当时可知内容"与"读者允许看到的内容"；只有通过正确的
 *   故事位置/叙事位置筛选后才注入——早期角色拿不到后期认知。
 * - 作者真相单独标为「后台约束，不可直接泄露」，不混入角色已知事实；
 *   未定真相不作为客观答案（只列条目名并标注待定）；废止条目完全排除。
 * - 无法定位（unplaced）的记录归入"位置未知"组，由模型按计划谨慎处理，绝不冒充已发生。
 */

import { ipc } from '../../ipc-client'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import type { InfoEntry, KnowledgeRecord } from '../../../shared/knowledge-gap'

const MATERIAL_CHAR_BUDGET = 3500

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

function narrativeChapter(record: KnowledgeRecord): number | null {
  return record.narrativePosition.kind === 'chapter-scene' ? record.narrativePosition.chapterNumber : null
}

export interface KnowledgeGapMaterialResult {
  text: string
  characterRecordCount: number
  readerRecordCount: number
  backgroundEntryCount: number
}

export async function buildKnowledgeGapMaterial(
  projectSession: ProjectSessionContext,
  chapterNumber: number,
  chapterCharacterNames: readonly string[],
): Promise<KnowledgeGapMaterialResult | null> {
  const identityMap = await ipc.invokeWithProjectSession(
    projectSession, 'db:character-identities-get', projectSession.projectPath,
  ) as Record<string, string>
  const [entries, records] = await Promise.all([
    ipc.invokeWithProjectSession(projectSession, 'db:info-entry-list', undefined, projectSession.projectPath) as Promise<InfoEntry[]>,
    ipc.invokeWithProjectSession(projectSession, 'db:knowledge-record-list', undefined, projectSession.projectPath) as Promise<KnowledgeRecord[]>,
  ])
  if (records.length === 0 && entries.length === 0) return null

  const entryById = new Map(entries.map(entry => [entry.id, entry]))
  const idByName = new Map<string, string>()
  for (const [name, id] of Object.entries(identityMap)) {
    if (id) idByName.set(id, name)
  }
  const chapterCharacterIds = new Set(
    chapterCharacterNames.map(name => identityMap[name]).filter(Boolean),
  )

  // 人物知情记录：本章出场人物 + 叙事位置不晚于本章（或位置未知）。
  const characterLines: string[] = []
  const unknownPositionLines: string[] = []
  const touchedEntryIds = new Set<string>()
  let characterRecordCount = 0
  for (const record of records) {
    if (record.subjectKind !== 'character') continue
    if (!record.characterId || !chapterCharacterIds.has(record.characterId)) continue
    const name = idByName.get(record.characterId) ?? `人物${record.characterId.slice(0, 8)}`
    const entry = entryById.get(record.infoId)
    const entryTitle = entry ? entry.title : `信息条目${record.infoId}`
    if (entry) touchedEntryIds.add(entry.id)
    const conceal = record.concealment
      ? `；当前${record.concealment.publicStatement.trim() ? `公开说法「${truncate(record.concealment.publicStatement, 80)}」` : '有所隐瞒'}`
      : ''
    const line = `- ${name}｜关于「${entryTitle}」｜认知：${record.cognition}｜已知：${truncate(record.knownContent, 160)}${record.believedStatement.trim() ? `｜人物相信：${truncate(record.believedStatement, 120)}` : ''}${conceal}`
    const chapter = narrativeChapter(record)
    if (chapter === null) {
      unknownPositionLines.push(`${line}｜（故事/叙事位置未知：这是计划，不是已确认的正文事实）`)
    } else if (chapter <= chapterNumber) {
      characterLines.push(line)
      characterRecordCount += 1
    }
    // 位置晚于本章的记录不注入：早期角色拿不到后期认知。
  }

  // 读者记录：叙事位置不晚于本章。
  const readerLines: string[] = []
  let readerRecordCount = 0
  for (const record of records) {
    if (record.subjectKind !== 'reader') continue
    const chapter = narrativeChapter(record)
    if (chapter === null || chapter > chapterNumber) continue
    const entry = entryById.get(record.infoId)
    readerLines.push(`- 关于「${entry ? entry.title : record.infoId}」｜已展示证据：${truncate(record.reader?.shownEvidence ?? '', 160)}${record.reader?.expectedUnderstanding.trim() ? `｜预期的读者理解：${truncate(record.reader.expectedUnderstanding, 120)}` : ''}`)
    readerRecordCount += 1
    if (entry) touchedEntryIds.add(entry.id)
  }

  // 作者后台约束：只收录被引用条目；confirmed 才给真相，undecided 只列名。
  const backgroundLines: string[] = []
  let backgroundEntryCount = 0
  for (const entryId of touchedEntryIds) {
    const entry = entryById.get(entryId)
    if (!entry || entry.truthStatus === 'retired') continue
    if (entry.truthStatus === 'confirmed') {
      backgroundLines.push(`- 「${entry.title}」（作者已确认，后台约束——正文不得直接讲出真相，只呈现人物言行与线索）：${truncate(entry.truth, 200)}`)
      backgroundEntryCount += 1
    } else {
      backgroundLines.push(`- 「${entry.title}」（作者尚未确定真相；不要替作者下定论）`)
      backgroundEntryCount += 1
    }
  }

  if (characterLines.length === 0 && readerLines.length === 0
    && unknownPositionLines.length === 0 && backgroundLines.length === 0) {
    return null
  }

  const sections: string[] = []
  if (characterLines.length > 0) {
    sections.push(['【角色可知信息（截至本章，人物认知不保证正确）】', ...characterLines].join('\n'))
  }
  if (unknownPositionLines.length > 0) {
    sections.push(['【位置未知的信息记录（计划，非既定事实；谨慎使用）】', ...unknownPositionLines].join('\n'))
  }
  if (readerLines.length > 0) {
    sections.push(['【读者已见信息（截至本章）】', ...readerLines].join('\n'))
  }
  if (backgroundLines.length > 0) {
    sections.push(['【作者后台约束（不可直接泄露）】', ...backgroundLines].join('\n'))
  }

  let text = sections.join('\n\n')
  if (text.length > MATERIAL_CHAR_BUDGET) {
    text = `${text.slice(0, MATERIAL_CHAR_BUDGET)}…（信息差材料超预算已截断）`
  }
  return { text, characterRecordCount, readerRecordCount, backgroundEntryCount }
}
