import {
  assertPlotTreeSnapshot,
  type PlotTreeEvent,
  type PlotTreeSnapshot,
  type PlotTreeSourceBundle,
  type PlotTreeTrack,
} from '../shared/plot-tree'

export function extractBlueprintOutlineSummary(bp: {
  title?: string
  purpose?: string
  keyEvents?: string
  userGuidance?: string
}): string {
  if (bp.userGuidance && typeof bp.userGuidance === 'string') {
    const lines = bp.userGuidance.split('\n').map(l => l.trim()).filter(Boolean)
    const genericHeadings = new Set([
      '大纲', '本章大纲', '核心大纲', '剧情大纲', '大纲摘要', '大纲指引', '大纲核心',
      '摘要', '本章摘要', '核心摘要', '剧情规划', '章节规划', '写作指引', '提示',
    ])
    for (const line of lines) {
      let clean = line.replace(/^[#*\-•\d.、\s]+/, '').replace(/^【(.*?)】$/, '$1').trim()
      if (
        genericHeadings.has(clean) ||
        /^(?:本章|核心|剧情|章节|写作)?(?:大纲|摘要|规划|指引|提示)(?:核心|指引|摘要|规划)?[：:]?$/.test(clean)
      ) {
        continue
      }
      clean = clean.replace(/^(?:本章)?(?:核心)?(?:剧情)?(?:大纲|摘要|规划|指引|提示)[：:]\s*/, '').trim()
      if (clean.length >= 2) {
        return clean
      }
    }
  }
  return bp.purpose?.trim() || bp.keyEvents?.trim() || ''
}

interface VolumeInfo {
  volumeNumber: number
  volumeTitle: string
}

function parseVolumeNumber(str: string): number {
  const num = parseInt(str, 10)
  if (!Number.isNaN(num)) return num
  const map: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  }
  return map[str] || 1
}

function parseSynopsisVolumeRanges(synopsis: string): Array<VolumeInfo & { start: number; end: number }> {
  if (!synopsis) return []
  const ranges: Array<VolumeInfo & { start: number; end: number }> = []
  const regex = /(?:^|\n)#*\s*(?:第([0-9]+|[一二三四五六七八九十]+)卷|卷([0-9]+|[一二三四五六七八九十]+))[：:\s]*([^\n]*)([\s\S]*?)(?=(?:\n#*\s*(?:第[0-9一二三四五六七八九十]+卷|卷[0-9一二三四五六七八九十]+))|$)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(synopsis)) !== null) {
    const rawNum = match[1] || match[2]
    const num = parseVolumeNumber(rawNum)
    const titleSuffix = (match[3] || '').trim()
    const volTitle = titleSuffix ? `第${rawNum}卷 ${titleSuffix}` : `第${rawNum}卷`
    const body = match[4] || ''
    const rangeMatch = body.match(/(?:第\s*)?(\d+)\s*[章回]?[至到~-](?:第\s*)?(\d+)\s*[章回]?/)
    if (rangeMatch) {
      ranges.push({
        volumeNumber: num,
        volumeTitle: volTitle,
        start: parseInt(rangeMatch[1], 10),
        end: parseInt(rangeMatch[2], 10),
      })
    }
  }
  return ranges
}

interface ChapterVolumeSource {
  title?: string
  purpose?: string
  keyEvents?: string
  userGuidance?: string
  volumeNumber?: number
  volumeTitle?: string
  volume?: number | string
}

