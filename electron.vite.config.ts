import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [UnoCSS(), svelte()],
    resolve: {
      alias: {
        $lib: resolve(__dirname, 'src/renderer/src/lib')
      }
    },
    server: {
      port: 18180,
      strictPort: true
    }
  }
})
