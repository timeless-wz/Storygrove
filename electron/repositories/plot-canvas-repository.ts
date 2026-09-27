import { getProjectDb } from '../database'
import { isCanvasIdWithPrefix } from '../../src/shared/canvas-ids'
import {
  createPlotCanvasEdgeId,
  createPlotCanvasId,
  createPlotCanvasNodeId,
  isPlotCanvasNodeKind,
  MAX_PLOT_CANVAS_NODES,
  normalizePlotCanvasDescription,
  normalizePlotCanvasEntityRefs,
  normalizePlotCanvasTags,
  PLOT_CANVAS_ID_PREFIX,
  parsePlotCanvasNodeText,
  normalizePlotCanvasChapterRefs,
  parsePlotCanvasPosition,
  parsePlotCanvasViewport,
  type PlotCanvasColorKey,
  type PlotCanvasEdgeData,
  type PlotCanvasGraph,
  type PlotCanvasGraphApplyPayload,
  type PlotCanvasNodeData,
  type PlotCanvasNodeEntityRef,
  type PlotCanvasSummary,
  type PlotCanvasViewport,
} from '../../src/shared/plot-canvas'

function requireDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

/** 删除画布时必须显式选择对子画布的处理方式，禁止静默级联。 */
export type PlotCanvasDeleteStrategy = 'promote-children' | 'cascade'

interface CanvasRow {
  id: string
  name: string
  description: string
  parent_canvas_id: string | null
  sort_order: number
  viewport_json: string
  created_at: string
  updated_at: string
}

interface NodeRow {
  id: string
  canvas_id: string
  kind: string | null
  title: string
  summary: string
  color_key: string
  tags: string | null
  entity_refs: string | null
  chapter_refs: string
  plan_id: number | null
  sub_canvas_id: string | null
  x: number
  y: number
  created_at: string
  updated_at: string
}

interface EdgeRow {
  id: string
  canvas_id: string
  source_node_id: string
  target_node_id: string
  label: string
  kind: string
  created_at: string
  updated_at: string
}

const COLOR_KEYS = ['default', 'accent', 'success', 'warning', 'danger'] as const

/** 存量行上的迁移字段解析失败时回落迁移默认值，旧行永远可读。 */
function parseStoredTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return normalizePlotCanvasTags(parsed) ?? []
  } catch {
    return []
  }
}

function parseStoredEntityRefs(raw: string | null): PlotCanvasNodeEntityRef[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return normalizePlotCanvasEntityRefs(parsed) ?? []
  } catch {
    return []
  }
}

