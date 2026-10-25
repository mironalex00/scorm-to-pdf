export interface ShapeOptions {
  readonly depth?: number;
  readonly maxKeys?: number;
}

/**
 * Huella estructural de un valor: claves y tipos, jamás contenidos. Permite diagnosticar una
 * respuesta inesperada («esperaba courses[], llegó {error: boolean}») sin filtrar datos del usuario.
 */
export function describeShape(value: unknown, options: ShapeOptions = {}): string {
  const depth = options.depth ?? 3;
  const maxKeys = options.maxKeys ?? 8;
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.length} × ${describeShape(value[0], { depth: depth - 1, maxKeys })}]`;
  }
  if (typeof value !== "object") return typeof value;
  if (depth <= 0) return "{…}";

  const keys = Object.keys(value);
  const parts = keys
    .slice(0, maxKeys)
    .map((key) => `${key}: ${describeShape((value as Record<string, unknown>)[key], { depth: depth - 1, maxKeys })}`);
  if (keys.length > maxKeys) parts.push(`…+${keys.length - maxKeys}`);
  return `{${parts.join(", ")}}`;
}
