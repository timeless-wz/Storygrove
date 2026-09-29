import { describe, expect, it, vi } from 'vitest'

import { actionToast } from '../ActionToast'
import { toast } from '../Toast'

describe('shared feedback actions', () => {
  it('keeps action notifications clickable and dismissible', async () => {
    const onClick = vi.fn()
    const dismiss = actionToast.show({
      message: '草稿已生成',
      actions: [{ label: '打开查看', onClick }],
      duration: 0,
    })

    const action = await vi.waitFor(() => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('#vela-action-toast-root button'))
        .find(item => item.textContent === '打开查看')
      expect(button).toBeDefined()
      return button!
    })
    expect(getComputedStyle(action.closest('.vela-toast-card')!).pointerEvents).toBe('auto')
    action.click()
    await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1))
    dismiss()
  })

  it('shows and closes a regular status notification', async () => {
    toast.success('已保存', 4000)
    const card = await vi.waitFor(() => {
      const item = Array.from(document.querySelectorAll<HTMLElement>('#vela-toast-root [role="status"]'))
        .find(node => node.textContent?.includes('已保存'))
      expect(item).toBeDefined()
      return item!
    })
    expect(card.querySelector('button[aria-label]')).not.toBeNull()
    card.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await vi.waitFor(() => expect(card.isConnected).toBe(false))
  })
})
