// 隔离 fixture 构造器（方案第 3 节）：每次运行新建独立根目录。
// 目录契约：<root>/global-home electron-profile project-a project-b
//           source-fixtures export backup restored-project evidence
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export function createRunRoot({ label = 'run' } = {}) {
  const runId = `vela-acc-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`
  // Windows 的 os.tmpdir() 可能是 8.3 短路径（ADMINI~1），而应用主进程存 realpath 长路径，
  // path.resolve 不展开短名会导致 smoke marker / recent-projects 比对失败。
  // 用 homedir（长形态）拼 Temp 目录，从源头避开 8.3。
  const baseTmp = process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'Temp')
    : os.tmpdir()
  fs.mkdirSync(baseTmp, { recursive: true })
  const rawRoot = path.join(baseTmp, runId)
  fs.mkdirSync(rawRoot, { recursive: true })
  const root = fs.realpathSync(rawRoot)
  const dirs = {
    root,
    runId,
    globalHome: path.join(root, 'global-home'),
    electronProfile: path.join(root, 'electron-profile'),
    projectA: path.join(root, 'project-a'),
    projectB: path.join(root, 'project-b'),
    sourceFixtures: path.join(root, 'source-fixtures'),
    export: path.join(root, 'export'),
    backup: path.join(root, 'backup'),
    restoredProject: path.join(root, 'restored-project'),
    evidence: path.join(root, 'evidence'),
  }
  for (const [key, dir] of Object.entries(dirs)) {
    if (key !== 'runId') fs.mkdirSync(dir, { recursive: true })
  }
  return dirs
}

// 项目骨架：与 renderer-surface-e2e 一致的最小 manifest。
// schema 由应用 project:open → initProjectDatabase 真实创建，fixture 不预置任何表。
export function createProjectSkeleton(projectRoot, { marker } = {}) {
  const velaDir = path.join(projectRoot, '.vela')
  fs.mkdirSync(velaDir, { recursive: true })
  const manifest = {
    schemaVersion: 1,
    kind: 'ai-novel-project',
    projectId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(velaDir, 'project.json'), JSON.stringify(manifest, null, 2))
  if (marker) fs.writeFileSync(path.join(projectRoot, '.project-marker.txt'), marker, 'utf8')
  return manifest
}

// 外部资料 fixture（只读来源）：中文/空格文件名、重复章号、非法 UTF-8、损坏文件、状态标记。
export function createSourceFixtures(fixturesDir, { runMarker = 'MARKER-NONE' } = {}) {
  const files = {}
  const write = (rel, content, encoding = 'utf8') => {
    const full = path.join(fixturesDir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, encoding)
    files[rel] = full
  }
  write('confirmed 设定集.md', `# 确认设定\n\n修炼等级：练气-筑基-金丹\n独特标记：${runMarker}-CONFIRMED\n状态：confirmed\n`)
  write('candidate 灵感.md', `# 候选设定（未批准）\n\n独特标记：${runMarker}-CANDIDATE\n状态：candidate\n`)
  write('deprecated 旧稿.md', `# 废弃设定\n\n独特标记：${runMarker}-DEPRECATED\n状态：deprecated\n`)
  write('章节/第01章 开端.md', `# 第一章 开端\n\n林渊睁开眼，掌心多了一枚玄铁令。\n独特标记：${runMarker}-CH01\n`)
  write('章节/第 02 章 山门.md', `# 第二章 山门\n\n山门前的石阶共有三千级。\n独特标记：${runMarker}-CH02\n`)
  write('章节/第02章 重复章号.md', `# 第二章 重复章号样本\n\n这一章与上一章章号重复，用于发现导入歧义。\n独特标记：${runMarker}-CH02-DUP\n`)
  write('章节/非法UTF-8.md', Buffer.from([0xff, 0xfe, 0xd8, 0x00, 0x71, 0x03]), 'binary')
  write('章节/损坏的frontmatter.md', '---\ntitle: [未闭合\n---\n\n正文损坏样本。独特标记：' + runMarker + '-BROKEN\n')
  return { files, runMarker }
}

// 固定期望数据：常量写在测试里，绝不调用被测函数生成（方案第 3 节）。
export const EXPECTED = {
  projectACore: {
    novelTitle: '验收·甲',
    genre: '东方玄幻',
    writingLanguage: 'zh-CN',
  },
  projectBCore: {
    novelTitle: '验收·乙',
    genre: '都市异能',
    writingLanguage: 'zh-CN',
  },
}

// 来源完整性：导入/扫描前后哈希必须一致（证明只读）。
export function hashDirFiles(dir) {
  const out = {}
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const rel = path.relative(dir, full).replace(/\\/g, '/')
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      }
    }
  }
  walk(dir)
  return out
}

export function writeEvidence(dirs, name, data) {
  const full = path.join(dirs.evidence, name)
  fs.writeFileSync(full, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  return full
}
