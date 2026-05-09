<script lang="ts">
  type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'toolbar'
    | 'icon'
    | 'danger'
    | 'filter'
    | 'link'
  type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'
  type ButtonType = 'button' | 'submit' | 'reset'

  let className = ''
  let buttonElement: HTMLButtonElement | null = null

  export let variant: ButtonVariant = 'ghost'
  export let size: ButtonSize = 'sm'
  export let type: ButtonType = 'button'
  export let disabled = false
  export let selected = false
  export let title: string | undefined = undefined
  export let ariaLabel = ''
  export let ariaPressed: boolean | 'true' | 'false' | 'mixed' | undefined = undefined
  export let ariaExpanded: boolean | 'true' | 'false' | undefined = undefined
  export let ariaHaspopup: boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog' | undefined =
    undefined
  export let onclick: ((event: MouseEvent) => void) | undefined = undefined
  export let onpointerdown: ((event: PointerEvent) => void) | undefined = undefined
  export { className as class }
  export { buttonElement as element }
</script>

<button
  bind:this={buttonElement}
  class={`app-button app-button-${variant} app-button-${size} ${selected ? 'is-selected' : ''} ${className}`}
  {type}
  {disabled}
  {title}
  aria-label={ariaLabel || undefined}
  aria-pressed={ariaPressed}
  aria-expanded={ariaExpanded}
  aria-haspopup={ariaHaspopup}
  {onclick}
  {onpointerdown}
>
  <slot />
</button>

<style>
  .app-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border: 1px solid transparent;
    border-radius: 0.38rem;
    background: transparent;
    color: var(--color-carbon);
    cursor: pointer;
    font: inherit;
    font-weight: 650;
    line-height: 1;
    white-space: nowrap;
    box-shadow: none;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      opacity 140ms ease,
      box-shadow 140ms ease;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .app-button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--ring) 78%, var(--color-carbon) 22%);
    outline-offset: 2px;
  }

  .app-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .app-button-xs {
    min-height: 1.55rem;
    padding: 0.28rem 0.45rem;
    font-size: 0.68rem;
  }

  .app-button-sm {
    min-height: 1.9rem;
    padding: 0.42rem 0.65rem;
    font-size: 0.75rem;
  }

  .app-button-md {
    min-height: 2.35rem;
    padding: 0.58rem 0.9rem;
    font-size: 0.875rem;
  }

  .app-button-lg {
    min-height: 2.75rem;
    padding: 0.74rem 1.05rem;
    font-size: 0.925rem;
  }

  .app-button-primary {
    border-color: var(--color-carbon);
    background: var(--color-carbon);
    color: var(--color-snow);
    box-shadow: var(--control-shadow);
  }

  .app-button-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .app-button-secondary,
  .app-button-ghost,
  .app-button-toolbar {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft));
    color: var(--color-carbon);
  }

  .app-button-ghost,
  .app-button-toolbar {
    background: transparent;
    color: var(--ink-faint);
  }

  .app-button-secondary:hover:not(:disabled),
  .app-button-ghost:hover:not(:disabled),
  .app-button-toolbar:hover:not(:disabled) {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  .app-button-toolbar {
    border-color: transparent;
    font-size: 0.75rem;
    padding-inline: 0.45rem;
  }

  .app-button-icon {
    width: 1.75rem;
    min-width: 1.75rem;
    height: 1.75rem;
    min-height: 1.75rem;
    padding: 0;
    border-color: color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    background: transparent;
    color: var(--ink-faint);
  }

  .app-button-icon.app-button-xs {
    width: 1.5rem;
    min-width: 1.5rem;
    height: 1.5rem;
    min-height: 1.5rem;
  }

  .app-button-icon.app-button-md {
    width: 2rem;
    min-width: 2rem;
    height: 2rem;
    min-height: 2rem;
  }

  .app-button-icon:hover:not(:disabled) {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  .app-button-danger {
    border-color: color-mix(in srgb, var(--danger) 18%, var(--color-arctic-mist));
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }

  .app-button-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }

  .app-button-filter {
    min-height: 1.45rem;
    border-color: var(--color-arctic-mist);
    border-radius: 0.32rem;
    background: var(--surface-soft);
    color: var(--ink-soft-strong);
    padding: 0.25rem 0.45rem;
    font-size: 0.625rem;
    font-weight: 650;
  }

  .app-button-filter.app-button-xs {
    min-height: 1.45rem;
    padding: 0.25rem 0.45rem;
    font-size: 0.68rem;
  }

  .app-button-filter.app-button-sm {
    min-height: 1.6rem;
    padding: 0.34rem 0.52rem;
    font-size: 0.72rem;
  }

  .app-button-filter:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  .app-button-filter.is-selected,
  .app-button-filter[aria-pressed='true'] {
    border-color: var(--color-carbon);
    background: var(--color-carbon);
    color: var(--color-snow);
  }

  .app-button-link {
    min-height: 0;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--color-carbon);
    text-align: left;
    white-space: normal;
  }

  .app-button-link:hover:not(:disabled) {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  :global(html[data-theme='dark']) .app-button-secondary,
  :global(html[data-theme='dark']) .app-button-ghost,
  :global(html[data-theme='dark']) .app-button-toolbar,
  :global(html[data-theme='dark']) .app-button-icon {
    border-color: var(--color-arctic-mist);
    color: var(--ink-soft);
  }

  :global(html[data-theme='dark']) .app-button-secondary {
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft));
    color: var(--color-carbon);
  }

  :global(html[data-theme='dark']) .app-button-primary,
  :global(html[data-theme='dark']) .app-button-filter.is-selected,
  :global(html[data-theme='dark']) .app-button-filter[aria-pressed='true'] {
    border-color: var(--color-carbon);
    background: var(--color-carbon);
    color: var(--color-snow);
  }

  :global(html[data-theme='dark']) .app-button-ghost:hover:not(:disabled),
  :global(html[data-theme='dark']) .app-button-toolbar:hover:not(:disabled),
  :global(html[data-theme='dark']) .app-button-icon:hover:not(:disabled),
  :global(html[data-theme='dark']) .app-button-secondary:hover:not(:disabled) {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  @media (prefers-reduced-motion: reduce) {
    .app-button {
      transition: none;
    }
  }
</style>
