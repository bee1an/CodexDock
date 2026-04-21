export const floatingRootAttribute = 'data-floating-root'

export interface FloatingAnchorOptions {
  anchorRect: DOMRect | null
  gap?: number
  minWidth?: number
  matchAnchorWidth?: boolean
  viewportPadding?: number
}

export function portal(node: HTMLElement): { destroy: () => void } {
  document.body.appendChild(node)

  return {
    destroy: () => {
      node.remove()
    }
  }
}

export function stopFloatingPointerPropagation(node: HTMLElement): { destroy: () => void } {
  const handler = (event: Event): void => {
    event.stopPropagation()
  }

  const eventTypes = ['pointerdown', 'mousedown', 'touchstart'] as const
  for (const eventType of eventTypes) {
    node.addEventListener(eventType, handler)
  }

  return {
    destroy: () => {
      for (const eventType of eventTypes) {
        node.removeEventListener(eventType, handler)
      }
    }
  }
}

export function eventTargetsFloatingRoot(event: Event): boolean {
  if (typeof event.composedPath === 'function') {
    return event
      .composedPath()
      .some((target) => target instanceof HTMLElement && target.hasAttribute(floatingRootAttribute))
  }

  return (
    event.target instanceof HTMLElement &&
    event.target.closest(`[${floatingRootAttribute}]`) !== null
  )
}

export function floatingAnchor(
  node: HTMLElement,
  options: FloatingAnchorOptions
): { update: (nextOptions: FloatingAnchorOptions) => void; destroy: () => void } {
  let currentOptions = options
  let rafId = 0

  const applyPosition = (): void => {
    const anchorRect = currentOptions.anchorRect
    if (!anchorRect) {
      return
    }

    const viewportPadding = currentOptions.viewportPadding ?? 12
    const gap = currentOptions.gap ?? 6
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const minWidth = currentOptions.matchAnchorWidth
      ? Math.max(currentOptions.minWidth ?? 0, Math.round(anchorRect.width))
      : (currentOptions.minWidth ?? 0)

    node.style.position = 'fixed'

    if (minWidth > 0) {
      node.style.minWidth = `${minWidth}px`
    } else {
      node.style.removeProperty('min-width')
    }

    const measuredWidth = Math.max(node.offsetWidth, minWidth)
    const measuredHeight = node.offsetHeight
    const maxLeft = Math.max(viewportPadding, viewportWidth - measuredWidth - viewportPadding)
    const left = Math.min(Math.max(anchorRect.left, viewportPadding), maxLeft)

    const belowTop = anchorRect.bottom + gap
    const aboveTop = anchorRect.top - measuredHeight - gap
    const fitsBelow = belowTop + measuredHeight <= viewportHeight - viewportPadding
    const fitsAbove = aboveTop >= viewportPadding
    const top = fitsBelow
      ? belowTop
      : fitsAbove
        ? aboveTop
        : Math.min(
            Math.max(viewportPadding, belowTop),
            Math.max(viewportPadding, viewportHeight - measuredHeight - viewportPadding)
          )

    node.style.left = `${Math.round(left)}px`
    node.style.top = `${Math.round(top)}px`
  }

  const requestApplyPosition = (): void => {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(applyPosition)
  }

  requestApplyPosition()

  return {
    update: (nextOptions) => {
      currentOptions = nextOptions
      requestApplyPosition()
    },
    destroy: () => {
      cancelAnimationFrame(rafId)
    }
  }
}
