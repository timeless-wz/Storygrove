// Use an independent copy of the same SQLite native release. Running the app
// must not rewrite a native module that a regression process has already loaded.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export function prepareIsolatedNodeRuntime() {
  const version = require('better-sqlite3/package.json').version
  const abi = process.versions.modules
  const archiveSuffix = `better-sqlite3-v${version}-node-v${abi}-${process.platform}-${process.arch}.tar.gz`
  const cache = path.join(process.env.npm_config_cache || (process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm-cache') : path.join(os.homedir(), '.npm')), '_prebuilds')
  const archiveName = fs.existsSync(cache) && fs.readdirSync(cache).find(name => name.endsWith(archiveSuffix))
  if (!archiveName) throw new Error(`Missing cached SQLite native release: ${archiveSuffix}`)
  const archive = path.join(cache, archiveName)
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  const root = path.join(repoRoot, '.runtime', 'acceptance-native', `${version}-node-${abi}-${digest.slice(0, 12)}`)
  fs.mkdirSync(root, { recursive: true })
  const binding = path.join(root, 'build', 'Release', 'better_sqlite3.node')
  if (!fs.existsSync(binding)) {
    const extraction = spawnSync('tar', ['-xzf', archive, '-C', root], { encoding: 'utf8', windowsHide: true })
    if (extraction.status !== 0) throw new Error(`Native extraction failed: ${extraction.stderr}`)
  }
  const Database = require('better-sqlite3')
  const db = new Database(':memory:', { nativeBinding: binding })
  try {
    if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('Isolated native probe failed')
  } finally { db.close() }
  const hook = path.join(root, 'sqlite-hook.cjs')
  // ESM 侧独立垫片：Module._load 补丁只覆盖 CJS require；Node 对 format:'commonjs' 的
  // load hook 返回值在"该文件已在 require 缓存里"时会忽略 source（.runtime/probe-esm-hook2.mjs
  // 已证），所以必须让裸名 'better-sqlite3' 解析到独立文件，由它按绝对路径取真模块再包一层。
  const realEntry = require.resolve('better-sqlite3/lib/index.js')
  const shim = path.join(root, 'sqlite-shim.cjs')
  fs.writeFileSync(shim, `'use strict';
const ABI = ${JSON.stringify(abi)};
const BINDING = ${JSON.stringify(binding)};
const REAL = ${JSON.stringify(realEntry)};
// ABI 不符（Electron 等）时原样导出真模块，绝不替换原生绑定。
if (process.versions.modules !== ABI) {
  module.exports = require(REAL);
} else {
  const Real = require(REAL);
  if (typeof Real !== 'function') {
    module.exports = Real;
  } else {
    // 真模块可能已被 sqlite-hook.cjs 包过一层（double wrap）：再包一层依然成立，
    // nativeBinding 仍指向独立副本，导出的 name 仍是 IsolatedDatabase。
    function IsolatedDatabase(filename, options) {
      return new Real(filename, { ...options, nativeBinding: BINDING });
    }
    Object.setPrototypeOf(IsolatedDatabase, Real);
    IsolatedDatabase.prototype = Real.prototype;
    for (const key of Object.getOwnPropertyNames(Real)) {
      if (!(key in IsolatedDatabase)) {
        try { Object.defineProperty(IsolatedDatabase, key, Object.getOwnPropertyDescriptor(Real, key)) } catch {}
      }
    }
    module.exports = IsolatedDatabase;
  }
}
`)
  // vitest 对外部化模块的 ESM 默认导入不走 CJS Module._load（探针已证），因此除了
  // CJS require 补丁，还要用 module.register 安装 ESM resolve+load hook：resolve 把裸名
  // 'better-sqlite3' 指向独立垫片（真模块已在 require 缓存里同样有效），load 保留作兜底，
  // 直接改写 better-sqlite3/lib/index.js 的导出源码。
  const esmHook = path.join(root, 'sqlite-esm-hook.mjs')
  const shimUrl = pathToFileURL(shim).href
  fs.writeFileSync(esmHook, `const ABI = ${JSON.stringify(abi)}
const BINDING = ${JSON.stringify(binding.replaceAll('\\\\', '/'))}
const SHIM = ${JSON.stringify(shimUrl)}
export async function resolve(specifier, context, nextResolve) {
  // Electron（ELECTRON_RUN_AS_NODE 探测等）ABI 不同，必须原样透传
  if (process.versions.modules !== ABI) return nextResolve(specifier, context)
  if (specifier !== 'better-sqlite3') return nextResolve(specifier, context)
  return { url: SHIM, format: 'commonjs', shortCircuit: true }
}
export async function load(url, context, nextLoad) {
  // Electron（ELECTRON_RUN_AS_NODE 探测等）ABI 不同，必须原样透传
  if (process.versions.modules !== ABI) return nextLoad(url, context)
  if (!url.replaceAll('\\\\', '/').endsWith('/better-sqlite3/lib/index.js')) return nextLoad(url, context)
  const fs = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const source = fs.readFileSync(fileURLToPath(url), 'utf8')
  const snippet = \`;(function (M) {
    if (!M || typeof M !== 'function') return
    function IsolatedDatabase(filename, options) { return new M(filename, { ...options, nativeBinding: \${JSON.stringify(BINDING)} }) }
    Object.setPrototypeOf(IsolatedDatabase, M)
    IsolatedDatabase.prototype = M.prototype
    for (const key of Object.getOwnPropertyNames(M)) {
      if (!(key in IsolatedDatabase)) {
        try { Object.defineProperty(IsolatedDatabase, key, Object.getOwnPropertyDescriptor(M, key)) } catch {}
      }
    }
    module.exports = IsolatedDatabase
  })(module.exports)\`
  return { format: 'commonjs', source: source + snippet, shortCircuit: true }
}
`)
  fs.writeFileSync(hook, `const Module = require('node:module');
const originalLoad = Module._load;
const { register } = Module;
const { pathToFileURL } = require('node:url');
// 已注册的 ESM hook 会改变 pnpm/npm 自身动态 import 的错误语义（pnpmfile 探测被破坏），
// 包管理器 CLI 进程只保留 CJS 补丁，不注册 ESM hook。
const entry = (process.argv[1] || '').replaceAll('\\\\', '/');
const isPackageManagerCli = /(^|\\/)(pnpm|npm-cli|yarn|corepack)(\\.c?js)?$/.test(entry) || /node_modules\\/(pnpm|npm|yarn|corepack)\\//.test(entry);
if (!isPackageManagerCli) {
  try {
    register(pathToFileURL(${JSON.stringify(esmHook.replaceAll('\\\\', '/'))}).href, pathToFileURL(${JSON.stringify(hook.replaceAll('\\\\', '/'))}).href);
  } catch (error) {
    console.error('[acceptance] ESM sqlite hook registration failed:', error);
    process.exit(1);
  }
}
Module._load = function(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  // 命中两种形态：CJS 裸名 require('better-sqlite3')；原生 ESM import 走 CJS 转换时的
  // 绝对路径加载（实测 ESM-after-CJS 顺序会以绝对路径再次进 Module._load）。
  const isBare = request === 'better-sqlite3';
  const isResolved = typeof request === 'string'
    && request.replaceAll(String.fromCharCode(92), '/').endsWith('/better-sqlite3/lib/index.js');
  if ((!isBare && !isResolved) || process.versions.modules !== ${JSON.stringify(abi)}) return loaded;
  function IsolatedDatabase(filename, options) {
    return new loaded(filename, { ...options, nativeBinding: ${JSON.stringify(binding)} });
  }
  Object.setPrototypeOf(IsolatedDatabase, loaded);
  IsolatedDatabase.prototype = loaded.prototype;
  try {
    const resolved = isBare ? Module._resolveFilename(request, parent) : request;
    const cached = Module._cache[resolved];
    if (cached && cached.exports === loaded) cached.exports = IsolatedDatabase;
  } catch {}
  return IsolatedDatabase;
};
`)
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require "${hook.replaceAll('\\', '/')}"`.trim() }
  // hooks 显式给出三个生成物的绝对路径，调用方不必从 binding 推断目录深度
  // （binding 在 <root>/build/Release/ 下，是预构建包解压布局）。
  return {
    env,
    binding,
    root,
    hooks: { cjs: hook, esm: esmHook, shim },
    archive,
    archiveSha256: digest,
    abi,
    version,
  }
}