function detectChapterVolume(
  ch: number,
  bp: ChapterVolumeSource | null | undefined,
  synopsisRanges: Array<VolumeInfo & { start: number; end: number }>,
): VolumeInfo | null {
  if (bp) {
    if (typeof bp.volumeNumber === 'number' && Number.isSafeInteger(bp.volumeNumber)) {
      return {
        volumeNumber: bp.volumeNumber,
        volumeTitle: bp.volumeTitle || `第${bp.volumeNumber}卷`,
      }
    }
    if (typeof bp.volume === 'number' && Number.isSafeInteger(bp.volume)) {
      return {
        volumeNumber: bp.volume,
        volumeTitle: bp.volumeTitle || `第${bp.volume}卷`,
      }
    }
    if (typeof bp.volume === 'string' && bp.volume.trim()) {
      const match = bp.volume.match(/(?:第([0-9]+|[一二三四五六七八九十]+)卷|卷([0-9]+|[一二三四五六七八九十]+))([^\n]*)/)
      if (match) {
        const rawNum = match[1] || match[2]
        const num = parseVolumeNumber(rawNum)
        const suffix = (match[3] || '').trim().replace(/^[:：\s]+/, '')
        return {
          volumeNumber: num,
          volumeTitle: suffix ? `第${rawNum}卷 ${suffix}` : `第${rawNum}卷`,
        }
      }
    }
    if (bp.title && typeof bp.title === 'string') {
      const match = bp.title.match(/(?:第([0-9]+|[一二三四五六七八九十]+)卷|卷([0-9]+|[一二三四五六七八九十]+))([^\n:：]*)/)
      if (match) {
        const rawNum = match[1] || match[2]
        const num = parseVolumeNumber(rawNum)
        const suffix = (match[3] || '').trim()
        return {
          volumeNumber: num,
          volumeTitle: suffix ? `第${rawNum}卷 ${suffix}` : `第${rawNum}卷`,
        }
      }
    }
    if (bp.userGuidance && typeof bp.userGuidance === 'string') {
      const match = bp.userGuidance.match(/(?:【第([0-9]+|[一二三四五六七八九十]+)卷】|第([0-9]+|[一二三四五六七八九十]+)卷\s*[:：])([^\n】]*)/)
      if (match) {
        const rawNum = match[1] || match[2]
        const num = parseVolumeNumber(rawNum)
        const suffix = (match[3] || '').trim()
        return {
          volumeNumber: num,
          volumeTitle: suffix ? `第${rawNum}卷 ${suffix}` : `第${rawNum}卷`,
        }
      }
    }
  }

  for (const r of synopsisRanges) {
    if (ch >= r.start && ch <= r.end) {
      return { volumeNumber: r.volumeNumber, volumeTitle: r.volumeTitle }
    }
  }

  return null
}

