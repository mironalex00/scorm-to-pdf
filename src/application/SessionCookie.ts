import { inspect } from "node:util";
import { UsageError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";

const DEFAULT_COOKIE_NAME = "MoodleSession";

/**
 * Cookie de sesión de Moodle. El valor vive en un campo privado y solo sale por
 * `headerValue()`: imprimirla, serializarla o inspeccionarla muestra únicamente los nombres.
 */
export class SessionCookie {
  readonly #header: string;

  private constructor(header: string) {
    this.#header = header;
  }

  /** Acepta la cabecera Cookie completa, «nombre=valor» o solo el valor de MoodleSession. */
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

  /** Los valores de cada cookie, para registrarlos como secretos en la traza. */
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