function toSummary(row: CanvasRow): PlotCanvasSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    parentCanvasId: row.parent_canvas_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toNode(row: NodeRow): PlotCanvasNodeData {
  let chapterRefs: number[] = []
  try {
    const parsed: unknown = JSON.parse(row.chapter_refs)
    if (Array.isArray(parsed)) chapterRefs = parsed.filter(Number.isSafeInteger)
  } catch {
    chapterRefs = []
  }
  return {
    id: row.id,
    canvasId: row.canvas_id,
    kind: row.kind && isPlotCanvasNodeKind(row.kind) ? row.kind : 'plot',
    title: row.title,
    summary: row.summary,
    colorKey: (COLOR_KEYS as readonly string[]).includes(row.color_key)
      ? row.color_key as PlotCanvasColorKey
      : 'default',
    tags: parseStoredTags(row.tags),
    entityRefs: parseStoredEntityRefs(row.entity_refs),
    chapterRefs,
    planId: row.plan_id,
    subCanvasId: row.sub_canvas_id,
    x: row.x,
    y: row.y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toEdge(row: EdgeRow): PlotCanvasEdgeData {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    label: row.label,
    kind: row.kind === 'aux' ? 'aux' : 'main',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function requireCanvas(db: NonNullable<ReturnType<typeof getProjectDb>>, canvasId: string): CanvasRow {
  const row = db.prepare('SELECT * FROM plot_canvases WHERE id = ?').get(canvasId) as CanvasRow | undefined
  if (!row) throw new Error('剧情画布不存在')
  return row
}

function listCanvases(db: NonNullable<ReturnType<typeof getProjectDb>>): PlotCanvasSummary[] {
  const rows = db.prepare(`
    SELECT * FROM plot_canvases ORDER BY sort_order ASC, created_at ASC
  `).all() as CanvasRow[]
  return rows.map(toSummary)
}

/** 画布树不允许成环，否则面包屑与删除子树都会失控。 */
function assertNoCanvasCycle(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  canvasId: string | null,
  parentCanvasId: string | null,
): void {
  if (!parentCanvasId) return
  if (!isCanvasIdWithPrefix(PLOT_CANVAS_ID_PREFIX, parentCanvasId)) {
    throw new Error('剧情画布父画布 ID 无效')
  }
  if (parentCanvasId === canvasId) throw new Error('剧情画布不能以自己为父画布')
  const parentById = new Map(
    (db.prepare('SELECT id, parent_canvas_id FROM plot_canvases').all() as Array<{
      id: string
      parent_canvas_id: string | null
    }>).map(row => [row.id, row.parent_canvas_id]),
  )
  if (!parentById.has(parentCanvasId)) throw new Error('父画布不存在')
  const seen = new Set<string>()
  let cursor: string | null = parentCanvasId
  while (cursor && !seen.has(cursor)) {
    if (cursor && cursor === canvasId) throw new Error('剧情画布层级不能形成环')
    seen.add(cursor)
    cursor = parentById.get(cursor) ?? null
  }
}

function parseCanvasName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new Error('剧情画布名称不能为空')
  if (trimmed.length > 120) throw new Error('剧情画布名称超出 120 字上限')
  return trimmed
}

function parseColorKey(value: unknown): PlotCanvasColorKey {
  const key = value === undefined || value === null ? 'default' : value
  if (typeof key !== 'string' || !(COLOR_KEYS as readonly string[]).includes(key)) {
    throw new Error('剧情画布节点颜色无效')
  }
  return key as PlotCanvasColorKey
}

function parseNodeKind(value: unknown): PlotCanvasNodeData['kind'] | undefined {
  if (value === undefined) return undefined
  if (value === null) return undefined
  if (!isPlotCanvasNodeKind(value)) throw new Error('剧情画布节点种类无效')
  return value
}

function parseNodeTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (value === null) return []
  const tags = normalizePlotCanvasTags(value)
  if (!tags) throw new Error('剧情画布节点标签无效')
  return tags
}

function parseNodeEntityRefs(value: unknown): PlotCanvasNodeEntityRef[] | undefined {
  if (value === undefined) return undefined
  if (value === null) return []
  const refs = normalizePlotCanvasEntityRefs(value)
  if (!refs) throw new Error('剧情画布节点实体引用无效')
  return refs
}

function parseEdgeKind(value: unknown): 'main' | 'aux' {
  const kind = value === undefined || value === null ? 'main' : value
  if (kind !== 'main' && kind !== 'aux') throw new Error('剧情画布连线种类无效')
  return kind
}

function parseEdgeLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw new Error('剧情画布连线标签无效')
  return value
}

export interface PlotCanvasNodeUpsertInput {
  /** 有 id 视为整体更新，无 id 视为新建；渲染层始终生成 id 以便幂等重试。 */
  id?: string
  canvasId: string
  /** 省略时新建回落 'plot'，更新保留原值（旧调用方不丢 kind）。 */
  kind?: unknown
  title: unknown
  summary: unknown
  colorKey?: unknown
  /** 省略时新建为空数组，更新保留原值（旧调用方不丢标签）。 */
  tags?: unknown
  /** 省略时新建为空数组，更新保留原值（旧调用方不丢实体引用）。 */
  entityRefs?: unknown
  chapterRefs?: unknown
  planId?: unknown
  subCanvasId?: unknown
  x: unknown
  y: unknown
}

export interface PlotCanvasUpdateInput {
  canvasId: string
  /** 省略表示不修改名称。 */
  name?: unknown
  /** 省略表示不修改说明；显式传空串即清空。 */
  description?: unknown
}

export class PlotCanvasRepository {
  static list(): PlotCanvasSummary[] {
    return listCanvases(requireDb())
  }