export function rebuildPlotTreeDeterministic(sources: PlotTreeSourceBundle): PlotTreeSnapshot {
  const blueprints = Array.isArray(sources.blueprints) ? sources.blueprints : []
  const finalized = Array.isArray(sources.finalizedChapters) ? sources.finalizedChapters : []
  const threads = Array.isArray(sources.narrativeThreads) ? sources.narrativeThreads : []

  const finalizedByChapter = new Map(finalized.map(c => [c.chapterNumber, c]))
  const blueprintByChapter = new Map(blueprints.map(b => [b.chapterNumber, b]))

  // Gather all chapter numbers
  const chapterNumbers = new Set<number>()
  for (const b of blueprints) {
    if (Number.isSafeInteger(b.chapterNumber) && b.chapterNumber >= 1) {
      chapterNumbers.add(b.chapterNumber)
    }
  }
  for (const f of finalized) {
    if (Number.isSafeInteger(f.chapterNumber) && f.chapterNumber >= 1) {
      chapterNumbers.add(f.chapterNumber)
    }
  }

  if (chapterNumbers.size === 0) {
    // If only narrative threads exist
    for (const t of threads) {
      chapterNumbers.add(t.targetStartChapter)
      chapterNumbers.add(t.targetEndChapter)
    }
  }

  if (chapterNumbers.size === 0) {
    throw new Error('未找到章节蓝图或定稿事实，无法重建剧情树')
  }

  const sortedChapters = Array.from(chapterNumbers).sort((a, b) => a - b)

  // Mainline events
  const mainEvents: PlotTreeEvent[] = []
  for (const ch of sortedChapters) {
    const fin = finalizedByChapter.get(ch)
    const bp = blueprintByChapter.get(ch)

    if (fin) {
      const outlineSummary = bp ? extractBlueprintOutlineSummary(bp) : ''
      const summary = fin.summary?.trim() || fin.title?.trim() || (outlineSummary ? `${fin.title || bp?.title}：${outlineSummary}` : `第 ${ch} 章`)
      mainEvents.push({
        status: 'occurred',
        chapterNumber: ch,
        summary: summary.slice(0, 160),
        sources: [{ type: 'finalized-chapter', draftId: fin.draftId, chapterNumber: ch }],
      })
    } else if (bp) {
      const outlineSummary = extractBlueprintOutlineSummary(bp)
      const summary = outlineSummary
        ? (bp.title && !outlineSummary.startsWith(bp.title) ? `${bp.title}：${outlineSummary}` : outlineSummary)
        : (bp.title || `第 ${ch} 章规划`)
      mainEvents.push({
        status: 'planned',
        chapterNumber: ch,
        summary: summary.slice(0, 160),
        sources: [{ type: 'blueprint', chapterNumber: ch }],
      })
    }
  }

  // Volume detection
  const synopsisRanges = parseSynopsisVolumeRanges(sources.synopsis?.content || '')
  const chapterVolumeMap = new Map<number, VolumeInfo>()
  for (const ch of sortedChapters) {
    const bp = blueprintByChapter.get(ch)
    const vol = detectChapterVolume(ch, bp, synopsisRanges)
    if (vol) {
      chapterVolumeMap.set(ch, vol)
    }
  }

  const distinctVolumes = Array.from(
    new Map(Array.from(chapterVolumeMap.values()).map(v => [v.volumeNumber, v])).values()
  ).sort((a, b) => a.volumeNumber - b.volumeNumber)

  const mainTracks: PlotTreeTrack[] = []

  if (distinctVolumes.length <= 1) {
    // Neutral mainline without hardcoded volume labeling
    const startChapter = sortedChapters[0]
    const endChapter = sortedChapters[sortedChapters.length - 1]
    mainTracks.push({
      id: 'track-main',
      title: '主线',
      role: 'main',
      startChapter,
      endChapter,
      summary: `核心剧情主轴（第 ${startChapter} 章至第 ${endChapter} 章），包含全部蓝图与正文推进。`,
      events: mainEvents.length > 0 ? mainEvents : [{
        status: 'planned',
        chapterNumber: startChapter,
        summary: '主线起始节点',
        sources: [{ type: 'blueprint', chapterNumber: startChapter }],
      }],
    })
  } else {
    // Multi-volume split
    for (const vol of distinctVolumes) {
      const volChapters = sortedChapters.filter(ch => chapterVolumeMap.get(ch)?.volumeNumber === vol.volumeNumber)
      if (volChapters.length === 0) continue

      const vStart = Math.min(...volChapters)
      const vEnd = Math.max(...volChapters)
      const vEvents = mainEvents.filter(e => e.chapterNumber >= vStart && e.chapterNumber <= vEnd)

      mainTracks.push({
        id: `track-main-vol${vol.volumeNumber}`,
        title: `${vol.volumeTitle}主线`,
        role: 'main',
        startChapter: vStart,
        endChapter: vEnd,
        summary: `${vol.volumeTitle}核心剧情主轴（第 ${vStart} 章至第 ${vEnd} 章），包含全部蓝图与正文推进。`,
        events: vEvents.length > 0 ? vEvents : [{
          status: 'planned',
          chapterNumber: vStart,
          summary: `${vol.volumeTitle}起始节点`,
          sources: [{ type: 'blueprint', chapterNumber: vStart }],
        }],
      })
    }
  }

  // Subplot tracks from narrative threads
  const subplotTracks: PlotTreeTrack[] = []
  for (const thread of threads) {
    const tEvents: PlotTreeEvent[] = []

    for (const evt of thread.events) {
      if (evt.chapterNumber >= thread.targetStartChapter && evt.chapterNumber <= thread.targetEndChapter) {
        tEvents.push({
          status: 'occurred',
          chapterNumber: evt.chapterNumber,
          summary: `${thread.title}：${evt.evidence || evt.reason || evt.type}`.slice(0, 160),
          sources: [{
            type: 'narrative-thread',
            planId: thread.id,
            eventId: evt.id,
            chapterNumber: evt.chapterNumber,
          }],
        })
      }
    }

    if (tEvents.length === 0) {
      tEvents.push({
        status: 'planned',
        chapterNumber: thread.targetStartChapter,
        summary: `${thread.title}（规划中）：${thread.authorIntent || thread.type}`.slice(0, 160),
        sources: [{
          type: 'narrative-thread',
          planId: thread.id,
        }],
      })
    }

    const parentTrack = mainTracks.find(
      m => thread.targetStartChapter >= m.startChapter && thread.targetStartChapter <= m.endChapter
    ) || mainTracks[0]

    subplotTracks.push({
      id: `track-thread-${thread.id}`,
      title: thread.title,
      role: 'subplot',
      parentTrackId: parentTrack.id,
      startChapter: thread.targetStartChapter,
      endChapter: thread.targetEndChapter,
      summary: thread.authorIntent || `支线计划：${thread.title}`,
      events: tEvents,
    })
  }

  const snapshot: PlotTreeSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    writingLanguage: sources.writingLanguage || 'zh-CN',
    sourceRevision: sources.sourceRevision,
    tracks: [...mainTracks, ...subplotTracks],
  }

  return assertPlotTreeSnapshot(snapshot, sources)
}
