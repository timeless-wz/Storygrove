import { describe, expect, it } from 'vitest'

import {
  CHARACTER_ROLES,
  CHARACTER_ROLE_LABELS,
  DEFAULT_CHARACTER_CREATION_ROLE,
  getCharacterRoleLabels,
  normalizeCharacterRole,
} from '../character-role'

describe('character role domain', () => {
  it('preserves every canonical character role', () => {
    expect(normalizeCharacterRole('protagonist')).toBe('protagonist')
    expect(normalizeCharacterRole('antagonist')).toBe('antagonist')
    expect(normalizeCharacterRole('supporting')).toBe('supporting')
    expect(normalizeCharacterRole('minor')).toBe('minor')
  })

  it('defaults a missing role to supporting', () => {
    expect(normalizeCharacterRole(undefined)).toBe('supporting')
  })

  it('defaults an unknown role to supporting', () => {
    expect(normalizeCharacterRole('legacy-custom-role')).toBe('supporting')
  })

  it('maps the documented legacy aliases already accepted by character generation', () => {
    expect(normalizeCharacterRole('主角')).toBe('protagonist')
    expect(normalizeCharacterRole('villain')).toBe('antagonist')
    expect(normalizeCharacterRole('重要配角')).toBe('supporting')
    expect(normalizeCharacterRole('次要角色')).toBe('minor')
    expect(normalizeCharacterRole('龙套')).toBe('minor')
  })

  it('exposes canonical keys and locale-neutral labels from one shared seam', () => {
    expect(CHARACTER_ROLES).toEqual([
      'protagonist',
      'antagonist',
      'supporting',
      'minor',
      'unassigned',
    ])
    expect(getCharacterRoleLabels('protagonist')).toEqual({
      zhCN: '主角',
      enUS: 'Protagonist',
    })
    expect(getCharacterRoleLabels('legacy-custom-role')).toEqual({
      zhCN: '配角',
      enUS: 'Supporting character',
    })
  })

  it('keeps the persisted minor key while presenting it as the other option', () => {
    // 历史项目里的 minor 数据一字不改，只是展示文案统一为“其他”。
    expect(normalizeCharacterRole('minor')).toBe('minor')
    expect(CHARACTER_ROLE_LABELS.minor).toEqual({ zhCN: '其他', enUS: 'Other' })
    expect(normalizeCharacterRole('其他')).toBe('minor')
  })

  it('round-trips the explicitly unassigned role without falling back to supporting', () => {
    expect(normalizeCharacterRole('unassigned')).toBe('unassigned')
    expect(normalizeCharacterRole('暂未设定')).toBe('unassigned')
    expect(normalizeCharacterRole('未设定')).toBe('unassigned')
    expect(normalizeCharacterRole('待定')).toBe('unassigned')
    expect(getCharacterRoleLabels('unassigned')).toEqual({ zhCN: '暂未设定', enUS: 'Not set yet' })
    expect(DEFAULT_CHARACTER_CREATION_ROLE).not.toBe('supporting')
    expect(CHARACTER_ROLE_LABELS[DEFAULT_CHARACTER_CREATION_ROLE].zhCN).toBe('暂未设定')
  })
})
