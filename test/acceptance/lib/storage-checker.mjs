// 独立存储核对器（方案第 4 节）：不经应用代码，直接以只读连接回读 SQLite。
// 仅在 Node ABI 下调用（e2e 场景必须先恢复 prepare:native-node）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function openReadonly(dbPath) {
  const Database = require('better-sqlite3')
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

// 全库体检：integrity_check + foreign_key_check + 表清单与行数。
export function checkProjectDb(projectPath) {
  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  if (!fs.existsSync(dbPath)) return { ok: false, error: `missing db: ${dbPath}` }
  const db = openReadonly(dbPath)
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    const foreignKeyViolations = db.pragma('foreign_key_check')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name)
    const rowCount = {}
    for (const t of tables) {
      try {
        rowCount[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n
      } catch {
        rowCount[t] = 'ERROR'
      }
    }
    return {
      ok: integrity === 'ok' && foreignKeyViolations.length === 0 && !Object.values(rowCount).includes('ERROR'),
      dbPath,
      integrity,
      foreignKeyViolations,
      tableCount: tables.length,
      tables,
      rowCount,
    }
  } finally {
    db.close()
  }
}

// 语义快照：抽核心表的关键行，供重开前后与跨项目边界比对。
export function snapshotProject(projectPath) {
  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  const db = openReadonly(dbPath)
  try {
    // Invalid schema/query is an execution failure, never an ordinary snapshot row.
    const pick = (sql) => db.prepare(sql).all()
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)
    const tables = Object.fromEntries(tableNames.map(name => [name,
      pick(`SELECT * FROM "${name.replaceAll('"', '""')}"`).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]))
    return {
      dbPath,
      projectCore: pick('SELECT * FROM project_core'),
      drafts: pick('SELECT drafts.*, contents.body FROM drafts JOIN contents ON contents.id = drafts.content_id ORDER BY chapter_number, version, drafts.id'),
      blueprints: pick('SELECT * FROM blueprints ORDER BY chapter_number'),
      volumes: pick('SELECT * FROM blueprint_volumes ORDER BY sort_order, id'),
      characters: pick('SELECT * FROM characters ORDER BY name'),
      worlds: tables.worlds ?? [],
      tables,
    }
  } finally {
    db.close()
  }
}

// 项目 manifest 独立校验（不经 projectAccess 代码）。
export function readProjectManifest(projectPath) {
  const full = path.join(projectPath, '.vela', 'project.json')
  if (!fs.existsSync(full)) return { ok: false, error: 'missing .vela/project.json' }
  try {
    const manifest = JSON.parse(fs.readFileSync(full, 'utf8'))
    const ok = manifest.schemaVersion === 1 && manifest.kind === 'ai-novel-project'
      && typeof manifest.projectId === 'string' && manifest.projectId.length >= 32
    return { ok, manifest, path: full }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function assertIsolation(projectA, projectB) {
  const a = snapshotProject(projectA)
  const b = snapshotProject(projectB)
  const aTitles = a.projectCore.map((r) => r.project_name).join('|')
  const bTitles = b.projectCore.map((r) => r.project_name).join('|')
  const aDrafts = a.drafts.length
  const bDrafts = b.drafts.length
  return {
    // Require unique nonempty markers, and reject the other project's marker
    // in any domain table (including prose), rather than comparing titles only.
    ok: Boolean(aTitles && bTitles && aTitles !== bTitles)
      && !JSON.stringify(a.tables).includes(bTitles)
      && !JSON.stringify(b.tables).includes(aTitles),
    a: { core: aTitles, drafts: aDrafts },
    b: { core: bTitles, drafts: bDrafts },
  }
}
