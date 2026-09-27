import { getProjectDb } from '../database'
import {
  chapterCanvasId,
  createChapterCanvasEdgeId,
  createChapterCanvasNodeId,
  isChapterCanvasNodeType,
  isChapterCanvasSceneRole,
  MAX_CHAPTER_CANVAS_NODES,
  parseChapterCanvasMetaRow,
  parseChapterCanvasNodeRefs,
  parseChapterCanvasNodeRow,
  parseChapterCanvasEdgeRow,
  type ChapterCanvasEdgeData,
  type ChapterCanvasGraph,
  type ChapterCanvasMeta,
  type ChapterCanvasNodeData,
} from '../../src/shared/chapter-canvas'
import { parsePlotCanvasNodeText, parsePlotCanvasPosition, parsePlotCanvasViewport } from '../../src/shared/plot-canvas'

function requireDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

interface CanvasRow {
  id: string
  chapter_number: number
  viewport_json: string
  created_at: string
  updated_at: string
}

interface NodeRow {
  id: string
  canvas_id: string
  type: string
  title: string
  summary: string
  color_key: string
  role: string
  scene_order: number | null
  refs_json: string
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

function toMeta(row: CanvasRow): ChapterCanvasMeta {
  return parseChapterCanvasMetaRow({
    id: row.id,
    chapterNumber: row.chapter_number,
    viewport: row.viewport_json ? JSON.parse(row.viewport_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function toNode(row: NodeRow): ChapterCanvasNodeData {
  let refs: unknown = {}
  try {
    refs = JSON.parse(row.refs_json)
  } catch {
    refs = {}
  }
  return parseChapterCanvasNodeRow({
    id: row.id,
    canvasId: row.canvas_id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    colorKey: row.color_key,
    role: row.role,
    order: row.scene_order,
    refs,
    x: row.x,
    y: row.y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function toEdge(row: EdgeRow): ChapterCanvasEdgeData {
  return parseChapterCanvasEdgeRow({
    id: row.id,
    canvasId: row.canvas_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    label: row.label,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function requireCanvasByChapter(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  chapterNumber: number,
): CanvasRow {
  if (!Number.isSafeInteger(chapterNumber) || (chapterNumber as number) < 1) {
    throw new Error('章节画布章节号无效')
  }
  const row = db.prepare(
    'SELECT * FROM chapter_canvases WHERE chapter_number = ?',
  ).get(chapterNumber) as CanvasRow | undefined
  if (!row) throw new Error('章节画布不存在')
  return row
}

/** 画布行按章节号惰性创建：首次保存节点 / 视口时才落行，读取永不副作用。 */
function ensureCanvasByChapter(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  chapterNumber: number,
): CanvasRow {
  if (!Number.isSafeInteger(chapterNumber) || (chapterNumber as number) < 1) {
    throw new Error('章节画布章节号无效')
  }
  const existing = db.prepare(
    'SELECT * FROM chapter_canvases WHERE chapter_number = ?',
  ).get(chapterNumber) as CanvasRow | undefined
  if (existing) return existing
  const id = chapterCanvasId(chapterNumber)
  db.prepare(`
    INSERT INTO chapter_canvases (id, chapter_number) VALUES (?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(id, chapterNumber)
  return requireCanvasByChapter(db, chapterNumber)
}

export interface ChapterCanvasNodeUpsertInput {
  id?: string
  chapterNumber: number
  type: unknown
  title: unknown
  summary: unknown
  colorKey?: unknown
  role?: unknown
  order?: unknown
  refs?: unknown
  x: unknown
  y: unknown
}

export class ChapterCanvasRepository {
  static get(chapterNumber: number): Omit<ChapterCanvasGraph, 'canvas'> & { canvas: ChapterCanvasMeta | null } {
    const db = requireDb()
    if (!Number.isSafeInteger(chapterNumber) || (chapterNumber as number) < 1) {
      throw new Error('章节画布章节号无效')
    }
    const row = db.prepare(
      'SELECT * FROM chapter_canvases WHERE chapter_number = ?',
    ).get(chapterNumber) as CanvasRow | undefined
    if (!row) return { canvas: null, nodes: [], edges: [] }
    const nodes = (db.prepare(
      'SELECT * FROM chapter_canvas_nodes WHERE canvas_id = ? ORDER BY created_at ASC, rowid ASC',
    ).all(row.id) as NodeRow[]).map(toNode)
    const edges = (db.prepare(
      'SELECT * FROM chapter_canvas_edges WHERE canvas_id = ? ORDER BY created_at ASC, rowid ASC',
    ).all(row.id) as EdgeRow[]).map(toEdge)
    return { canvas: toMeta(row), nodes, edges }
  }

  static saveViewport(chapterNumber: number, viewport: { x: number; y: number; zoom: number }): void {
    const db = requireDb()
    const parsed = parsePlotCanvasViewport(viewport)
    if (!parsed) throw new Error('章节画布视口无效')
    const tx = db.transaction(() => {
      const canvas = ensureCanvasByChapter(db, chapterNumber)
      db.prepare(`
        UPDATE chapter_canvases SET viewport_json = ?, updated_at = datetime('now') WHERE id = ?
      `).run(JSON.stringify(parsed), canvas.id)
    })
    tx()
  }

  static nodeUpsert(input: ChapterCanvasNodeUpsertInput): ChapterCanvasNodeData {
    const db = requireDb()
    if (!isChapterCanvasNodeType(input.type)) throw new Error('章节画布节点类型无效')
    const text = parsePlotCanvasNodeText({
      title: input.title,
      summary: input.summary,
      titleLimit: 160,
      summaryLimit: 2000,
    })
    const role = input.role === undefined || input.role === null ? '' : input.role
    if (!isChapterCanvasSceneRole(role)) throw new Error('章节画布场景定位无效')
    const order = input.order === undefined || input.order === null ? null : input.order
    if (order !== null && (!Number.isSafeInteger(order) || (order as number) < 1)) {
      throw new Error('章节画布场景顺序无效')
    }
    const colorKey = input.colorKey === undefined || input.colorKey === null
      ? 'default'
      : input.colorKey
    if (typeof colorKey !== 'string'
      || !['default', 'accent', 'success', 'warning', 'danger'].includes(colorKey)) {
      throw new Error('章节画布节点颜色无效')
    }
    const refs = parseChapterCanvasNodeRefs(input.refs)
    const position = parsePlotCanvasPosition({ x: input.x, y: input.y })
    if (!position) throw new Error('章节画布节点坐标无效')

    const tx = db.transaction(() => {
      const canvas = ensureCanvasByChapter(db, input.chapterNumber)
      if (input.id) {
        const existing = db.prepare(
          'SELECT canvas_id FROM chapter_canvas_nodes WHERE id = ?',
        ).get(input.id) as { canvas_id: string } | undefined
        if (existing && existing.canvas_id !== canvas.id) {
          throw new Error('画布节点归属章节不匹配')
        }
        if (existing) {
          db.prepare(`
            UPDATE chapter_canvas_nodes
            SET type = ?, title = ?, summary = ?, color_key = ?, role = ?, scene_order = ?,
                refs_json = ?, x = ?, y = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(input.type, text.title, text.summary, colorKey, role, order,
            JSON.stringify(refs), position.x, position.y, input.id)
          return db.prepare('SELECT * FROM chapter_canvas_nodes WHERE id = ?').get(input.id) as NodeRow
        }
        // 带 id 但行不存在：直接以此 id 落行，保证幂等重试。
      }
      const count = (db.prepare(
        'SELECT COUNT(*) AS count FROM chapter_canvas_nodes WHERE canvas_id = ?',
      ).get(canvas.id) as { count: number }).count
      if (count >= MAX_CHAPTER_CANVAS_NODES) {
        throw new Error(`单章画布最多 ${MAX_CHAPTER_CANVAS_NODES} 个节点`)
      }
      const id = input.id ?? createChapterCanvasNodeId()
      db.prepare(`
        INSERT INTO chapter_canvas_nodes
          (id, canvas_id, type, title, summary, color_key, role, scene_order, refs_json, x, y)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, canvas.id, input.type, text.title, text.summary, colorKey, role, order,
        JSON.stringify(refs), position.x, position.y)
      return db.prepare('SELECT * FROM chapter_canvas_nodes WHERE id = ?').get(id) as NodeRow
    })
    return toNode(tx())
  }

  /** 删除节点与其全部连线在同一事务中完成；只删画布卡，绝不触碰权威资料。 */
  static nodeDelete(chapterNumber: number, nodeId: string): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      const canvas = requireCanvasByChapter(db, chapterNumber)
      const existing = db.prepare(
        'SELECT canvas_id FROM chapter_canvas_nodes WHERE id = ?',
      ).get(nodeId) as { canvas_id: string } | undefined
      if (!existing) throw new Error('要删除的画布节点不存在')
      if (existing.canvas_id !== canvas.id) throw new Error('画布节点归属章节不匹配')
      db.prepare(
        'DELETE FROM chapter_canvas_edges WHERE source_node_id = ? OR target_node_id = ?',
      ).run(nodeId, nodeId)
      db.prepare('DELETE FROM chapter_canvas_nodes WHERE id = ?').run(nodeId)
    })
    tx()
  }

  /** 拖动结束后的批量坐标回写；一次事务，幂等可重试。 */
  static nodeReposition(
    chapterNumber: number,
    positions: Array<{ nodeId: string; x: number; y: number }>,
  ): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      const canvas = requireCanvasByChapter(db, chapterNumber)
      for (const item of positions) {
        const position = parsePlotCanvasPosition({ x: item.x, y: item.y })
        if (!position) throw new Error('章节画布节点坐标无效')
        db.prepare(`
          UPDATE chapter_canvas_nodes SET x = ?, y = ?, updated_at = datetime('now')
          WHERE id = ? AND canvas_id = ?
        `).run(position.x, position.y, item.nodeId, canvas.id)
      }
    })
    tx()
  }

  static edgeUpsert(input: {
    id?: string
    chapterNumber: number
    sourceNodeId: string
    targetNodeId: string
    label: unknown
    kind?: unknown
  }): ChapterCanvasEdgeData {
    const db = requireDb()
    if (typeof input.label !== 'string' || input.label.length > 60) {
      throw new Error('章节画布连线标签无效')
    }
    const kind = input.kind === undefined || input.kind === null ? 'main' : input.kind
    if (kind !== 'main' && kind !== 'aux') throw new Error('章节画布连线种类无效')
    if (input.sourceNodeId === input.targetNodeId) throw new Error('章节画布连线不能连接自身')
    const tx = db.transaction(() => {
      const canvas = ensureCanvasByChapter(db, input.chapterNumber)
      const source = db.prepare('SELECT id, canvas_id, type FROM chapter_canvas_nodes WHERE id = ?')
        .get(input.sourceNodeId) as { id: string; canvas_id: string; type: string } | undefined
      const target = db.prepare('SELECT id, canvas_id, type FROM chapter_canvas_nodes WHERE id = ?')
        .get(input.targetNodeId) as { id: string; canvas_id: string; type: string } | undefined
      if (!source || !target) throw new Error('章节画布连线端点节点不存在')
      if (source.canvas_id !== canvas.id || target.canvas_id !== canvas.id) {
        throw new Error('画布连线必须留在同一章内')
      }
      // 参考项目的章节画布禁止场景↔场景连线：主线顺序由 scene_order 表达，
      // 主线推进感由渲染层按顺序自动绘制，用户连线只负责辅助关系。
      if (source.type === 'scene' && target.type === 'scene') {
        throw new Error('场景之间不需要连线：拖动「顺序」字段即可排列主线')
      }
      if (input.id) {
        const existing = db.prepare(
          'SELECT canvas_id, source_node_id, target_node_id FROM chapter_canvas_edges WHERE id = ?',
        ).get(input.id) as { canvas_id: string; source_node_id: string; target_node_id: string } | undefined
        if (existing) {
          if (existing.canvas_id !== canvas.id) throw new Error('画布连线归属章节不匹配')
          if (existing.source_node_id !== input.sourceNodeId || existing.target_node_id !== input.targetNodeId) {
            throw new Error('画布连线端点不可变更，请删除后重新连接')
          }
          db.prepare(`
            UPDATE chapter_canvas_edges SET label = ?, kind = ?, updated_at = datetime('now') WHERE id = ?
          `).run(input.label, kind, input.id)
          return db.prepare('SELECT * FROM chapter_canvas_edges WHERE id = ?').get(input.id) as EdgeRow
        }
        // 带 id 但行不存在：按新连线插入，保证幂等重试。
      }
      const duplicate = db.prepare(`
        SELECT id FROM chapter_canvas_edges
        WHERE canvas_id = ?
          AND (
            (source_node_id = ? AND target_node_id = ?)
            OR (source_node_id = ? AND target_node_id = ?)
          )
      `).get(canvas.id, input.sourceNodeId, input.targetNodeId,
        input.targetNodeId, input.sourceNodeId) as { id: string } | undefined
      if (duplicate) throw new Error('两个画布节点之间已存在连线')
      const id = input.id ?? createChapterCanvasEdgeId()
      db.prepare(`
        INSERT INTO chapter_canvas_edges (id, canvas_id, source_node_id, target_node_id, label, kind)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, canvas.id, input.sourceNodeId, input.targetNodeId, input.label, kind)
      return db.prepare('SELECT * FROM chapter_canvas_edges WHERE id = ?').get(id) as EdgeRow
    })
    return toEdge(tx())
  }

  static edgeDelete(chapterNumber: number, edgeId: string): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      const canvas = requireCanvasByChapter(db, chapterNumber)
      const existing = db.prepare(
        'SELECT canvas_id FROM chapter_canvas_edges WHERE id = ?',
      ).get(edgeId) as { canvas_id: string } | undefined
      if (!existing) throw new Error('要删除的画布连线不存在')
      if (existing.canvas_id !== canvas.id) throw new Error('画布连线归属章节不匹配')
      db.prepare('DELETE FROM chapter_canvas_edges WHERE id = ?').run(edgeId)
    })
    tx()
  }

  /** 章节生命周期删除时的画布数据清理；幂等，不抛“不存在”错误。 */
  static deleteByChapter(chapterNumber: number): void {
    const db = requireDb()
    if (!Number.isSafeInteger(chapterNumber) || (chapterNumber as number) < 1) return
    const canvasId = chapterCanvasId(chapterNumber)
    const tx = db.transaction(() => {
      db.prepare(`
        DELETE FROM chapter_canvas_edges WHERE canvas_id = ?
      `).run(canvasId)
      db.prepare(`
        DELETE FROM chapter_canvas_nodes WHERE canvas_id = ?
      `).run(canvasId)
      db.prepare('DELETE FROM chapter_canvases WHERE id = ?').run(canvasId)
    })
    tx()
  }
}
