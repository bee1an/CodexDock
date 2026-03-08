import { net, safeStorage, shell } from 'electron'

import type { CodexPlatformAdapter } from '../shared/codex-platform'

export function createElectronCodexPlatformAdapter(): CodexPlatformAdapter {
  return {
    fetch: (input, init) => net.fetch(input, init),
    protect: (value) => {
      if (safeStorage.isEncryptionAvailable()) {
        return {
          mode: 'safeStorage',
          value: safeStorage.encryptString(value).toString('base64')
        }
      }

      return {
        mode: 'plain',
        value: Buffer.from(value, 'utf8').toString('base64')
      }
    },
    unprotect: (payload) => {
      if (payload.mode === 'safeStorage') {
        return safeStorage.decryptString(Buffer.from(payload.value, 'base64'))
      }

      return Buffer.from(payload.value, 'base64').toString('utf8')
    },
    openExternal: (url) => shell.openExternal(url)
  }
}
