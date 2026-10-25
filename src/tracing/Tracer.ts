export type TraceLevel = "debug" | "info" | "warn" | "error";

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  /** «Nombre: mensaje» de cada error de la cadena de causas, del más externo al más interno. */
  readonly chain: readonly string[];
  readonly stack?: string;
}

export interface TraceEvent {
  readonly t: string;
  readonly seq: number;
  readonly run: string;
  readonly level: TraceLevel;
  /** Dónde: componente y operación, p. ej. «moodle.http». */
  readonly scope: string;
  /** Qué ocurrió, p. ej. «response» o «load.fail». */
  readonly name: string;
  readonly ms?: number;
  readonly ctx?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly error?: SerializedError;
}

/** Destino de la traza: archivos en producción, memoria en las pruebas. */
export interface TraceSink {
  write(line: string): void;
  snapshot(name: string, content: string): void;
  location(): string;
}

/**
 * Observabilidad: cuándo (marca de tiempo y duración), dónde (ámbito) y cómo (datos, forma de las
 * respuestas y cadena de causas) falla algo. Nunca debe alterar el comportamiento de la aplicación.
 */
export interface Tracer {
  event(level: TraceLevel, scope: string, name: string, data?: Record<string, unknown>): void;
  span<T>(scope: string, name: string, data: Record<string, unknown>, work: () => Promise<T>): Promise<T>;
  /** Guarda un cuerpo de respuesta ya redactado; solo si la captura está activada. */
  snapshot(label: string, content: string, meta?: Record<string, unknown>): void;
  /** Devuelve un trazador que añade este contexto a cada evento (seguro con concurrencia). */
  with(context: Record<string, unknown>): Tracer;
  /** Registra un valor que no debe aparecer jamás en la traza. */
  addSecret(value: string): void;
  hasErrors(): boolean;
  /** Escribe lo pendiente y devuelve dónde quedó la traza, si la hay. */
  flush(): string | undefined;
}
