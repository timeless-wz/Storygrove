#!/usr/bin/env node
// L0 验收登记扫描器（方案第 2、4 节）：入口契约 ↔ IPC 处理器 ↔ 存储表 交叉登记。
// 静态扫描只提供登记候选；动态 SQL/通道、UI 入口及误匹配仍需核对。
// 输出：ipc-inventory.json / storage-inventory.json / inventory.md（均写入本目录）。
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import ts from 'typescript'

function sqlStrings(file) {
  const source = fs.readFileSync(file, 'utf8')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const sql = []
  const visit = node => {
    let text
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text
    if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map(span => ' __dynamic__ ' + span.literal.text).join('')
    if (text !== undefined) {
      text = text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      if (/^\s*(?:__dynamic__\s*)*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH|BEGIN)\b/i.test(text)) sql.push(text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return sql.join('\n')
}

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../..')
const outDir = path.dirname(url.fileURLToPath(import.meta.url))

function listFiles(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      listFiles(full, ext, out)
    } else if (entry.name.endsWith(ext)) {
      out.push(full)
    }
  }
  return out
}

// ---------- 1. 通道声明（src/shared/ipc-channels.ts + phase3-8.ts） ----------
function parseDeclaredChannels() {
  const invoke = new Map() // channel -> interface name
  const events = new Map()
  const files = ['src/shared/ipc-channels.ts', 'src/shared/phase3-8.ts']
  for (const rel of files) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    let current = null
    for (const rawLine of src.split(/\r?\n/)) {
      const iface = rawLine.match(/^\s*export\s+interface\s+(\w+)/)
      if (iface) { current = iface[1]; continue }
      const key = rawLine.match(/^\s*'([a-z0-9-]+:[a-z0-9-]+)'\s*:/)
      if (key && current) {
        const target = /(?:Events|EventChannels)$/.test(current) ? events : invoke
        if (!target.has(key[1])) target.set(key[1], [])
        target.get(key[1]).push(`${rel}#${current}`)
      }
    }
  }
  return { invoke, events }
}

// ---------- 2. 处理器注册（electron/controllers + mcp bridge） ----------
function parseHandlers() {
  const handlers = [] // { channel, file }
  const files = [
    ...listFiles(path.join(repoRoot, 'electron/controllers'), '.ts'),
    path.join(repoRoot, 'electron/mcp/mcp-ipc-bridge.ts'),
  ].filter(Boolean)
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    // 命中所有风格：ipcMain.handle('x', ...) / register('x', ...) / registerXxxHandler('x', ...)
    const re = /['"]([a-z0-9-]+:[a-z0-9-]+)['"]\s*,\s*(?:async\s*)?\(/g
    let m
    while ((m = re.exec(src))) {
      handlers.push({ channel: m[1], file: path.relative(repoRoot, file).replace(/\\/g, '/') })
    }
  }
  return handlers
}

// ---------- 3. 表声明（electron 全量 CREATE TABLE） ----------
function parseDeclaredTables() {
  const tables = new Map() // name -> [file]
  const files = listFiles(path.join(repoRoot, 'electron'), '.ts')
    .concat(listFiles(path.join(repoRoot, 'scripts'), '.mjs'))
  for (const file of files) {
    const src = sqlStrings(file)
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][A-Za-z0-9_]*)/gi
    let m
    while ((m = re.exec(src))) {
      const name = m[1]
      if (/^(IF|NOT|EXISTS|OR|AND|SELECT|TEMP|TEMPORARY)$/i.test(name)) continue
      if (!tables.has(name)) tables.set(name, [])
      const rel = path.relative(repoRoot, file).replace(/\\/g, '/')
      if (!tables.get(name).includes(rel)) tables.get(name).push(rel)
    }
  }
  return tables
}

// ---------- 4. 表使用者（repositories + services 的 DML） ----------
const SKIP_TABLES = /^(sqlite_|temp_|character_shared_relationships_name_legacy$)/
// 注释/字符串里的英文短句会被 DML 正则误命中，只保留真实可疑的表名
const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'if', 'not', 'set', 'before', 'better',
  'electron', 'file', 'its', 'node', 'one', 'real', 'silently', 'browserwindow', 'yauzl'])
