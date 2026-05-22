import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

const rendererComponentTests = [
  'src/renderer/src/lib/ui/__test__/AppDialog.test.ts',
  'src/renderer/src/views/accounts/__test__/AccountsListView.test.ts',
  'src/renderer/src/shell/__test__/WorkspaceShell.test.ts',
  'src/renderer/src/views/accounts/__test__/AccountsProvidersView.test.ts',
  'src/renderer/src/views/gateway/__test__/LocalGatewayView.test.ts',
  'src/renderer/src/views/settings/__test__/SettingsView.test.ts',
  'src/renderer/src/views/sessions/__test__/SessionsView.test.ts'
]

export default defineConfig({
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/renderer/src/lib')
    }
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: rendererComponentTests
        }
      },
      {
        extends: true,
        plugins: [svelte(), svelteTesting({ autoCleanup: false })],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: rendererComponentTests,
          setupFiles: ['./src/renderer/src/test/setup.ts']
        }
      }
    ]
  }
})
