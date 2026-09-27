/**
 * 画布实体 ID 的公共工具。
 *
 * 画布 / 节点 / 连线都使用 TEXT 主键，形如 `<prefix>-<uuid-v4>`；前缀让人工
 * 排查数据库时一眼可辨实体类型。Chromium 在 file:// 下可能缺少
 * crypto.randomUUID，这里与 world-map 一样保证任何环境都产出合规 v4 值。
 */

export function randomCanvasUuid(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function isCanvasIdWithPrefix(prefix: string, value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!value.startsWith(`${prefix}-`)) return false
  return UUID_V4.test(value.slice(prefix.length + 1))
}
