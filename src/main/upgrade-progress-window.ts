import { BrowserWindow } from 'electron'

import type { UpgradeProgressEvent } from '../shared/codex'

const READY_FLUSH_MS = 50
const PRODUCTION_INSTALL_ACK_TIMEOUT_MS = 1500
const DEVELOPMENT_INSTALL_ACK_TIMEOUT_MS = 3000

export interface UpgradeProgressWindowController {
  open(): void
  close(): void
  isOpen(): boolean
  getWindow(): BrowserWindow | null
  emit(event: UpgradeProgressEvent): void
  markRendererReady(): void
  markInstallRendered(): void
  waitForInstallAck(timeoutMs?: number): Promise<void>
}

export interface CreateUpgradeProgressWindowControllerOptions {
  createWindow: () => BrowserWindow
  isDevelopment?: boolean
}

export function createUpgradeProgressWindowController(
  options: CreateUpgradeProgressWindowControllerOptions
): UpgradeProgressWindowController {
  let window: BrowserWindow | null = null
  let rendererReady = false
  let installRenderedResolvers: Array<() => void> = []
  let installRendered = false
  const buffer: UpgradeProgressEvent[] = []

  function isWindowAlive(): boolean {
    return Boolean(window) && !window!.isDestroyed()
  }

  function flushBuffer(): void {
    if (!isWindowAlive() || !rendererReady) {
      return
    }
    while (buffer.length > 0) {
      const event = buffer.shift()
      if (!event) {
        break
      }
      window!.webContents.send('upgrade:event', event)
    }
  }

  function reset(): void {
    rendererReady = false
    installRendered = false
    installRenderedResolvers.forEach((resolve) => resolve())
    installRenderedResolvers = []
    buffer.length = 0
  }

  return {
    open(): void {
      if (isWindowAlive()) {
        window!.show()
        window!.focus()
        return
      }

      reset()
      window = options.createWindow()
      window.on('closed', () => {
        window = null
        reset()
      })
    },
    close(): void {
      if (isWindowAlive()) {
        window!.close()
      }
      window = null
      reset()
    },
    isOpen(): boolean {
      return isWindowAlive()
    },
    getWindow(): BrowserWindow | null {
      return isWindowAlive() ? window : null
    },
    emit(event: UpgradeProgressEvent): void {
      if (!isWindowAlive()) {
        return
      }
      buffer.push(event)
      if (rendererReady) {
        flushBuffer()
      }
    },
    markRendererReady(): void {
      rendererReady = true
      // Slight delay so the first paint covers a few ticks worth of events.
      setTimeout(() => {
        flushBuffer()
      }, READY_FLUSH_MS)
    },
    markInstallRendered(): void {
      installRendered = true
      installRenderedResolvers.forEach((resolve) => resolve())
      installRenderedResolvers = []
    },
    waitForInstallAck(timeoutMs?: number): Promise<void> {
      if (!isWindowAlive()) {
        return Promise.resolve()
      }
      if (installRendered) {
        return Promise.resolve()
      }

      const timeout =
        timeoutMs ??
        (options.isDevelopment
          ? DEVELOPMENT_INSTALL_ACK_TIMEOUT_MS
          : PRODUCTION_INSTALL_ACK_TIMEOUT_MS)

      return new Promise<void>((resolve) => {
        let settled = false
        const finish = (): void => {
          if (settled) {
            return
          }
          settled = true
          resolve()
        }

        installRenderedResolvers.push(finish)
        setTimeout(finish, timeout)
      })
    }
  }
}
