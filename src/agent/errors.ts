export class ExternalAdapterError extends Error {
  constructor(
    readonly adapterCode: string,
    message: string,
    readonly retryable = false,
    readonly safeDetails?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExternalAdapterError";
  }
}
