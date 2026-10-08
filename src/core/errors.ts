export type ErrorCode = "BAD_PASSWORD" | "UNSUPPORTED_ALGORITHM" | "MALFORMED_P12" | "NO_KEY";

export class KzSignError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(`${code}: ${message}`);
  }
}
