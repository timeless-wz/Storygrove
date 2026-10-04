export type ArchStepKey = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'

/**
 * The entry point is part of the launch contract. In particular, batch selection
 * starts empty, while a resume is permanently bound to one existing checkpoint.
 */
export type ArchitectureLaunchMode =
  | { kind: 'single'; step: ArchStepKey }
  | { kind: 'batch' }
  | { kind: 'resume'; step: 'worldbuilding' | 'synopsis' }

export const ARCH_STEP_ORDER: readonly ArchStepKey[] = [
  'premise',
  'characters',
  'worldbuilding',
  'synopsis',
]

/** These requirements mirror the source reads and guards in architecture.command.ts. */
const ARCH_STEP_PREREQUISITES: Readonly<Record<ArchStepKey, readonly ArchStepKey[]>> = {
  premise: [],
  characters: ['premise'],
  worldbuilding: ['premise'],
  synopsis: ['premise', 'characters', 'worldbuilding'],
}

export function getArchitecturePrerequisites(step: ArchStepKey): readonly ArchStepKey[] {
  return ARCH_STEP_PREREQUISITES[step]
}

/** Return the full prerequisite closure in workflow execution order. */
export function getRequiredArchitectureSteps(steps: readonly ArchStepKey[]): ArchStepKey[] {
  const required = new Set<ArchStepKey>()
  const visit = (step: ArchStepKey) => {
    for (const prerequisite of ARCH_STEP_PREREQUISITES[step]) {
      if (required.has(prerequisite)) continue
      required.add(prerequisite)
      visit(prerequisite)
    }
  }
  steps.forEach(visit)
  return ARCH_STEP_ORDER.filter(step => required.has(step))
}

/** Missing prerequisites are not inferred as selections; the author must choose them. */
export function getMissingArchitecturePrerequisites(
  selectedSteps: readonly ArchStepKey[],
  archStatus: Readonly<Record<string, boolean>>,
): ArchStepKey[] {
  const selected = new Set(selectedSteps)
  return getRequiredArchitectureSteps(selectedSteps)
    .filter(step => !archStatus[step] && !selected.has(step))
}

/** Explicitly include only prerequisites the author has agreed to generate. */
export function includeMissingArchitecturePrerequisites(
  selectedSteps: readonly ArchStepKey[],
  archStatus: Readonly<Record<string, boolean>>,
): ArchStepKey[] {
  const selected = new Set(selectedSteps)
  for (const step of getMissingArchitecturePrerequisites(selectedSteps, archStatus)) {
    selected.add(step)
  }
  return ARCH_STEP_ORDER.filter(step => selected.has(step))
}

export function createDefaultArchitectureSelection(
  launchMode: ArchitectureLaunchMode,
): Record<ArchStepKey, boolean> {
  const selected = launchMode.kind === 'batch'
    ? []
    : [launchMode.step]
  const selectedSet = new Set(selected)

  return {
    premise: selectedSet.has('premise'),
    characters: selectedSet.has('characters'),
    worldbuilding: selectedSet.has('worldbuilding'),
    synopsis: selectedSet.has('synopsis'),
  }
}
