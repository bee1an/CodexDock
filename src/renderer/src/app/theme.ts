import type { AppTheme } from '../../../shared/codex'

export type ThemeTransitionOrigin = {
  x?: number
  y?: number
  target?: HTMLElement | null
}

type DocumentWithViewTransitions = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    ready: Promise<void>
    finished: Promise<void>
    updateCallbackDone: Promise<void>
    skipTransition: () => void
  }
}

const resolvedTheme = (theme: AppTheme, prefersDark: boolean): 'light' | 'dark' =>
  theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const themeTransitionPoint = (origin?: ThemeTransitionOrigin): { x: number; y: number } | null => {
  if (typeof window === 'undefined' || !origin) {
    return null
  }

  if (Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
    return {
      x: Math.max(0, Math.min(window.innerWidth, origin.x ?? 0)),
      y: Math.max(0, Math.min(window.innerHeight, origin.y ?? 0))
    }
  }

  if (origin.target) {
    const rect = origin.target.getBoundingClientRect()

    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
  }

  return null
}

export const applyTheme = (theme: AppTheme, prefersDark: boolean): void => {
  if (typeof document === 'undefined') {
    return
  }

  const nextTheme = resolvedTheme(theme, prefersDark)
  document.documentElement.dataset.theme = nextTheme
  document.documentElement.style.colorScheme = nextTheme
}

export const applyThemeWithRipple = (
  theme: AppTheme,
  prefersDark: boolean,
  origin?: ThemeTransitionOrigin
): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  const transitionDocument = document as DocumentWithViewTransitions
  const point = themeTransitionPoint(origin)

  if (
    !point ||
    prefersReducedMotion() ||
    !transitionDocument.startViewTransition ||
    !document.documentElement.animate
  ) {
    applyTheme(theme, prefersDark)
    return
  }

  const transition = transitionDocument.startViewTransition(() => {
    applyTheme(theme, prefersDark)
  })

  void transition.ready
    .then(() => {
      const endRadius = Math.hypot(
        Math.max(point.x, window.innerWidth - point.x),
        Math.max(point.y, window.innerHeight - point.y)
      )

      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${point.x}px ${point.y}px)`,
            `circle(${endRadius}px at ${point.x}px ${point.y}px)`
          ]
        },
        {
          duration: 520,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      )
    })
    .catch(() => {
      transition.skipTransition()
    })
}
