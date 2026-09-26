import type { CSSProperties } from 'react'

const ROLE_TONES: Record<string, { surface: string; text: string }> = {
  protagonist: { surface: '--color-warning', text: '--color-warning-text' },
  antagonist: { surface: '--color-error', text: '--color-error-text' },
  supporting: { surface: '--color-accent', text: '--color-accent-text' },
  minor: { surface: '--color-border', text: '--color-text-secondary' },
  unassigned: { surface: '--color-border', text: '--color-text-muted' },
}

export function characterRoleColors(role: string): CSSProperties {
  const tone = ROLE_TONES[role] ?? ROLE_TONES.unassigned
  return {
    color: `var(${tone.text})`,
    backgroundColor: `color-mix(in srgb, var(${tone.surface}) 12%, transparent)`,
    borderColor: `color-mix(in srgb, var(${tone.surface}) 30%, transparent)`,
  }
}
