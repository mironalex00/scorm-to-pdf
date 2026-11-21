import { UsageError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseMoodleBaseUrl(raw: string, source: string, messages: Messages): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(messages.cli.baseUrlInvalid({ source }));
  }
  if (url.username || url.password) throw new UsageError(messages.cli.baseUrlCredentials({ source }));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new UsageError(messages.cli.baseUrlInsecure({ source, raw: url.origin }));
  }
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}
