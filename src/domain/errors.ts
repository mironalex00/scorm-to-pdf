/** An expected failure with a CLI exit status. */
export abstract class AppError extends Error {
  abstract readonly exitCode: number;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid arguments or environment settings. */
export class UsageError extends AppError {
  readonly exitCode = 2;
}

/** Moodle rejected the session. */
export class AuthenticationError extends AppError {
  readonly exitCode = 3;
}

/** The requested resource does not exist. */
export class NotFoundError extends AppError {
  readonly exitCode = 1;
}

/** The SCORM package has an unsupported structure. */
export class ScormFormatError extends AppError {
  readonly exitCode = 1;
}

/** A request or response validation failed. */
export class DownloadError extends AppError {
  readonly exitCode = 1;
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.retryable = options.retryable ?? false;
  }
}

/** The platform rejected the request or returned an unexpected response. */
export class PlatformError extends AppError {
  readonly exitCode = 1;
}

/** The destination could not be written. */
export class OutputError extends AppError {
  readonly exitCode = 1;
}

/** Returns an error message even when the thrown value is not an Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
