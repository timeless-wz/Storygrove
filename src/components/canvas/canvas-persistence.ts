import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { useProjectStore } from '../../stores/project-store'

/**
 * 画布持久化队列。
 *
 * 设计原则：本地状态是渲染层的工作副本，每个真实改动都会排队一条幂等 IPC
 * 操作并按序冲刷。失败时操作保留在队列里并暴露“未保存数 + 重试”，绝不
 * 丢弃作者的编辑，也**绝不自动无限重试**；项目切换时队列整体作废（旧项目
 * 的余留操作不允许写入新项目）。
 *
 * 幂等依据：upsert 全行写入（行不存在时插入）、delete 按 id 删除、
 * reposition 全量坐标；因此同一 key 的排队操作可被后续操作覆盖
 * （后写胜出），重试也安全。
 */
export interface QueuedCanvasOp {
  /** 同 key 的排队操作会被新操作覆盖。 */
  key: string
  /** 返回 true 表示写入成功；抛错或 false 都视为失败并保留操作。 */
  run: () => Promise<boolean>
}

export interface CanvasPersistenceState {
  /** 排队中的操作数（含上次失败的）。 */
  pendingCount: number
  /** 最近一次冲刷失败的错误消息；空串表示没有失败。 */
  lastError: string
  /** 手动重试；通常由“重试”按钮触发。 */
  retry: () => void
}

export function useCanvasPersistence(): CanvasPersistenceState & {
  /** 入队一条操作并尝试冲刷。 */
  schedule: (op: QueuedCanvasOp) => void
} {
  const queueRef = useRef<QueuedCanvasOp[]>([])
  const flushingRef = useRef(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastError, setLastError] = useState('')

  const syncPending = useCallback(() => {
    setPendingCount(queueRef.current.length)
  }, [])

  const flush = useCallback(() => {
    if (flushingRef.current) return
    flushingRef.current = true
    void (async () => {
      // stopped=true 表示因失败或项目切换而停住：队列保留，等待手动重试。
      let stopped = false
      try {
        while (queueRef.current.length > 0) {
          const op = queueRef.current[0]
          try {
            const ok = await op.run()
            if (!ok) throw new Error('persist op rejected')
            if (queueRef.current[0] === op) {
              queueRef.current.shift()
              syncPending()
            }
          } catch (error) {
            stopped = true
            // 项目已切换：队列将在组件卸载时作废，不再向新项目写入。
            const session = captureProjectSession(useProjectStore.getState().currentProject)
            if (!isProjectSessionCurrent(session)) return
            setLastError(error instanceof Error ? error.message : String(error))
            return
          }
        }
        if (!stopped) setLastError('')
      } finally {
        flushingRef.current = false
        // 只有正常清空队列后才继续处理冲刷期间新入队的操作；
        // 失败停住时必须等手动 retry，否则会变成无限自动重试。
        if (!stopped && queueRef.current.length > 0) flush()
      }
    })()
  }, [syncPending])

  const schedule = useCallback((op: QueuedCanvasOp) => {
    const existingIndex = queueRef.current.findIndex(queued => queued.key === op.key)
    if (existingIndex >= 0) queueRef.current[existingIndex] = op
    else queueRef.current.push(op)
    syncPending()
    flush()
  }, [flush, syncPending])

  const retry = useCallback(() => {
    setLastError('')
    flush()
  }, [flush])

  useEffect(() => () => {
    queueRef.current = []
  }, [])

  // 返回值必须引用稳定，调用方才能安全地把它放进 useCallback 依赖。
  return useMemo(() => ({ schedule, pendingCount, lastError, retry }),
    [schedule, pendingCount, lastError, retry])
}
