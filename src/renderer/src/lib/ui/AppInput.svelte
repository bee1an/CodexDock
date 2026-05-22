<script lang="ts">
  type InputVariant = 'default' | 'search' | 'code'
  type InputSize = 'xs' | 'sm' | 'md' | 'lg'
  type InputType = 'text' | 'password' | 'search' | 'url' | 'email' | 'number'

  let className = ''
  let inputClassName = ''
  let inputElement: HTMLInputElement | HTMLTextAreaElement | null = null

  export let value = ''
  export let variant: InputVariant = 'default'
  export let size: InputSize = 'sm'
  export let type: InputType = 'text'
  export let id: string | undefined = undefined
  export let name: string | undefined = undefined
  export let placeholder = ''
  export let disabled = false
  export let readonly = false
  export let multiline = false
  export let rows: number | undefined = undefined
  export let icon = ''
  export let ariaLabel = ''
  export let title: string | undefined = undefined
  export let autocomplete: string | undefined = undefined
  export let spellcheck: boolean | undefined = undefined
  export let oninput: ((event: Event) => void) | undefined = undefined
  export let onkeydown: ((event: KeyboardEvent) => void) | undefined = undefined
  export let onblur: ((event: FocusEvent) => void) | undefined = undefined
  export { className as class }
  export { inputClassName as inputClass }
  export { inputElement as element }
</script>

<div
  class={`app-input app-input-${variant} app-input-${size} ${disabled ? 'is-disabled' : ''} ${multiline ? 'is-multiline' : ''} ${className}`}
>
  {#if icon}
    <span class={`${icon} app-input-icon`} aria-hidden="true"></span>
  {/if}

  {#if multiline}
    <textarea
      bind:this={inputElement}
      bind:value
      {id}
      {name}
      {placeholder}
      {disabled}
      {readonly}
      {rows}
      {title}
      aria-label={ariaLabel || undefined}
      {spellcheck}
      class={`app-input-control ${inputClassName}`}
      oninput={(event) => oninput?.(event)}
      onkeydown={(event) => onkeydown?.(event)}
      onblur={(event) => onblur?.(event)}
    ></textarea>
  {:else}
    <input
      bind:this={inputElement}
      bind:value
      {id}
      {name}
      {type}
      {placeholder}
      {disabled}
      {readonly}
      {title}
      {autocomplete}
      aria-label={ariaLabel || undefined}
      {spellcheck}
      class={`app-input-control ${inputClassName}`}
      oninput={(event) => oninput?.(event)}
      onkeydown={(event) => onkeydown?.(event)}
      onblur={(event) => onblur?.(event)}
    />
  {/if}
</div>

<style>
  .app-input {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.42rem;
    background: color-mix(in srgb, var(--panel-strong) 88%, var(--surface-soft));
    color: var(--color-carbon);
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease,
      opacity 140ms ease;
  }

  .app-input:hover:not(.is-disabled) {
    border-color: color-mix(in srgb, var(--line-strong) 72%, transparent);
    background: color-mix(in srgb, var(--surface-hover) 72%, var(--panel-strong));
  }

  .app-input:focus-within {
    border-color: color-mix(in srgb, var(--color-carbon) 34%, var(--line-strong));
    background: color-mix(in srgb, var(--panel-strong) 94%, var(--surface-soft));
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 58%, transparent);
  }

  .app-input.is-disabled {
    opacity: 0.52;
  }

  .app-input-xs {
    min-height: 1.75rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .app-input-sm {
    min-height: 2rem;
    padding: 0.38rem 0.65rem;
    font-size: 0.8125rem;
  }

  .app-input-md {
    min-height: 2.35rem;
    padding: 0.52rem 0.78rem;
    font-size: 0.875rem;
  }

  .app-input-lg {
    min-height: 2.75rem;
    padding: 0.68rem 0.9rem;
    font-size: 0.95rem;
  }

  .app-input-search {
    background: transparent;
  }

  .app-input-code {
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
  }

  .app-input.is-multiline {
    align-items: stretch;
  }

  .app-input-icon {
    flex: none;
    width: 1em;
    height: 1em;
    color: var(--ink-faint);
    font-size: 1.1em;
  }

  .app-input-control {
    min-width: 0;
    width: 100%;
    flex: 1 1 auto;
    border: 0;
    background: transparent;
    color: var(--color-carbon);
    font: inherit;
    line-height: 1.35;
    outline: none;
    padding: 0;
  }

  textarea.app-input-control {
    min-height: inherit;
    resize: vertical;
  }

  .app-input-control::placeholder {
    color: var(--ink-faint);
  }

  @media (prefers-reduced-motion: reduce) {
    .app-input {
      transition: none;
    }
  }
</style>
