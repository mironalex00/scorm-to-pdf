import { inspect } from "node:util";
import { UsageError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";

const DEFAULT_COOKIE_NAME = "MoodleSession";

/** The session cookie value is private. Inspection and serialization show cookie names. */
export class SessionCookie {
  readonly #header: string;

  private constructor(header: string) {
    this.#header = header;
  }

  /** Accepts a Cookie header, a name-value pair, or a bare MoodleSession value. */
  static parse(raw: string | undefined, messages: Messages): SessionCookie {
    let text = (raw ?? "").trim().replace(/^cookie:\s*/i, "");
    text = text.replace(/^(['"])([\s\S]*)\1$/, "$2").trim();

    if (text === "") {
      throw new UsageError(messages.session.cookieMissing());
    }
    if (/[^\x20-\x7e]/.test(text)) {
      throw new UsageError(messages.session.cookieInvalidChars());
    }
    return new SessionCookie(text.includes("=") ? text : `${DEFAULT_COOKIE_NAME}=${text}`);
  }

  headerValue(): string {
    return this.#header;
  }

  /** Values registered with the trace redactor. */
  secretValues(): string[] {
    return this.#header
      .split(";")
      .map((pair) => pair.slice(pair.indexOf("=") + 1).trim())
      .filter((value) => value !== "");
  }

  names(): string[] {
    return this.#header.split(";").map((pair) => pair.split("=")[0]!.trim());
  }

  toString(): string {
    return `SessionCookie(${this.names().join(", ")})`;
  }

  toJSON(): string {
    return this.toString();
  }

  [inspect.custom](): string {
    return this.toString();
  }
}
