/** 章节标题内存缓存：path → 显示名（进程内常驻，避免大量重复 IPC 读取）。
    值为按当时 UI 语言算好的显示名，因此键必须包含语言：
    否则中英切换（运行时切换与测试内切换都一样）会命中旧语言的缓存值。 */
export const chapterTitleCache = new Map<string, string>()

/** Keep virtual manuscript paths isolated between project sessions and locales. */
export function chapterTitleCacheKey(projectPath: string, filePath: string, locale = ''): string {
  return `${projectPath}\u0000${filePath}\u0000${locale}`
}

/** 清除特定文件的章节标题缓存。 */
export function clearChapterTitleCache(filePath?: string): void {
  if (filePath) {
    for (const key of chapterTitleCache.keys()) {
      if (key === filePath || key.includes(`\u0000${filePath}\u0000`) || key.endsWith(`\u0000${filePath}`)) {
        chapterTitleCache.delete(key)
      }
    }
    return
  }
  chapterTitleCache.clear()
}
