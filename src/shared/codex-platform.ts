export interface ProtectedPayload {
  mode: 'safeStorage' | 'plain'
  value: string
}

export interface CodexPlatformAdapter {
  fetch(input: string, init?: RequestInit): Promise<Response>
  protect(value: string): ProtectedPayload
  unprotect(payload: ProtectedPayload): string
  openExternal(url: string): Promise<void>
}
