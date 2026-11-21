const PLACEHOLDER = "[REDACTED]";
const MIN_SECRET_LENGTH = 4;
const MAX_DEPTH = 8;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(sesskey=)[^&\s"'<>]+/gi, `$1${PLACEHOLDER}`],
  [/(\\"sesskey\\"\s*:\s*\\")[^\\"]*/gi, `$1${PLACEHOLDER}`],
  [/("sesskey"\s*:\s*")[^"]*/gi, `$1${PLACEHOLDER}`],
  [/(name="sesskey"\s+value=")[^"]*/gi, `$1${PLACEHOLDER}`],
  [/(MoodleSession\w{0,32}=)[^;\s"']+/gi, `$1${PLACEHOLDER}`],
  [/(token=)[^&\s"'<>]+/gi, `$1${PLACEHOLDER}`],
  // Bound the email pattern so long runs of letters scan in linear time.
  [/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, PLACEHOLDER],
];

/** Redacts registered credentials and common secret formats in diagnostic data. */
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
    if (depth > MAX_DEPTH) return "[...]";
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
