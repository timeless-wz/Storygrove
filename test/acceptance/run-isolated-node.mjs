#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { prepareIsolatedNodeRuntime } from './lib/isolated-node-runtime.mjs'

const runtime = prepareIsolatedNodeRuntime()
console.log(`Isolated SQLite ${runtime.version}, Node ABI ${runtime.abi}: ${runtime.binding}`)
const args = process.argv.slice(2)
if (!args.length) throw new Error('Provide a Node script and its arguments')
const child = spawn(process.execPath, args, { env: runtime.env, stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1) })
