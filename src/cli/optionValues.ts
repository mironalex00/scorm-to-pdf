import { UsageError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";

export function parseInteger(
  messages: Messages, label: string, raw: string, min: number, max: number, allowNumberSyntax = false,
): number {
  const value = allowNumberSyntax || /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new UsageError(messages.cli.integerRange({ label, min: String(min), max: String(max), raw }));
  }
  return value;
}
