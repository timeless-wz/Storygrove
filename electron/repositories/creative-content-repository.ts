import { createHash, randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'
import type { ProjectCoreData } from './project-core-repository'
import {
  CREATIVE_MATERIAL_TYPES,
  LEGACY_CREATIVE_FIELD_CATEGORIES,
  LEGACY_CREATIVE_FIELD_LABELS,
  type CreativeContentCategory,
  type CreativeLegacyOrganizationInput,
  type CreativeMaterialEntry,
  type CreativeMaterialKind,
  type CreativeMaterialSaveInput,
  type CreativeMaterialStatus,
  type CreativeMaterialType,
  type LegacyCreativeDisposition,
  type LegacyCreativeField,
  type LegacyCreativeSource,
} from '../../src/shared/creative-content'

interface CreativeMaterialRow {
  id: string
  title: string
  entry_kind: CreativeMaterialKind
  material_type: CreativeMaterialType
  status: CreativeMaterialStatus
  markdown: string
  source_file_name: string
  source_heading: string
  revision: number
  created_at: string
  updated_at: string
}

const MAX_MARKDOWN_CHARS = 500_000
const ALLOWED_FIELDS = new Set<LegacyCreativeField>([
  'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile', 'globalGuidance', 'writingStyle',
])

function requiredDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label}无效`)
  return value
}

function normalizeMaterialInput(raw: CreativeMaterialSaveInput): CreativeMaterialSaveInput {
  if (!raw || typeof raw !== 'object') throw new Error('资料记录格式无效')
  if (!['material', 'retired', 'issue'].includes(raw.entryKind)) throw new Error('资料记录类别无效')
  if (!['candidate', 'adopted', 'rejected', 'open', 'resolved', 'retired'].includes(raw.status)) throw new Error('资料状态无效')
  if (raw.entryKind === 'material' && !['candidate', 'adopted', 'rejected'].includes(raw.status)) {
    throw new Error('素材状态必须是待采用、已采用或未采用')
  }
  if (raw.entryKind === 'retired' && raw.status !== 'retired') throw new Error('废案状态无效')
  if (raw.entryKind === 'issue' && !['open', 'resolved'].includes(raw.status)) throw new Error('问题状态必须是待处理或已处理')
  if (raw.expectedRevision !== null && (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 1)) {
    throw new Error('资料版本无效')
  }
  if (!CREATIVE_MATERIAL_TYPES.includes((raw.materialType ?? 'other') as CreativeMaterialType)) {
    throw new Error('素材用途无效')
  }
  return {
    ...(raw.id !== undefined ? { id: text(raw.id, '资料 ID', 80) } : {}),
    title: text(raw.title, '资料标题', 200).trim(),
    entryKind: raw.entryKind,
    materialType: text(raw.materialType ?? 'other', '素材用途', 40) as CreativeMaterialType,
    status: raw.status,
    markdown: text(raw.markdown, 'Markdown 正文', MAX_MARKDOWN_CHARS),
    sourceFileName: text(raw.sourceFileName ?? '', '来源文件名', 240),
    sourceHeading: text(raw.sourceHeading ?? '', '来源原文标题', 240),
    expectedRevision: raw.expectedRevision,
  }
}

function rowToEntry(row: CreativeMaterialRow): CreativeMaterialEntry {
  return {
    id: row.id,
    title: row.title,
    entryKind: row.entry_kind,
    materialType: row.material_type,
    status: row.status,
    markdown: row.markdown,
    sourceFileName: row.source_file_name,
    sourceHeading: row.source_heading,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class CreativeContentRepository {
  static listLegacySources(core: ProjectCoreData): LegacyCreativeSource[] {
    const db = requiredDb()
    const fields = Object.keys(LEGACY_CREATIVE_FIELD_LABELS) as LegacyCreativeField[]
    const rows = db.prepare(`
      SELECT source_field, source_hash, disposition, target_categories_json, reviewed_at
      FROM creative_legacy_organization
    `).all() as Array<{
      source_field: string
      source_hash: string
      disposition: LegacyCreativeDisposition
      target_categories_json: string
      reviewed_at: string
    }>
    const byField = new Map(rows.map(row => [row.source_field, row]))
    return fields.flatMap(sourceField => {
      const content = core[sourceField]
      if (typeof content !== 'string' || !content.trim()) return []
      const currentHash = contentHash(content)
      const row = byField.get(sourceField)
      const unchanged = row?.source_hash === currentHash
      let disposition: LegacyCreativeSource['disposition'] = 'pending'
      if (unchanged && row) disposition = row.disposition
      let recommendedCategories = LEGACY_CREATIVE_FIELD_CATEGORIES[sourceField]
      if (unchanged && row?.target_categories_json) {
        try {
          const parsed: unknown = JSON.parse(row.target_categories_json)
          if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
            recommendedCategories = parsed as CreativeContentCategory[]
          }
        } catch { /* Keep the shipped semantic suggestions when old metadata is damaged. */ }
      }
      return [{
        sourceField,
        label: LEGACY_CREATIVE_FIELD_LABELS[sourceField],
        content,
        contentHash: currentHash,
        recommendedCategories,
        disposition,
        ...(unchanged && row?.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
      }]
    })
  }

  static organizeLegacySource(input: CreativeLegacyOrganizationInput): void {
    const db = requiredDb()
    if (!ALLOWED_FIELDS.has(input.sourceField)) throw new Error('旧配置来源无效')
    if (!/^[a-f0-9]{64}$/u.test(input.expectedHash)) throw new Error('旧内容版本无效')
    if (!['organized', 'ignored'].includes(input.disposition)) throw new Error('归位状态无效')
    if (!Array.isArray(input.targetCategories) || input.targetCategories.length > 11) throw new Error('归位目标无效')
    if (input.targetCategories.some(category => ![
      'creative-direction', 'writing-rules', 'premise', 'world-setting', 'power-system',
      'locations', 'characters', 'plot-planning', 'information-reveal', 'materials', 'retired-and-issues',
    ].includes(category))) throw new Error('归位目标无效')
    if (input.disposition === 'ignored' && input.targetCategories.length > 0) throw new Error('忽略旧内容时不能指定归位目标')
    const core = db.prepare(`SELECT ${legacyColumn(input.sourceField)} AS content FROM project_core WHERE id='main'`)
      .get() as { content: string } | undefined
    const currentContent = core?.content ?? ''
    if (!currentContent.trim() || contentHash(currentContent) !== input.expectedHash) {
      throw new Error('旧内容已变化，请重新打开待整理内容后再确认')
    }
    db.prepare(`
      INSERT INTO creative_legacy_organization(source_field, source_hash, disposition, target_categories_json, reviewed_at)
      VALUES(?, ?, ?, ?, datetime('now'))
      ON CONFLICT(source_field) DO UPDATE SET
        source_hash=excluded.source_hash,
        disposition=excluded.disposition,
        target_categories_json=excluded.target_categories_json,
        reviewed_at=excluded.reviewed_at
    `).run(input.sourceField, input.expectedHash, input.disposition, JSON.stringify(input.targetCategories))
  }

  static listMaterials(filter?: { entryKind?: CreativeMaterialKind; status?: CreativeMaterialStatus }): CreativeMaterialEntry[] {
    const db = requiredDb()
    const clauses: string[] = []
    const values: string[] = []
    if (filter?.entryKind) {
      clauses.push('entry_kind = ?')
      values.push(filter.entryKind)
    }
    if (filter?.status) {
      clauses.push('status = ?')
      values.push(filter.status)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return (db.prepare(`
      SELECT id, title, entry_kind, material_type, status, markdown, source_file_name, source_heading,
             revision, created_at, updated_at
      FROM creative_material_entries ${where}
      ORDER BY updated_at DESC, id
    `).all(...values) as CreativeMaterialRow[]).map(rowToEntry)
  }

  static saveMaterial(raw: CreativeMaterialSaveInput): CreativeMaterialEntry {
    const db = requiredDb()
    const input = normalizeMaterialInput(raw)
    if (!input.title) throw new Error('资料标题不能为空')
    const now = new Date().toISOString()
    if (input.expectedRevision === null) {
      const id = input.id?.trim() || `cm-${randomUUID()}`
      db.prepare(`
        INSERT INTO creative_material_entries
          (id, title, entry_kind, material_type, status, markdown, source_file_name, source_heading, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, input.title, input.entryKind, input.materialType, input.status, input.markdown,
        input.sourceFileName, input.sourceHeading, now, now)
      return this.getMaterial(id)!
    }
    if (!input.id) throw new Error('更新资料缺少记录 ID')
    const result = db.prepare(`
      UPDATE creative_material_entries
      SET title=?, entry_kind=?, material_type=?, status=?, markdown=?, source_file_name=?, source_heading=?,
          revision=revision+1, updated_at=?
      WHERE id=? AND revision=?
    `).run(input.title, input.entryKind, input.materialType, input.status, input.markdown,
      input.sourceFileName, input.sourceHeading, now, input.id, input.expectedRevision)
    if (result.changes !== 1) throw new Error('资料已在其他位置更新，请重新读取后再保存')
    return this.getMaterial(input.id)!
  }

  static getMaterial(id: string): CreativeMaterialEntry | null {
    const row = requiredDb().prepare(`
      SELECT id, title, entry_kind, material_type, status, markdown, source_file_name, source_heading,
             revision, created_at, updated_at
      FROM creative_material_entries WHERE id=?
    `).get(id) as CreativeMaterialRow | undefined
    return row ? rowToEntry(row) : null
  }
}

function legacyColumn(field: LegacyCreativeField): string {
  const columns: Record<LegacyCreativeField, string> = {
    coreOutline: 'core_outline',
    worldSetting: 'world_setting',
    goldenFinger: 'golden_finger',
    protagonistProfile: 'protagonist_profile',
    globalGuidance: 'global_guidance',
    writingStyle: 'writing_style',
  }
  return columns[field]
}