  static create(name: string, parentCanvasId: string | null, description?: unknown): PlotCanvasSummary {
    const db = requireDb()
    const trimmedName = parseCanvasName(name)
    let parsedDescription = ''
    if (description !== undefined && description !== null) {
      const normalized = normalizePlotCanvasDescription(description)
      if (normalized === null) throw new Error('剧情画布说明超出 2000 字上限')
      parsedDescription = normalized
    }
    const tx = db.transaction(() => {
      assertNoCanvasCycle(db, null, parentCanvasId)
      const maxOrder = (db.prepare(
        'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM plot_canvases',
      ).get() as { max_order: number }).max_order
      const id = createPlotCanvasId()
      db.prepare(`
        INSERT INTO plot_canvases (id, name, description, parent_canvas_id, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, trimmedName, parsedDescription, parentCanvasId, maxOrder + 1)
      return requireCanvas(db, id)
    })
    return toSummary(tx())
  }

  static rename(canvasId: string, name: string): PlotCanvasSummary {
    const db = requireDb()
    const trimmed = parseCanvasName(name)
    const tx = db.transaction(() => {
      requireCanvas(db, canvasId)
      db.prepare(`
        UPDATE plot_canvases SET name = ?, updated_at = datetime('now') WHERE id = ?
      `).run(trimmed, canvasId)
      return requireCanvas(db, canvasId)
    })
    return toSummary(tx())
  }

  /**
   * 部分更新画布元数据。省略的字段保持原值；说明支持显式清空（空串）。
   * 名称校验与 rename 完全一致。
   */
  static update(input: PlotCanvasUpdateInput): PlotCanvasSummary {
    const db = requireDb()
    const canvasId = input.canvasId
    let nextName: string | undefined
    if (input.name !== undefined && input.name !== null) nextName = parseCanvasName(input.name)
    let nextDescription: string | undefined
    if (input.description !== undefined && input.description !== null) {
      const normalized = normalizePlotCanvasDescription(input.description)
      if (normalized === null) throw new Error('剧情画布说明超出 2000 字上限')
      nextDescription = normalized
    }
    const tx = db.transaction(() => {
      requireCanvas(db, canvasId)
      if (nextName !== undefined) {
        db.prepare("UPDATE plot_canvases SET name = ?, updated_at = datetime('now') WHERE id = ?")
          .run(nextName, canvasId)
      }
      if (nextDescription !== undefined) {
        db.prepare("UPDATE plot_canvases SET description = ?, updated_at = datetime('now') WHERE id = ?")
          .run(nextDescription, canvasId)
      }
      return requireCanvas(db, canvasId)
    })
    return toSummary(tx())
  }

  /** 把画布移动到新的父画布下（null = 顶层）；移入自己的子树会形成环，被拒绝。 */
  static move(canvasId: string, parentCanvasId: string | null): PlotCanvasSummary {
    const db = requireDb()
    const tx = db.transaction(() => {
      requireCanvas(db, canvasId)
      assertNoCanvasCycle(db, canvasId, parentCanvasId)
      db.prepare(`
        UPDATE plot_canvases SET parent_canvas_id = ?, updated_at = datetime('now') WHERE id = ?
      `).run(parentCanvasId, canvasId)
      return requireCanvas(db, canvasId)
    })
    return toSummary(tx())
  }

  static reorder(orderedIds: string[]): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      orderedIds.forEach((id, index) => {
        db.prepare('UPDATE plot_canvases SET sort_order = ? WHERE id = ?').run(index + 1, id)
      })
    })
    tx()
  }

  static delete(canvasId: string, strategy: PlotCanvasDeleteStrategy): { removedCanvasIds: string[] } {
    const db = requireDb()
    const tx = db.transaction(() => {
      const canvases = listCanvases(db)
      if (!canvases.some(canvas => canvas.id === canvasId)) throw new Error('要删除的剧情画布不存在')
      const childrenByParent = new Map<string, string[]>()
      for (const canvas of canvases) {
        if (!canvas.parentCanvasId) continue
        const bucket = childrenByParent.get(canvas.parentCanvasId)
        if (bucket) bucket.push(canvas.id)
        else childrenByParent.set(canvas.parentCanvasId, [canvas.id])
      }
      const removed = new Set<string>([canvasId])
      if (strategy === 'cascade') {
        const queue = [...(childrenByParent.get(canvasId) ?? [])]
        while (queue.length > 0) {
          const current = queue.shift() as string
          if (removed.has(current)) continue
          removed.add(current)
          queue.push(...(childrenByParent.get(current) ?? []))
        }
      } else if ((childrenByParent.get(canvasId) ?? []).length > 0) {
        db.prepare(`
          UPDATE plot_canvases SET parent_canvas_id = (
            SELECT parent_canvas_id FROM plot_canvases WHERE id = ?
          ), updated_at = datetime('now') WHERE parent_canvas_id = ?
        `).run(canvasId, canvasId)
      }
      const removedIds = [...removed]
      const placeholders = removedIds.map(() => '?').join(', ')
      db.prepare(`
        DELETE FROM plot_canvas_edges WHERE canvas_id IN (${placeholders})
      `).run(...removedIds)
      db.prepare(`
        DELETE FROM plot_canvas_nodes WHERE canvas_id IN (${placeholders})
      `).run(...removedIds)
      db.prepare(`DELETE FROM plot_canvases WHERE id IN (${placeholders})`).run(...removedIds)
      return { removedCanvasIds: removedIds }
    })
    return tx()
  }

  static saveViewport(canvasId: string, viewport: PlotCanvasViewport): void {
    const db = requireDb()
    const parsed = parsePlotCanvasViewport(viewport)
    if (!parsed) throw new Error('剧情画布视口无效')
    const tx = db.transaction(() => {
      requireCanvas(db, canvasId)
      db.prepare(`
        UPDATE plot_canvases SET viewport_json = ?, updated_at = datetime('now') WHERE id = ?
      `).run(JSON.stringify(parsed), canvasId)
    })
    tx()
  }

  static getViewport(canvasId: string): PlotCanvasViewport | null {
    const db = requireDb()
    const canvas = requireCanvas(db, canvasId)
    return parsePlotCanvasViewport(canvas.viewport_json ? JSON.parse(canvas.viewport_json) : null)
  }

  static getGraph(canvasId: string): PlotCanvasGraph {
    const db = requireDb()
    const canvas = requireCanvas(db, canvasId)
    const nodes = (db.prepare(
      'SELECT * FROM plot_canvas_nodes WHERE canvas_id = ? ORDER BY created_at ASC, rowid ASC',
    ).all(canvasId) as NodeRow[]).map(toNode)
    const edges = (db.prepare(
      'SELECT * FROM plot_canvas_edges WHERE canvas_id = ? ORDER BY created_at ASC, rowid ASC',
    ).all(canvasId) as EdgeRow[]).map(toEdge)
    return {
      canvas: toSummary(canvas),
      viewport: parsePlotCanvasViewport(canvas.viewport_json ? JSON.parse(canvas.viewport_json) : null),
      nodes,
      edges,
    }
  }

  static nodeUpsert(input: PlotCanvasNodeUpsertInput): PlotCanvasNodeData {
    const db = requireDb()
    const text = parsePlotCanvasNodeText({ title: input.title, summary: input.summary })
    const chapterRefs = normalizePlotCanvasChapterRefs(input.chapterRefs ?? [])
    if (!chapterRefs) throw new Error('剧情画布节点章节引用无效')
    const planId = input.planId === undefined || input.planId === null ? null : input.planId
    if (planId !== null && (!Number.isSafeInteger(planId) || (planId as number) < 1)) {
      throw new Error('剧情画布节点计划引用无效')
    }
    const colorKey = parseColorKey(input.colorKey)
    const position = parsePlotCanvasPosition({ x: input.x, y: input.y })
    if (!position) throw new Error('剧情画布节点坐标无效')
    const subCanvasId = input.subCanvasId === undefined || input.subCanvasId === null
      ? null
      : input.subCanvasId
    if (subCanvasId !== null && !isCanvasIdWithPrefix(PLOT_CANVAS_ID_PREFIX, subCanvasId)) {
      throw new Error('剧情画布节点子画布引用无效')
    }
    // 增量字段：undefined = 新建回落默认 / 更新保留原值；显式传值 = 覆盖
    // （tags / entityRefs 允许传 [] 表示清空）。
    const parsedKind = parseNodeKind(input.kind)
    const parsedTags = parseNodeTags(input.tags)
    const parsedEntityRefs = parseNodeEntityRefs(input.entityRefs)

    const tx = db.transaction(() => {
      requireCanvas(db, input.canvasId)
      if (subCanvasId !== null) {
        if (subCanvasId === input.canvasId) throw new Error('剧情事件不能以所属画布为子画布')
        const sub = db.prepare('SELECT id FROM plot_canvases WHERE id = ?').get(subCanvasId)
        if (!sub) throw new Error('子画布不存在')
      }
      if (input.id) {
        const existing = db.prepare(
          'SELECT canvas_id FROM plot_canvas_nodes WHERE id = ?',
        ).get(input.id) as { canvas_id: string } | undefined
        if (existing && existing.canvas_id !== input.canvasId) {
          throw new Error('剧情事件归属画布不匹配')
        }
        if (existing) {
          const current = db.prepare('SELECT * FROM plot_canvas_nodes WHERE id = ?').get(input.id) as NodeRow
          const nextKind = parsedKind ?? (isPlotCanvasNodeKind(current.kind) ? current.kind : 'plot')
          const nextTags = JSON.stringify(parsedTags ?? parseStoredTags(current.tags))
          const nextEntityRefs = JSON.stringify(parsedEntityRefs ?? parseStoredEntityRefs(current.entity_refs))
          db.prepare(`
            UPDATE plot_canvas_nodes
            SET kind = ?, title = ?, summary = ?, color_key = ?, tags = ?, entity_refs = ?,
                chapter_refs = ?, plan_id = ?, sub_canvas_id = ?, x = ?, y = ?,
                updated_at = datetime('now')
            WHERE id = ?
          `).run(nextKind, text.title, text.summary, colorKey, nextTags, nextEntityRefs,
            JSON.stringify(chapterRefs), planId, subCanvasId, position.x, position.y, input.id)
          return db.prepare('SELECT * FROM plot_canvas_nodes WHERE id = ?').get(input.id) as NodeRow
        }
        // 带 id 但行不存在（首次写入或重试插入）：直接以此 id 落行，保证幂等。
      }
      const count = (db.prepare(
        'SELECT COUNT(*) AS count FROM plot_canvas_nodes WHERE canvas_id = ?',
      ).get(input.canvasId) as { count: number }).count
      if (count >= MAX_PLOT_CANVAS_NODES) {
        throw new Error(`单个剧情画布最多 ${MAX_PLOT_CANVAS_NODES} 个节点`)
      }
      const id = input.id ?? createPlotCanvasNodeId()
      db.prepare(`
        INSERT INTO plot_canvas_nodes
          (id, canvas_id, kind, title, summary, color_key, tags, entity_refs,
           chapter_refs, plan_id, sub_canvas_id, x, y)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.canvasId, parsedKind ?? 'plot', text.title, text.summary, colorKey,
        JSON.stringify(parsedTags ?? []), JSON.stringify(parsedEntityRefs ?? []),
        JSON.stringify(chapterRefs), planId, subCanvasId, position.x, position.y)
      return db.prepare('SELECT * FROM plot_canvas_nodes WHERE id = ?').get(id) as NodeRow
    })
    return toNode(tx())
  }