function isNoise(name) { return STOPWORDS.has(name.toLowerCase()) }
function parseTableOwners() {
  const owners = new Map() // table -> Set(file)
  const dirs = ['electron/repositories', 'electron/services', 'electron/database.ts']
  const files = [
    ...listFiles(path.join(repoRoot, 'electron/repositories'), '.ts'),
    ...listFiles(path.join(repoRoot, 'electron/services'), '.ts'),
    path.join(repoRoot, 'electron/database.ts'),
    ...listFiles(path.join(repoRoot, 'scripts'), '.mjs'),
  ].filter(Boolean)
  for (const file of files) {
    const src = sqlStrings(file)
    const re = /\b(?:FROM|INTO|UPDATE|JOIN)\s+["'`[]?([a-z_][a-z0-9_]*)/gi
    let m
    while ((m = re.exec(src))) {
      const name = m[1]
      if (name === '__dynamic__' || SKIP_TABLES.test(name) || isNoise(name)) continue
      if (!owners.has(name)) owners.set(name, new Set())
      owners.get(name).add(path.relative(repoRoot, file).replace(/\\/g, '/'))
    }
  }
  return owners
}

// ---------- 汇总与交叉核对 ----------
const declared = parseDeclaredChannels()
const handlers = parseHandlers()
const tables = parseDeclaredTables()
const owners = parseTableOwners()

const handlerByChannel = new Map()
for (const h of handlers) {
  if (!handlerByChannel.has(h.channel)) handlerByChannel.set(h.channel, [])
  handlerByChannel.get(h.channel).push(h.file)
}

const declaredInvoke = [...declared.invoke.keys()]
const declaredEvents = [...declared.events.keys()]
const handledChannels = [...handlerByChannel.keys()]

const declaredWithoutHandler = declaredInvoke.filter((c) => !handlerByChannel.has(c))
const handlersWithoutDeclaration = handledChannels.filter((c) => !declared.invoke.has(c))

const declaredTableNames = [...tables.keys()]
const ownerTableNames = [...owners.keys()]
const orphanTables = declaredTableNames.filter((t) => !owners.has(t))
const unknownRefs = ownerTableNames.filter((t) => !tables.has(t))

const ipcInventory = {
  scanMode: 'static-candidates',
  generatedAt: new Date().toISOString(),
  repoRoot,
  declared: {
    invokeChannels: declaredInvoke.sort(),
    eventChannels: declaredEvents.sort(),
    counts: { invoke: declaredInvoke.length, events: declaredEvents.length },
  },
  handlers: {
    totalRegistrations: handlers.length,
    uniqueChannels: handledChannels.length,
    byFile: handlers.reduce((acc, h) => {
      ;(acc[h.file] ||= []).push(h.channel)
      return acc
    }, {}),
  },
  checks: {
    declaredWithoutHandler,
    handlersWithoutDeclaration,
    verdict: declaredWithoutHandler.length === 0 && handlersWithoutDeclaration.length === 0
      ? 'PASS: 声明与处理器一一对应'
      : 'REVIEW: 存在未映射项，见上',
  },
}

const storageInventory = {
  scanMode: 'static-candidates',
  limitations: ['Interpolated table names need manual resolution; SQL fragments and dynamic IPC are not proof of complete runtime coverage.'],
  generatedAt: new Date().toISOString(),
  repoRoot,
  declaredTables: {
    count: declaredTableNames.length,
    tables: declaredTableNames.sort().map((name) => ({ name, declaredIn: tables.get(name) })),
  },
  tableOwners: ownerTableNames.sort().map((name) => ({ name, files: [...owners.get(name)].sort() })),
  checks: {
    orphanTables: orphanTables.sort(),
    unknownRefs: unknownRefs.sort(),
  },
}

// ---------- Markdown 摘要 ----------
function mdList(items, empty) { return items.length ? items.map((i) => `- \`${i}\``).join('\n') : empty }

const md = `# L0 登记扫描结果

生成时间：${ipcInventory.generatedAt}
基线：静态扫描当前工作树（scanner: test/acceptance/inventory/scan-inventory.mjs）

## IPC 面

- 声明的 invoke 通道：**${declaredInvoke.length}**；事件通道：**${declaredEvents.length}**
- 实际注册处理器（唯一通道）：**${handledChannels.length}**（原始注册调用 ${handlers.length} 次）

### 交叉核对

- 声明但无处理器：${declaredWithoutHandler.length ? '\n' + mdList(declaredWithoutHandler, '') : '无'}
- 处理器但无声明（仅字面量）：${handlersWithoutDeclaration.length ? '\n' + mdList(handlersWithoutDeclaration.map((c) => `${c} ← ${handlerByChannel.get(c).join(', ')}`), '') : '无'}
- 结论：${ipcInventory.checks.verdict}

### 处理器分布

${Object.entries(ipcInventory.handlers.byFile).map(([f, chans]) => `- ${f}：${chans.length}`).join('\n')}

## 存储面（SQLite）

- 声明的表：**${declaredTableNames.length}**
- 有 DML 使用者的表：**${ownerTableNames.length}**

### 待查项（方案要求：无法归属的必须列为待查，不能默认忽略）

- 声明但无使用者（orphan）：${orphanTables.length ? '\n' + mdList(orphanTables.sort().map((t) => `${t}（声明于 ${tables.get(t).join('; ')}）`), '') : '无'}
- 使用但未声明（unknown）：${unknownRefs.length ? '\n' + mdList(unknownRefs.sort(), '') : '无'}

## 边界说明

本扫描只覆盖静态一致性。通道→用户入口（F01–F32）、表→事实源核对属行为验收，状态见
features.json 与阶段报告。扫描会读取桌面主进程与 scripts/ 下的实际脚本；注释匹配与动态
SQL/通道仍须人工核对，不能把正则候选数当作运行时完整登记证明。
`

fs.writeFileSync(path.join(outDir, 'ipc-inventory.json'), JSON.stringify(ipcInventory, null, 2))
fs.writeFileSync(path.join(outDir, 'storage-inventory.json'), JSON.stringify(storageInventory, null, 2))
fs.writeFileSync(path.join(outDir, 'inventory.md'), md)

console.log(`IPC: declared=${declaredInvoke.length}+${declaredEvents.length}(events) handlers=${handledChannels.length} unique`)
console.log(`  declaredWithoutHandler=${declaredWithoutHandler.length} handlersWithoutDeclaration=${handlersWithoutDeclaration.length}`)
console.log(`Storage: tables=${declaredTableNames.length} owned=${ownerTableNames.length} orphan=${orphanTables.length} unknownRefs=${unknownRefs.length}`)
if (handlersWithoutDeclaration.length) console.log('  literals:', handlersWithoutDeclaration.join(', '))
if (orphanTables.length) console.log('  orphan:', orphanTables.join(', '))
