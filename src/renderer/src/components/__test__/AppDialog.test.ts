// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppDialogHarness from './AppDialogHarness.svelte'

describe('AppDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not close from a backdrop click when the pointer drag started inside the dialog', async () => {
    const handleClose = vi.fn()
    const { container } = render(AppDialogHarness, {
      props: {
        onClose: handleClose
      }
    })

    const backdrop = container.querySelector<HTMLElement>('.theme-dialog-backdrop')
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')

    expect(backdrop).toBeTruthy()
    expect(panel).toBeTruthy()

    await fireEvent.pointerDown(panel!, { pointerId: 1 })
    await fireEvent.pointerUp(backdrop!, { pointerId: 1 })
    await fireEvent.click(backdrop!)
    vi.advanceTimersByTime(200)

    expect(handleClose).not.toHaveBeenCalled()
  })

  it('still closes when the pointer starts and clicks on the backdrop', async () => {
    const handleClose = vi.fn()
    const { container } = render(AppDialogHarness, {
      props: {
        onClose: handleClose
      }
    })

    const backdrop = container.querySelector<HTMLElement>('.theme-dialog-backdrop')

    expect(backdrop).toBeTruthy()

    await fireEvent.pointerDown(backdrop!, { pointerId: 1 })
    await fireEvent.pointerUp(backdrop!, { pointerId: 1 })
    await fireEvent.click(backdrop!)
    vi.advanceTimersByTime(200)

    expect(handleClose).toHaveBeenCalledOnce()
  })

  it('renders title/footer and blocks close while disabled', async () => {
    const handleClose = vi.fn()
    const { container } = render(AppDialogHarness, {
      props: {
        onClose: handleClose,
        title: 'Dialog title',
        closeDisabled: true
      }
    })

    expect(screen.getByRole('heading', { name: 'Dialog title' })).toBeTruthy()
    expect(screen.getByText('Footer action')).toBeTruthy()

    const backdrop = container.querySelector<HTMLElement>('.theme-dialog-backdrop')
    await fireEvent.pointerDown(backdrop!, { pointerId: 1 })
    await fireEvent.pointerUp(backdrop!, { pointerId: 1 })
    await fireEvent.click(backdrop!)
    await fireEvent.keyDown(backdrop!, { key: 'Escape' })
    vi.advanceTimersByTime(200)

    expect(handleClose).not.toHaveBeenCalled()
  })
})
