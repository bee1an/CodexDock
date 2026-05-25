<script lang="ts">
  import AppButton from '$lib/ui/AppButton.svelte'
  import { toastReveal } from '$lib/motion/gsap-motion'
  import type { LocalizedCopy } from '$lib/view/app-view'
  import type { PortOccupant } from '../../../shared/codex'

  export let pageError = ''
  export let copy: LocalizedCopy
  export let loginPortOccupant: PortOccupant | null = null
  export let loginPortConflict = false
  export let killingLoginPortOccupant = false
  export let killLoginPortOccupant: () => Promise<void>
  export let setPageError: (message: string) => void
</script>

{#if pageError}
  <section
    use:toastReveal={{ autoDismissMs: 8000 }}
    class="theme-surface theme-error-panel fixed bottom-20 left-1/2 z-[60] w-[min(calc(100vw-2rem),52rem)] -translate-x-1/2 rounded-[1rem] border border-danger/18 bg-[var(--panel-strong)] px-4 py-3.5 text-sm text-danger shadow-[0_20px_60px_-36px_var(--paper-shadow),0_10px_30px_-24px_var(--paper-shadow)]"
    role="alert"
    aria-live="assertive"
  >
    <div class="flex items-start gap-3">
      <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 flex-none" aria-hidden="true"></span>
      <div class="grid min-w-0 flex-1 gap-2">
        <p class="break-words">{pageError}</p>
        {#if loginPortOccupant && loginPortConflict}
          <div class="flex flex-wrap items-center gap-2 text-sm text-danger">
            <span>{copy.portOccupied(loginPortOccupant.command, loginPortOccupant.pid)}</span>
            <AppButton
              variant="secondary"
              size="sm"
              onclick={killLoginPortOccupant}
              disabled={killingLoginPortOccupant}
            >
              {copy.killPortOccupant}
            </AppButton>
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="flex-none rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Close"
        onclick={() => {
          setPageError('')
        }}
      >
        <span class="i-lucide-x h-4 w-4"></span>
      </button>
    </div>
    <span
      data-toast-timer
      class="absolute bottom-0 left-4 right-4 h-px origin-left scale-x-0 rounded-full bg-danger/40"
    ></span>
  </section>
{/if}
