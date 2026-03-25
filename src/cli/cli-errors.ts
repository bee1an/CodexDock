export class CliError extends Error {
  constructor(
    message: string,
    readonly code: number
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export const EXIT_OK = 0
export const EXIT_FAILURE = 1
export const EXIT_USAGE = 2
export const EXIT_ENVIRONMENT = 3
