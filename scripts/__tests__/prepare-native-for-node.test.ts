import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import { prepareNativeForNode } from '../prepare-native-for-node.mjs'

describe('prepare native dependencies for the ordinary Node runtime', () => {
  it('is the preparation step used by the release gate', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(packageJson.scripts['prepare:native-node']).toBe('node scripts/prepare-native-for-node.mjs')
  })

  it('returns immediately when the Node ABI binding already loads', async () => {
    const probe = vi.fn().mockReturnValue(true)
    const install = vi.fn()

    await expect(prepareNativeForNode({ probe, install })).resolves.toEqual({ repaired: false })
    expect(probe).toHaveBeenCalledOnce()
    expect(install).not.toHaveBeenCalled()
  })

  it('reinstalls the binding only when the Node ABI probe fails', async () => {
    const probe = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const install = vi.fn().mockReturnValue({ ok: true, diagnostic: '' })

    await expect(prepareNativeForNode({ probe, install })).resolves.toEqual({ repaired: true })
    expect(install).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('retries a transient Windows file-lock failure instead of failing the gate', async () => {
    const probe = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const install = vi.fn()
      .mockReturnValueOnce({
        ok: false,
        diagnostic: 'EPERM: operation not permitted, rename better_sqlite3.node',
      })
      .mockReturnValueOnce({ ok: true, diagnostic: '' })
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(prepareNativeForNode({ probe, install, sleep })).resolves.toEqual({ repaired: true })
    expect(install).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('fails fast on a non-transient installation failure', async () => {
    const probe = vi.fn().mockReturnValue(false)
    const install = vi.fn().mockReturnValue({
      ok: false,
      diagnostic: 'prebuild-install ERR! No prebuilt binaries found for NODE_MODULE_VERSION 137',
    })
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(prepareNativeForNode({ probe, install, sleep })).rejects.toThrow(
      'NODE_MODULE_VERSION 137',
    )
    expect(install).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('fails closed when a persistent lock error outlives every retry', async () => {
    const probe = vi.fn().mockReturnValue(false)
    const install = vi.fn().mockReturnValue({
      ok: false,
      diagnostic: 'EBUSY: resource busy or locked, unlink better_sqlite3.node',
    })
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(prepareNativeForNode({ probe, install, sleep })).rejects.toThrow(
      'Failed to prepare better-sqlite3 for Node',
    )
    expect(install).toHaveBeenCalledTimes(20)
    expect(sleep).toHaveBeenCalledTimes(19)
  })

  it('rejects an install that reports success without a loadable binding', async () => {
    const probe = vi.fn().mockReturnValue(false)
    const install = vi.fn().mockReturnValue({ ok: true, diagnostic: '' })

    await expect(prepareNativeForNode({ probe, install })).rejects.toThrow(
      'Failed to prepare better-sqlite3 for Node',
    )
    expect(install).toHaveBeenCalledOnce()
  })
})
