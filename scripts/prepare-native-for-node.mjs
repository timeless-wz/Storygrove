/* eslint-env node */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const scriptPath = fileURLToPath(import.meta.url)

const MAX_INSTALL_ATTEMPTS = 5
const INSTALL_RETRY_DELAY_MS = 1_000

// Windows keeps the native binding mapped for as long as any Node or Electron
// process holds it, so rewriting better_sqlite3.node can fail with a sharing or
// permission error even though the packaged binary itself is fine. Those errors
// are transient and worth retrying; an ABI or toolchain error is not.
const TRANSIENT_INSTALL_ERROR =
  /EBUSY|EPERM|EACCES|resource busy|being used by another process|access is denied|operation not permitted|请稍后再试/i

function resolveBetterSqlite3Package() {
  const require = createRequire(import.meta.url)
  const packageRoot = path.dirname(require.resolve('better-sqlite3/package.json'))
  return {
    packageRoot,
    packageRequire: createRequire(path.join(packageRoot, 'package.json')),
  }
}

export function probeNodeNativeBinding() {
  const { packageRequire } = resolveBetterSqlite3Package()
  let db
  try {
    const Database = packageRequire('better-sqlite3')
    db = new Database(':memory:')
    return db.prepare('select 1 as ok').get()?.ok === 1
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      // A binding that failed to load cannot be closed; the probe already failed.
    }
  }
}

export function installPrebuiltNodeBinding() {
  const { packageRoot, packageRequire } = resolveBetterSqlite3Package()
  const prebuildInstall = packageRequire.resolve('prebuild-install/bin.js')

  const install = spawnSync(process.execPath, [prebuildInstall], {
    cwd: packageRoot,
    env: {
      ...process.env,
      npm_config_runtime: 'node',
      npm_config_target: process.versions.node,
    },
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
  })
  if (install.error) throw install.error

  return {
    ok: install.status === 0,
    diagnostic: `${install.stdout ?? ''}${install.stderr ?? ''}${
      install.signal ? ` (signal ${install.signal})` : ''
    }`,
  }
}

/**
 * Return the worktree to the ordinary Node ABI.
 *
 * An already-loadable binding is preferred: rewriting a valid native module is
 * what makes this step fail under Windows lock contention, and the release gate
 * requires this operation to stay idempotent because its independent fallback
 * re-runs it after a monitored attempt that may have already succeeded.
 */
export async function prepareNativeForNode({
  probe = probeNodeNativeBinding,
  install = installPrebuiltNodeBinding,
  sleep = delay,
} = {}) {
  if (probe()) return { repaired: false }

  let lastDiagnostic = ''
  for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt += 1) {
    let outcome
    try {
      outcome = install()
    } catch (error) {
      lastDiagnostic = error instanceof Error ? error.message : String(error)
      outcome = { ok: false, diagnostic: lastDiagnostic }
    }
    if (outcome.ok) {
      if (!probe()) {
        throw new Error(`Failed to prepare better-sqlite3 for Node ${process.versions.node}`)
      }
      return { repaired: true }
    }

    lastDiagnostic = outcome.diagnostic.trim() || lastDiagnostic
    if (attempt === MAX_INSTALL_ATTEMPTS || !TRANSIENT_INSTALL_ERROR.test(lastDiagnostic)) break
    console.warn(
      `better-sqlite3 Node ABI preparation hit a transient file-lock error (attempt ${attempt} of ${MAX_INSTALL_ATTEMPTS}); retrying`,
    )
    await sleep(INSTALL_RETRY_DELAY_MS)
  }

  throw new Error(
    `Failed to prepare better-sqlite3 for Node ${process.versions.node}${
      lastDiagnostic ? `: ${lastDiagnostic}` : ''
    }`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = await prepareNativeForNode()
  console.log(`Verified better-sqlite3 for Node ABI ${process.versions.modules}`)
  if (result.repaired) {
    console.log(`Reinstalled the prebuilt better-sqlite3 binding for Node ${process.versions.node}`)
  }
}