  /** 删除节点与其全部连线在同一事务中完成；节点不存在时抛错。 */
  static nodeDelete(canvasId: string, nodeId: string): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      const existing = db.prepare(
        'SELECT canvas_id FROM plot_canvas_nodes WHERE id = ?',
      ).get(nodeId) as { canvas_id: string } | undefined
      if (!existing) throw new Error('要删除的剧情事件不存在')
      if (existing.canvas_id !== canvasId) throw new Error('剧情事件归属画布不匹配')
      db.prepare(
        'DELETE FROM plot_canvas_edges WHERE source_node_id = ? OR target_node_id = ?',
      ).run(nodeId, nodeId)
      db.prepare('DELETE FROM plot_canvas_nodes WHERE id = ?').run(nodeId)
    })
    tx()
  }

  /** 拖动结束后的批量坐标回写；一次事务，幂等可重试。 */
  static nodeReposition(
    canvasId: string,
    positions: Array<{ nodeId: string; x: number; y: number }>,
  ): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      for (const item of positions) {
        const position = parsePlotCanvasPosition({ x: item.x, y: item.y })
        if (!position) throw new Error('剧情画布节点坐标无效')
        db.prepare(`
          UPDATE plot_canvas_nodes SET x = ?, y = ?, updated_at = datetime('now')
          WHERE id = ? AND canvas_id = ?
        `).run(position.x, position.y, item.nodeId, canvasId)
      }
    })
    tx()
  }

  static edgeUpsert(input: {
    id?: string
    canvasId: string
    sourceNodeId: string
    targetNodeId: string
    label: unknown
    kind?: unknown
  }): PlotCanvasEdgeData {
    const db = requireDb()
    const label = parseEdgeLabel(input.label)
    const kind = parseEdgeKind(input.kind)
    if (input.sourceNodeId === input.targetNodeId) throw new Error('剧情画布连线不能连接自身')
    const tx = db.transaction(() => {
      requireCanvas(db, input.canvasId)
      const source = db.prepare('SELECT id FROM plot_canvas_nodes WHERE id = ?')
        .get(input.sourceNodeId) as { id: string } | undefined
      const target = db.prepare('SELECT id FROM plot_canvas_nodes WHERE id = ?')
        .get(input.targetNodeId) as { id: string } | undefined
      if (!source || !target) throw new Error('剧情画布连线端点节点不存在')
      if (input.id) {
        const existing = db.prepare(
          'SELECT canvas_id, source_node_id, target_node_id FROM plot_canvas_edges WHERE id = ?',
        ).get(input.id) as { canvas_id: string; source_node_id: string; target_node_id: string } | undefined
        if (existing) {
          if (existing.canvas_id !== input.canvasId) throw new Error('剧情连线归属画布不匹配')
          if (existing.source_node_id !== input.sourceNodeId || existing.target_node_id !== input.targetNodeId) {
            throw new Error('剧情连线端点不可变更，请删除后重新连接')
          }
          db.prepare(`
            UPDATE plot_canvas_edges SET label = ?, kind = ?, updated_at = datetime('now') WHERE id = ?
          `).run(label, kind, input.id)
          return db.prepare('SELECT * FROM plot_canvas_edges WHERE id = ?').get(input.id) as EdgeRow
        }
        // 带 id 但行不存在：按新连线插入，保证幂等重试。
      }
      // 参考项目按无向节点对去重（pair key `${a}::${b}`）：任一方向的连线
      // 已存在时不再新建，作者可在选中连线后改标签。
      const duplicate = db.prepare(`
        SELECT id FROM plot_canvas_edges
        WHERE canvas_id = ?
          AND (
            (source_node_id = ? AND target_node_id = ?)
            OR (source_node_id = ? AND target_node_id = ?)
          )
      `).get(input.canvasId, input.sourceNodeId, input.targetNodeId,
        input.targetNodeId, input.sourceNodeId) as { id: string } | undefined
      if (duplicate) throw new Error('两个剧情事件之间已存在连线')
      const id = input.id ?? createPlotCanvasEdgeId()
      db.prepare(`
        INSERT INTO plot_canvas_edges (id, canvas_id, source_node_id, target_node_id, label, kind)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.canvasId, input.sourceNodeId, input.targetNodeId, label, kind)
      return db.prepare('SELECT * FROM plot_canvas_edges WHERE id = ?').get(id) as EdgeRow
    })
    return toEdge(tx())
  }

  static edgeDelete(canvasId: string, edgeId: string): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      const existing = db.prepare(
        'SELECT canvas_id FROM plot_canvas_edges WHERE id = ?',
      ).get(edgeId) as { canvas_id: string } | undefined
      if (!existing) throw new Error('要删除的剧情连线不存在')
      if (existing.canvas_id !== canvasId) throw new Error('剧情连线归属画布不匹配')
      db.prepare('DELETE FROM plot_canvas_edges WHERE id = ?').run(edgeId)
    })
    tx()
  }

  /** 将 AI 预览一次性应用；基线变化或任一步失败时整个事务回滚。 */
  static applyGraph(input: PlotCanvasGraphApplyPayload): PlotCanvasGraph {
    const db = requireDb()
    if (!input || !Array.isArray(input.expectedNodes) || !Array.isArray(input.expectedEdges)
      || !Array.isArray(input.desiredNodes) || !Array.isArray(input.desiredEdges)) {
      throw new Error('剧情画布候选数据无效')
    }
    if (input.desiredNodes.length > MAX_PLOT_CANVAS_NODES || input.desiredEdges.length > 1000) {
      throw new Error('剧情画布候选超过容量限制')
    }
    const nodeIds = new Set(input.desiredNodes.map(node => node.id))
    const edgeIds = new Set(input.desiredEdges.map(edge => edge.id))
    if (nodeIds.size !== input.desiredNodes.length || edgeIds.size !== input.desiredEdges.length
      || input.desiredNodes.some(node => node.canvasId !== input.canvasId)
      || input.desiredEdges.some(edge => edge.canvasId !== input.canvasId
        || !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId))) {
      throw new Error('剧情画布候选包含重复或无效的节点与连线')
    }
    const tx = db.transaction(() => {
      const current = PlotCanvasRepository.getGraph(input.canvasId)
      if (JSON.stringify(current.nodes) !== JSON.stringify(input.expectedNodes)
        || JSON.stringify(current.edges) !== JSON.stringify(input.expectedEdges)) {
        throw new Error('画布在生成候选后发生了变化，请重新生成')
      }
      const currentNodes = new Map(current.nodes.map(node => [node.id, node]))
      const currentEdges = new Map(current.edges.map(edge => [edge.id, edge]))
      for (const edge of current.edges) {
        if (!edgeIds.has(edge.id)) PlotCanvasRepository.edgeDelete(input.canvasId, edge.id)
      }
      for (const node of current.nodes) {
        if (!nodeIds.has(node.id)) PlotCanvasRepository.nodeDelete(input.canvasId, node.id)
      }
      const mutableNode = (node: PlotCanvasNodeData) => ({
        kind: node.kind, title: node.title, summary: node.summary, colorKey: node.colorKey,
        tags: node.tags, entityRefs: node.entityRefs, chapterRefs: node.chapterRefs,
        planId: node.planId, subCanvasId: node.subCanvasId, x: node.x, y: node.y,
      })
      for (const node of input.desiredNodes) {
        const previous = currentNodes.get(node.id)
        if (!previous || JSON.stringify(mutableNode(previous)) !== JSON.stringify(mutableNode(node))) {
          PlotCanvasRepository.nodeUpsert(node)
        }
      }
      for (const edge of input.desiredEdges) {
        const previous = currentEdges.get(edge.id)
        if (!previous || previous.label !== edge.label || previous.kind !== edge.kind) {
          PlotCanvasRepository.edgeUpsert(edge)
        }
      }
      return PlotCanvasRepository.getGraph(input.canvasId)
    })
    return tx()
  }

  /**
   * 合并多个剧情事件为一个新事件（对应参考项目的 MERGE_PLOT_EVENT_CARDS）：
   * 新节点、改接连线与删除源节点在同一个事务内，失败即整体回滚。
   * 源节点上的外部连线按原方向改接到新节点；两端都属于源集合的连线消失。
   * kind 取载荷覆盖值或首个源节点；标签与实体引用取并集（保持出现顺序）。
   */
  static mergeNodes(input: {
    canvasId: string
    sourceNodeIds: string[]
    title: unknown
    summary: unknown
    colorKey?: unknown
    kind?: unknown
    tags?: unknown
    entityRefs?: unknown
  }): PlotCanvasNodeData {
    const db = requireDb()
    if (!Array.isArray(input.sourceNodeIds) || input.sourceNodeIds.length < 2) {
      throw new Error('合并至少需要两个剧情事件')
    }
    if (new Set(input.sourceNodeIds).size !== input.sourceNodeIds.length) {
      throw new Error('合并的剧情事件重复')
    }
    const text = parsePlotCanvasNodeText({ title: input.title, summary: input.summary })
    const colorKey = parseColorKey(input.colorKey)
    const payloadKind = parseNodeKind(input.kind)
    const payloadTags = parseNodeTags(input.tags)
    const payloadEntityRefs = parseNodeEntityRefs(input.entityRefs)
    const tx = db.transaction(() => {
      requireCanvas(db, input.canvasId)
      const sources = input.sourceNodeIds.map(id => db.prepare(
        'SELECT * FROM plot_canvas_nodes WHERE id = ?',
      ).get(id) as NodeRow | undefined)
      if (sources.some(source => !source)) throw new Error('要合并的剧情事件不存在')
      for (const source of sources as NodeRow[]) {
        if (source.canvas_id !== input.canvasId) throw new Error('剧情事件归属画布不匹配')
      }
      const chapterRefSet = new Set<number>()
      for (const source of sources as NodeRow[]) {
        for (const ref of toNode(source).chapterRefs) chapterRefSet.add(ref)
      }
      const chapterRefs = normalizePlotCanvasChapterRefs([...chapterRefSet])
      if (!chapterRefs) throw new Error('合并后的章节引用无效')
      const tagSet = new Set<string>()
      for (const source of sources as NodeRow[]) {
        for (const tag of parseStoredTags(source.tags)) tagSet.add(tag)
      }
      for (const tag of payloadTags ?? []) tagSet.add(tag)
      const tags = normalizePlotCanvasTags([...tagSet])
      if (!tags) throw new Error('合并后的标签无效')
      const entityRefMap = new Map<string, PlotCanvasNodeEntityRef>()
      for (const source of sources as NodeRow[]) {
        for (const ref of parseStoredEntityRefs(source.entity_refs)) {
          entityRefMap.set(`${ref.entityType}::${ref.entityId}`, ref)
        }
      }
      for (const ref of payloadEntityRefs ?? []) {
        entityRefMap.set(`${ref.entityType}::${ref.entityId}`, ref)
      }
      const entityRefs = normalizePlotCanvasEntityRefs([...entityRefMap.values()])
      if (!entityRefs) throw new Error('合并后的实体引用无效')
      const planIds = new Set((sources as NodeRow[]).map(source => source.plan_id))
      const planId = planIds.size === 1 ? (sources[0] as NodeRow).plan_id : null
      const subCanvasIds = new Set((sources as NodeRow[]).map(source => source.sub_canvas_id))
      const subCanvasId = subCanvasIds.size === 1 ? (sources[0] as NodeRow).sub_canvas_id : null
      const anchor = sources[0] as NodeRow
      const anchorKind = isPlotCanvasNodeKind(anchor.kind) ? anchor.kind : 'plot'
      const mergedId = createPlotCanvasNodeId()
      db.prepare(`
        INSERT INTO plot_canvas_nodes
          (id, canvas_id, kind, title, summary, color_key, tags, entity_refs,
           chapter_refs, plan_id, sub_canvas_id, x, y)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(mergedId, input.canvasId, payloadKind ?? anchorKind, text.title, text.summary, colorKey,
        JSON.stringify(tags), JSON.stringify(entityRefs),
        JSON.stringify(chapterRefs), planId, subCanvasId, anchor.x, anchor.y)
      const sourceIdSet = new Set(input.sourceNodeIds)
      for (const nodeId of input.sourceNodeIds) {
        const touching = db.prepare(`
          SELECT * FROM plot_canvas_edges WHERE source_node_id = ? OR target_node_id = ?
        `).all(nodeId, nodeId) as EdgeRow[]
        for (const edge of touching) {
          const keptSource = sourceIdSet.has(edge.source_node_id) ? mergedId : edge.source_node_id
          const keptTarget = sourceIdSet.has(edge.target_node_id) ? mergedId : edge.target_node_id
          if (keptSource === keptTarget) continue
          const duplicate = db.prepare(`
            SELECT id FROM plot_canvas_edges
            WHERE canvas_id = ? AND source_node_id = ? AND target_node_id = ?
          `).get(input.canvasId, keptSource, keptTarget) as { id: string } | undefined
          if (duplicate) continue
          db.prepare(`
            INSERT INTO plot_canvas_edges (id, canvas_id, source_node_id, target_node_id, label, kind)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(createPlotCanvasEdgeId(), input.canvasId, keptSource, keptTarget, edge.label, edge.kind)
        }
      }
      const placeholders = input.sourceNodeIds.map(() => '?').join(', ')
      db.prepare(`
        DELETE FROM plot_canvas_edges
        WHERE source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders})
      `).run(...input.sourceNodeIds, ...input.sourceNodeIds)
      db.prepare(`DELETE FROM plot_canvas_nodes WHERE id IN (${placeholders})`)
        .run(...input.sourceNodeIds)
      return db.prepare('SELECT * FROM plot_canvas_nodes WHERE id = ?').get(mergedId) as NodeRow
    })
    return toNode(tx())
  }
}
