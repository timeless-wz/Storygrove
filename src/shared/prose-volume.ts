/** Explicit prose assignments override legacy planning membership, including null (unassigned). */
export function volumeChapterNumbers(
  volumeId: string,
  blueprints: Array<{ chapterNumber: number; volumeId?: string | null }>,
  assignments: Array<{ chapterNumber: number; volumeId: string | null }> = [],
): number[] {
  const memberships = new Map(blueprints.map(item => [item.chapterNumber, item.volumeId ?? 'volume-1']))
  for (const assignment of assignments) memberships.set(assignment.chapterNumber, assignment.volumeId ?? '')
  return [...memberships].filter(([, id]) => id === volumeId).map(([number]) => number).sort((a, b) => a - b)
}
