<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  import { cascadeIn, reveal } from './gsap-motion'

  export let ariaLabel = ''
  export let ariaLabelledby = ''
  export let title = ''
  export let description = ''
  export let closeLabel = 'Close'
  export let showClose = false
  export let maxWidthClass = 'max-w-xl'
  export let maxHeightClass = 'max-h-[calc(100vh-3rem)]'
  export let backdropClass = ''
  export let panelClass = ''
  export let contentClass = ''
  export let bodyClass = ''
  export let footerClass = ''
  export let zIndexClass = 'z-[70]'
  export let motionSelector = '[data-dialog-motion]'
  export let closeOnBackdrop = true
  export let closeOnEscape = true
  export let closeDisabled = false
  export let scrollable = false
  export let onclose: (() => void) | undefined = undefined

  const dispatch = createEventDispatcher<{ close: void }>()
  const generatedTitleId = `app-dialog-title-${Math.random().toString(36).slice(2)}`

  function emitClose(): void {
    dispatch('close')
    onclose?.()
  }

  type ModalMotionState = 'closed' | 'open' | 'closing'

  let modalMotionState: ModalMotionState = 'closed'
  let closeTimer: number | null = null
  let openFrame: number | null = null
  let backdropPointerStarted = false

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
    if (closeDisabled || modalMotionState === 'closing') {
      return
    }

    clearMotionTimers()
    modalMotionState = 'closing'
    closeTimer = window.setTimeout(() => {
      closeTimer = null
      emitClose()
    }, modalCloseDurationMs())
  }

  function handleBackdropPointerDown(event: PointerEvent): void {
    backdropPointerStarted = event.target === event.currentTarget
  }

  function clearBackdropPointerIntentSoon(): void {
    window.setTimeout(() => {
      backdropPointerStarted = false
    }, 0)
  }

  function handleBackdropClick(event: MouseEvent): void {
    const shouldClose =
      !closeDisabled &&
      closeOnBackdrop &&
      event.target === event.currentTarget &&
      backdropPointerStarted

    backdropPointerStarted = false

    if (shouldClose) {
      requestClose()
    }
  }

  onMount(() => {
    openFrame = window.requestAnimationFrame(() => {
      openFrame = null
      modalMotionState = 'open'
    })
  })

  onDestroy(clearMotionTimers)

  $: resolvedAriaLabelledby = ariaLabel
    ? undefined
    : ariaLabelledby || (title ? generatedTitleId : undefined)
  $: resolvedContentClass =
    contentClass || (scrollable ? 'min-h-0 overflow-y-auto pr-1' : 'min-h-0')
</script>

<div
  class={`theme-dialog-backdrop fixed inset-0 ${zIndexClass} flex items-center justify-center bg-[var(--backdrop)] px-4 py-6 ${backdropClass}`}
  role="presentation"
  tabindex="-1"
  use:reveal={{ y: 0, scale: 1, blur: 0, duration: 0.18 }}
  onpointerdown={handleBackdropPointerDown}
  onpointerup={clearBackdropPointerIntentSoon}
  onpointercancel={() => {
    backdropPointerStarted = false
  }}
  onclick={handleBackdropClick}
  onkeydown={(event) => {
    if (!closeDisabled && closeOnEscape && event.key === 'Escape') {
      requestClose()
    }
  }}
>
  <div
    class={`theme-surface theme-dialog-surface theme-dialog-size-transition t-modal ${modalMotionClass} flex w-full ${maxWidthClass} ${maxHeightClass} flex-col rounded-[0.75rem] border border-[var(--dialog-border)] bg-[var(--panel-strong)] p-5 shadow-[0_28px_84px_-40px_rgba(0,0,0,0.48)] sm:p-6 ${panelClass}`}
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel || undefined}
    aria-labelledby={resolvedAriaLabelledby}
    tabindex="-1"
    use:cascadeIn={{ selector: motionSelector }}
  >
    {#if title || description || showClose || $$slots.header}
      <header class="mb-4 flex flex-none items-start justify-between gap-4" data-dialog-motion>
        <div class="min-w-0">
          <slot name="header">
            {#if title}
              <h2 id={generatedTitleId} class="text-[1.05rem] font-semibold text-carbon">
                {title}
              </h2>
            {/if}
            {#if description}
              <p class="mt-1 text-sm leading-6 text-muted-strong">{description}</p>
            {/if}
          </slot>
        </div>
        {#if showClose}
          <button
            type="button"
            class="theme-dialog-close-button inline-flex h-8 w-8 flex-none items-center justify-center rounded-[0.45rem] border border-[var(--card-border)] text-muted-strong transition-colors duration-140 hover:text-carbon focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carbon disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={closeLabel}
            title={closeLabel}
            disabled={closeDisabled}
            onclick={requestClose}
          >
            <span class="i-lucide-x h-4 w-4" aria-hidden="true"></span>
          </button>
        {/if}
      </header>
    {/if}

    <div class={`${resolvedContentClass} ${bodyClass}`}>
      <slot />
    </div>

    {#if $$slots.footer}
      <footer class={`mt-5 flex flex-none justify-end gap-2 ${footerClass}`} data-dialog-motion>
        <slot name="footer" />
      </footer>
    {/if}
  </div>
</div>

<style>
  .theme-dialog-surface {
    position: relative;
    overflow: hidden;
    border-color: var(--dialog-border) !important;
    box-shadow: var(--dialog-shadow) !important;
  }

  .theme-dialog-size-transition {
    transition:
      max-width var(--resize-dur) var(--resize-ease),
      transform var(--modal-open-dur) var(--modal-ease),
      opacity var(--modal-open-dur) var(--modal-ease);
    will-change: max-width, transform, opacity;
  }

  .theme-dialog-size-transition.is-closing {
    transition:
      max-width var(--resize-dur) var(--resize-ease),
      transform var(--modal-close-dur) var(--modal-ease),
      opacity var(--modal-close-dur) var(--modal-ease);
  }

  .theme-dialog-surface::before {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
    pointer-events: none;
    content: '';
    box-shadow: var(--dialog-inset-glow);
  }

  .theme-dialog-surface > :global(*) {
    position: relative;
    z-index: 2;
  }

  .theme-dialog-close-button {
    min-width: 2rem;
    min-height: 2rem;
    padding: 0;
    border: 1px solid var(--card-border);
    border-radius: 0.45rem;
    background: var(--dialog-close-bg);
    color: var(--ink-soft-strong);
    font-weight: var(--font-weight-medium);
    line-height: 1;
    box-shadow: none;
  }

  .theme-dialog-close-button:hover,
  .theme-dialog-close-button:focus-visible {
    border-color: var(--line-strong);
    background: var(--dialog-close-hover-bg);
    color: var(--color-carbon);
  }

  .theme-dialog-close-button:disabled {
    box-shadow: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .theme-dialog-size-transition {
      transition: none !important;
    }
  }
</style>
