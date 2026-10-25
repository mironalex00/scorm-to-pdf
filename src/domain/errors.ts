/**
 * Jerarquía de errores esperados. Cada uno lleva el código de salida del proceso,
 * así la capa de arranque no necesita conocer los tipos concretos.
 */
export abstract class AppError extends Error {
  abstract readonly exitCode: number;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Argumentos de línea de comandos o entorno inválidos. */
export class UsageError extends AppError {
  readonly exitCode = 2;
}

/** Moodle no reconoce la sesión (cookie caducada, incorrecta o ausente). */
export class AuthenticationError extends AppError {
  readonly exitCode = 3;
}

/** El recurso pedido no existe en el servidor. */
export class NotFoundError extends AppError {
  readonly exitCode = 1;
}

/** El paquete SCORM no tiene la estructura esperada. */
export class ScormFormatError extends AppError {
  readonly exitCode = 1;
}

/** Fallo de red, de HTTP o de validación de un recurso descargado. */
export class DownloadError extends AppError {
  readonly exitCode = 1;
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.retryable = options.retryable ?? false;
  }
}

/** La plataforma respondió con una forma inesperada o rechazó la operación. */
export class PlatformError extends AppError {
  readonly exitCode = 1;
}

/** No se pudo escribir el PDF en disco. */
export class OutputError extends AppError {
  readonly exitCode = 1;
}

/** Texto de cualquier valor lanzado: `throw "x"` o `throw 42` también son válidos en JavaScript. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
