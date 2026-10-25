const PLACEHOLDER = "[REDACTADO]";
const MIN_SECRET_LENGTH = 4;
const MAX_DEPTH = 8;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(sesskey=)[^&\s"'<>]+/g, `$1${PLACEHOLDER}`],
  [/(\\"sesskey\\"\s*:\s*\\")[^\\"]*/g, `$1${PLACEHOLDER}`],
  [/("sesskey"\s*:\s*")[^"]*/g, `$1${PLACEHOLDER}`],
  [/(name="sesskey"\s+value=")[^"]*/g, `$1${PLACEHOLDER}`],
  // Los cuantificadores de las dos reglas siguientes están acotados a propósito: sin cota, una racha
  // larga de caracteres de palabra las vuelve cuadráticas (decenas de segundos con 300 000 caracteres).
  [/(MoodleSession\w{0,32}=)[^;\s"']+/g, `$1${PLACEHOLDER}`],
  [/(token=)[^&\s"'<>]+/g, `$1${PLACEHOLDER}`],
  [/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, PLACEHOLDER],
];

/** Elimina secretos y datos personales antes de que nada salga del proceso (trazas, capturas, almacén). */
export class Redactor {
  private readonly secrets = new Set<string>();

  addSecret(value: string): void {
    if (value.length < MIN_SECRET_LENGTH) return;
    this.secrets.add(value);
    this.secrets.add(encodeURIComponent(value));
  }

  redact(text: string): string {
    let result = text;
    for (const secret of this.secrets) result = result.split(secret).join(PLACEHOLDER);
    for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
    return result;
  }

  redactValue(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return "[…]";
    if (typeof value === "string") return this.redact(value);
    if (Array.isArray(value)) return value.map((entry) => this.redactValue(entry, depth + 1));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.redactValue(entry, depth + 1)]),
      );
    }
    return value;
  }
}
