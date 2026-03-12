import { net, shell } from 'electron'

import type { CodexPlatformAdapter } from '../shared/codex-platform'

export function createElectronCodexPlatformAdapter(): CodexPlatformAdapter {
  return {
    fetch: (input, init) => net.fetch(input, init),
    protect: (value) => ({
      mode: 'plain',
      value: Buffer.from(value, 'utf8').toString('base64')
    }),
    unprotect: (payload) => {
      if (payload.mode === 'safeStorage') {
        throw new Error(
          'Credentials saved by older versions used macOS Keychain storage and can no longer be read. Re-add them in this version.'
        )
      }

      return Buffer.from(payload.value, 'base64').toString('utf8')
    },
    openExternal: (url) => shell.openExternal(url)
  }
}
