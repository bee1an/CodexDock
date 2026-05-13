<script lang="ts">
  export let value: number | string
  export let label = ''
  export let className = ''

  let prevText = ''
  let currentText = String(value)

  $: valueText = String(value)
  $: if (valueText !== currentText) {
    prevText = currentText
    currentText = valueText
  }
  $: sourceLabel = label || valueText
  $: valueIndex = sourceLabel.indexOf(valueText)
  $: prefix = valueIndex >= 0 ? sourceLabel.slice(0, valueIndex) : ''
  $: suffix = valueIndex >= 0 ? sourceLabel.slice(valueIndex + valueText.length) : ''
  $: digits = valueText.split('')
  $: prevDigits = prevText.split('')
</script>

<span class={`motion-number inline-flex items-baseline ${className}`} aria-hidden="true">
  {prefix}
  {#key valueText}
    <span class="t-digit-group is-animating">
      {#each digits as digit, digitIndex (`${valueText}:${digitIndex}`)}
        {@const changed = prevDigits[digitIndex] !== digit}
        <span
          class="t-digit"
          class:t-digit-flip={changed}
          style:--stagger="{digitIndex * 30}ms"
          data-stagger={digitIndex === digits.length - 2
            ? '1'
            : digitIndex === digits.length - 1
              ? '2'
              : undefined}>{digit}</span>
      {/each}
    </span>
  {/key}
  {suffix}
</span>

<style>
  .t-digit {
    display: inline-block;
    position: relative;
    overflow: hidden;
  }

  .t-digit-flip {
    animation: digit-flip-in 0.32s cubic-bezier(0.33, 1, 0.68, 1) var(--stagger, 0ms) both;
  }

  @keyframes digit-flip-in {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .t-digit-flip {
      animation: none;
    }
  }
</style>
