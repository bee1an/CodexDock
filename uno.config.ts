import extractorSvelte from '@unocss/extractor-svelte'
import { defineConfig, presetIcons, presetWind3 } from 'unocss'

export default defineConfig({
  extractors: [extractorSvelte()],
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
      paper: 'var(--paper)',
      ink: 'var(--ink)',
      success: 'var(--success)',
      warn: 'var(--warn)',
      danger: 'var(--danger)'
    },
    fontFamily: {
      ui: '"SF Pro Display","Segoe UI Variable","Avenir Next","PingFang SC","Hiragino Sans GB",sans-serif',
      mono: '"SF Mono","Fira Code",ui-monospace,monospace'
    }
  }
})
