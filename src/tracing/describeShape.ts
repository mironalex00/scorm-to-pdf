export interface ShapeOptions {
  readonly depth?: number;
  readonly maxKeys?: number;
}

/** Summarizes a value by key and type for diagnostics. */
export function describeShape(value: unknown, options: ShapeOptions = {}): string {
  const depth = options.depth ?? 3;
  const maxKeys = options.maxKeys ?? 8;
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (depth <= 0) return "[...]";
    return `[${value.length} x ${describeShape(value[0], { depth: depth - 1, maxKeys })}]`;
  }
  if (typeof value !== "object") return typeof value;
  if (depth <= 0) return "{...}";

  const keys = Object.keys(value);
  const parts = keys
    .slice(0, maxKeys)
    .map((key) => `${key}: ${describeShape((value as Record<string, unknown>)[key], { depth: depth - 1, maxKeys })}`);
  if (keys.length > maxKeys) parts.push(`...+${keys.length - maxKeys}`);
  return `{${parts.join(", ")}}`;
}
