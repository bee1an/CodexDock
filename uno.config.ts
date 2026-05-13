import extractorSvelte from '@unocss/extractor-svelte'
import { defineConfig, presetIcons, presetWind3 } from 'unocss'

export default defineConfig({
  extractors: [extractorSvelte()],
  safelist: [
    'theme-plan-neutral',
    'bg-black/[0.05]',
    'text-black/55',
    'theme-plan-plus',
    'bg-emerald-500/12',
    'text-emerald-700',
    'theme-plan-pro',
    'bg-sky-500/12',
    'text-sky-700',
    'theme-plan-team',
    'bg-amber-500/14',
    'text-amber-700',
    'theme-plan-business',
    'bg-violet-500/14',
    'text-violet-700',
    'theme-plan-enterprise',
    'bg-rose-500/14',
    'text-rose-700',
    'text-success',
    'text-danger',
    'text-ink',
    'theme-account-card',
    'theme-account-card-active',
    'border-black/14',
    'bg-black/[0.02]',
    'border-black/8',
    'bg-white',
    'i-lucide-moon-star',
    'i-lucide-monitor',
    'i-lucide-sun-medium',
    'i-lucide-user-round',
    'i-lucide-bot',
    'i-lucide-settings-2',
    'i-lucide-code-2',
    'i-lucide-wrench',
    'i-lucide-message-circle',
    'bg-emerald-500/80',
    'bg-sky-500/80',
    'i-lucide-timer',
    'i-lucide-calendar-range',
    'text-emerald-600',
    'text-sky-600'
  ],
  presets: [
    presetWind3(),
    presetIcons({
      extraProperties: {
        display: 'inline-block',
        'vertical-align': 'middle'
      }
    })
  ],
  theme: {
    colors: {
      carbon: 'var(--color-carbon)',
      snow: 'var(--color-snow)',
      fog: 'var(--color-fog)',
      pewter: 'var(--color-pewter)',
      stone: 'var(--color-stone)',
      arcticMist: 'var(--color-arctic-mist)',
      linkBlue: 'var(--color-link-blue)',
      midnightCanvas: 'var(--color-midnight-canvas)',
      frostWhite: 'var(--color-frost-white)',
      deepShadow: 'var(--color-deep-shadow)',
      whisperGray: 'var(--color-whisper-gray)',
      mistyGray: 'var(--color-misty-gray)',
      deepOceanGradient: 'var(--color-deep-ocean-gradient)',
      success: 'var(--success)',
      warn: 'var(--warn)',
      danger: 'var(--danger)',
      ink: 'var(--color-carbon)',
      paper: 'var(--color-snow)',
      panel: 'var(--color-fog)',
      line: 'var(--color-arctic-mist)',
      'surface-soft': 'var(--surface-soft)',
      'surface-hover': 'var(--surface-hover)',
      'surface-selected': 'var(--surface-selected)',
      'panel-strong': 'var(--panel-strong)',
      'line-strong': 'var(--line-strong)',
      'ink-soft': 'var(--ink-soft)',
      'ink-faint': 'var(--ink-faint)',
      'dropdown-panel': 'var(--dropdown-panel-bg)',
      'card-bg': 'var(--card-bg)',
      'pill-bg': 'var(--pill-bg)',
      'selector-bg': 'var(--selector-bg)',
      'empty-bg': 'var(--empty-bg)',
      'sider-rail': 'var(--sider-rail-bg)'
    },
    fontFamily: {
      ui: 'var(--font-ui-sans-serif)',
      openai: 'var(--font-openai-sans)',
      roobert: 'var(--font-roobert)',
      raleway: 'var(--font-raleway)',
      mono: '"SF Mono","Fira Code",ui-monospace,monospace'
    }
  }
})
