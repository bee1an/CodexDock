<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  import { cascadeIn, reveal } from './gsap-motion'

  export let ariaLabel = ''
  export let ariaLabelledby = ''
  export let maxWidthClass = 'max-w-xl'
  export let panelClass = ''
  export let closeOnBackdrop = true
  export let closeOnEscape = true

  const dispatch = createEventDispatcher<{ close: void }>()

  type ModalMotionState = 'closed' | 'open' | 'closing'

  let modalMotionState: ModalMotionState = 'closed'
  let closeTimer: number | null = null
  let openFrame: number | null = null

  $: modalMotionClass =
    modalMotionState === 'open' ? 'is-open' : modalMotionState === 'closing' ? 'is-closing' : ''

  const modalCloseDurationMs = (): number => {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return 0
    }

    return (
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150
    )
  }

  const clearMotionTimers = (): void => {
    if (closeTimer != null) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    if (openFrame != null) {
      window.cancelAnimationFrame(openFrame)
      openFrame = null
    }
  }

  function requestClose(): void {
    if (modalMotionState === 'closing') {
      return
    }

    clearMotionTimers()
    modalMotionState = 'closing'
    closeTimer = window.setTimeout(() => {
      closeTimer = null
      dispatch('close')
    }, modalCloseDurationMs())
  }

  onMount(() => {
    openFrame = window.requestAnimationFrame(() => {
      openFrame = null
      modalMotionState = 'open'
    })
  })

  onDestroy(clearMotionTimers)
</script>

<div
  class="theme-dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/38 px-4 py-6"
  role="presentation"
  tabindex="-1"
  use:reveal={{ y: 0, scale: 1, blur: 0, duration: 0.18 }}
  on:click={(event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      requestClose()
    }
  }}
  on:keydown={(event) => {
    if (closeOnEscape && event.key === 'Escape') {
      requestClose()
    }
  }}
>
  <div
    class={`theme-surface theme-dialog-surface t-modal ${modalMotionClass} w-full ${maxWidthClass} rounded-[0.75rem] border border-black/8 bg-white p-5 shadow-[0_24px_70px_-42px_var(--paper-shadow)] sm:p-6 ${panelClass}`}
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel || undefined}
    aria-labelledby={ariaLabel ? undefined : ariaLabelledby || undefined}
    tabindex="-1"
    use:cascadeIn={{ selector: '[data-dialog-motion]' }}
  >
    <slot />
  </div>
</div>

<style>
  .theme-dialog-surface {
    position: relative;
    overflow: hidden;
  }

  .theme-dialog-surface::before {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    content: '';
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 72%, transparent),
      inset 0 0 0 1px color-mix(in srgb, var(--line-strong) 48%, transparent);
  }

  :global(html[data-theme='dark']) .theme-dialog-backdrop {
    background: color-mix(in srgb, black 70%, transparent) !important;
    backdrop-filter: blur(6px) saturate(0.82);
  }

  :global(html[data-theme='dark']) .theme-surface.theme-dialog-surface[role='dialog'] {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 66%, white 34%) !important;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--panel-strong) 82%, var(--surface-soft)),
      color-mix(in srgb, var(--panel-strong) 74%, var(--color-fog))
    ) !important;
    box-shadow:
      0 34px 120px rgba(0, 0, 0, 0.92),
      0 18px 54px rgba(0, 0, 0, 0.68),
      0 0 0 1px color-mix(in srgb, var(--color-arctic-mist) 72%, transparent),
      0 0 0 8px rgba(255, 255, 255, 0.035),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 0 0 1px rgba(255, 255, 255, 0.055) !important;
  }

  :global(html[data-theme='dark']) .theme-dialog-surface::before {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 0 0 1px color-mix(in srgb, var(--color-arctic-mist) 46%, transparent);
  }
</style>
