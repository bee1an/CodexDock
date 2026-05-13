<script lang="ts">
  type ButtonGroupRole = 'group' | 'radiogroup' | 'toolbar' | 'tablist'
  type ButtonGroupOrientation = 'horizontal' | 'vertical'

  let className = ''
  let groupElement: HTMLDivElement | null = null

  export let role: ButtonGroupRole = 'group'
  export let orientation: ButtonGroupOrientation = 'horizontal'
  export let ariaLabel = ''
  export let ariaLabelledby = ''
  export let keyboardNavigation = true
  export { className as class }

  const focusableButtons = (): HTMLButtonElement[] => {
    if (!groupElement) return []
    return Array.from(
      groupElement.querySelectorAll<HTMLButtonElement>('.app-button:not(:disabled)')
    )
  }

  const focusButtonAt = (index: number): void => {
    const buttons = focusableButtons()
    if (!buttons.length) return

    const normalizedIndex = ((index % buttons.length) + buttons.length) % buttons.length
    buttons[normalizedIndex]?.focus()
  }

  const handleKeydown = (event: KeyboardEvent): void => {
    if (!keyboardNavigation) return

    const buttons = focusableButtons()
    if (!buttons.length) return

    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (currentIndex < 0) return

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        focusButtonAt(currentIndex - 1)
        break
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        focusButtonAt(currentIndex + 1)
        break
      case 'Home':
        event.preventDefault()
        focusButtonAt(0)
        break
      case 'End':
        event.preventDefault()
        focusButtonAt(buttons.length - 1)
        break
      default:
        break
    }
  }
</script>

<div
  bind:this={groupElement}
  class={`app-button-group ${className}`}
  data-orientation={orientation}
  {role}
  aria-label={ariaLabel || undefined}
  aria-labelledby={ariaLabelledby || undefined}
  aria-orientation={role === 'radiogroup' || role === 'tablist' ? orientation : undefined}
  {...$$restProps}
  onkeydown={handleKeydown}
>
  <slot />
</div>

<style>
  .app-button-group {
    --button-group-radius: 0.38rem;

    display: inline-flex;
    align-items: center;
    gap: 0;
  }

  .app-button-group[data-orientation='vertical'] {
    flex-direction: column;
    align-items: stretch;
  }

  .app-button-group :global(.app-button) {
    position: relative;
    border-radius: 0;
  }

  .app-button-group :global(.app-button:not(:first-child)) {
    margin-left: -1px;
  }

  .app-button-group[data-orientation='vertical'] :global(.app-button:not(:first-child)) {
    margin-left: 0;
    margin-top: -1px;
  }

  .app-button-group :global(.app-button:first-child) {
    border-top-left-radius: var(--button-group-radius);
    border-bottom-left-radius: var(--button-group-radius);
  }

  .app-button-group :global(.app-button:last-child) {
    border-top-right-radius: var(--button-group-radius);
    border-bottom-right-radius: var(--button-group-radius);
  }

  .app-button-group[data-orientation='vertical'] :global(.app-button:first-child) {
    border-top-left-radius: var(--button-group-radius);
    border-top-right-radius: var(--button-group-radius);
    border-bottom-left-radius: 0;
  }

  .app-button-group[data-orientation='vertical'] :global(.app-button:last-child) {
    border-top-right-radius: 0;
    border-bottom-right-radius: var(--button-group-radius);
    border-bottom-left-radius: var(--button-group-radius);
  }

  .app-button-group :global(.app-button:only-child) {
    border-radius: var(--button-group-radius);
  }

  .app-button-group :global(.app-button:hover:not(:disabled)) {
    z-index: 1;
  }

  .app-button-group :global(.app-button.is-selected),
  .app-button-group :global(.app-button[aria-pressed='true']) {
    z-index: 2;
  }

  .app-button-group :global(.app-button:focus-visible) {
    z-index: 3;
  }
</style>
