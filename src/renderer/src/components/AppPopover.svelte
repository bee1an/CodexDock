<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    eventTargetsFloatingRoot,
    floatingAnchor,
    portal,
    stopFloatingPointerPropagation
  } from './floating'

  let className = ''

  export let open = false
  export let anchorRect: DOMRect | null = null
  export let matchAnchorWidth = false
  export let align: 'start' | 'end' = 'start'
  export let placement: 'bottom' | 'right' = 'bottom'
  export let origin = 'top-left'
  export let closeOnOutside = true
  export let closeOnScroll = true
  export let closeOnResize = true
  export let ignoreNode: HTMLElement | null = null
  export let onclose: (() => void) | undefined = undefined
  export { className as class }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const path = event.composedPath()
      if (ignoreNode && path.includes(ignoreNode)) {
        return
      }
      if (open && closeOnOutside && !eventTargetsFloatingRoot(event)) {
        onclose?.()
      }
    }

    const handleScroll = (): void => {
      if (open && closeOnScroll) onclose?.()
    }

    const handleResize = (): void => {
      if (open && closeOnResize) onclose?.()
    }

    const handleKeydown = (event: KeyboardEvent): void => {
      if (open && event.key === 'Escape') onclose?.()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeydown)
    }
  })

  onDestroy(() => {
    onclose = undefined
  })
</script>

{#if open}
  <div
    use:portal
    use:floatingAnchor={{ anchorRect, matchAnchorWidth, align, placement }}
    use:stopFloatingPointerPropagation
    data-floating-root=""
    data-origin={origin}
    class={`app-popover ${className}`}
  >
    <slot />
  </div>
{/if}

<style>
  .app-popover {
    z-index: 999;
    border: 1px solid var(--line-strong);
    border-radius: 0.75rem;
    background: var(--panel-strong);
    box-shadow:
      var(--elevation-2),
      0 0 0 1px var(--line-strong);
  }

  :global(html[data-theme='dark']) .app-popover {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 86%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 88%, var(--color-fog) 12%);
    box-shadow:
      0 18px 50px rgba(0, 0, 0, 0.72),
      0 0 0 1px color-mix(in srgb, var(--color-arctic-mist) 52%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
</style>
