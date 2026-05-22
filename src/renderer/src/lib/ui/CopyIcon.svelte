<script lang="ts">
  export let copied = false
  export let size = 'h-3.5 w-3.5'
</script>

<span class="copy-icon-wrapper inline-flex items-center justify-center {size}" aria-hidden="true">
  {#if copied}
    <span class="copy-icon-check i-lucide-check {size}"></span>
  {:else}
    <span class="copy-icon-idle i-lucide-copy {size}"></span>
  {/if}
</span>

<style>
  .copy-icon-wrapper {
    position: relative;
  }

  .copy-icon-check {
    animation: copy-morph-in 0.28s cubic-bezier(0.33, 1, 0.68, 1) both;
    color: var(--success, #10b981);
  }

  .copy-icon-idle {
    animation: copy-morph-idle 0.2s cubic-bezier(0.33, 1, 0.68, 1) both;
  }

  @keyframes copy-morph-in {
    from {
      transform: scale(0.5);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  @keyframes copy-morph-idle {
    from {
      transform: scale(0.85);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .copy-icon-check,
    .copy-icon-idle {
      animation: none;
    }
  }
</style>
