import { AuthenticationError, DownloadError, NotFoundError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { Tracer } from "../tracing/Tracer.ts";
import type { HttpClient, HttpRequest, HttpResponse } from "./ports.ts";
import type { SessionCookie } from "./SessionCookie.ts";

const MAX_REDIRECTS = 5;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const LOGIN_PATH = /\/(?:login\/index\.php|auth\/\w+\/)/;
const LOGIN_PAGE = /id=["']page-login-index["']|\bnotloggedin\b/;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const ACCEPT_IMAGE = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const ACCEPT_JSON = "application/json, text/javascript, */*; q=0.01";
const SCOPE = "moodle.http";

export interface FetchedText {
  readonly text: string;
  readonly finalUrl: URL;
}

export interface FetchedBytes {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly contentDisposition: string | undefined;
  readonly finalUrl: URL;
}

export interface PostedJson {
  readonly text: string;
  readonly status: number;
}

/**
 * Peticiones autenticadas contra un único origen de Moodle. Sigue las redirecciones a mano
 * para garantizar que la cookie nunca sale de ese origen, traduce el 200 «página de login»
 * (la trampa clásica de Moodle) en un AuthenticationError y deja traza de cada salto.
 */
export class MoodleSession {
  private readonly http: HttpClient;
  private readonly cookie: SessionCookie;
  private readonly origin: string;
  private readonly messages: Messages;
  private readonly tracer: Tracer;

  constructor(deps: { http: HttpClient; cookie: SessionCookie; baseUrl: URL; messages: Messages; tracer: Tracer }) {
    this.messages = deps.messages;
    this.tracer = deps.tracer;
    this.http = deps.http;
    this.cookie = deps.cookie;
    this.origin = deps.baseUrl.origin;
  }

  /** `label` pide guardar una captura (redactada) de la página cuando la traza la admite. */
  async getText(url: URL, label?: string): Promise<FetchedText> {
    const { response, finalUrl } = await this.request(url, ACCEPT_HTML, MAX_TEXT_BYTES);
    const text = new TextDecoder("utf-8").decode(response.body);
    if (label !== undefined) this.tracer.snapshot(label, text, { path: finalUrl.pathname, status: response.status });
    if (LOGIN_PAGE.test(text)) {
      this.tracer.event("warn", "moodle.session", "login-page-detected", { path: finalUrl.pathname });
      throw this.authenticationError();
    }
    return { text, finalUrl };
  }

  async getBytes(url: URL, maxBytes: number): Promise<FetchedBytes> {
    const { response, finalUrl } = await this.request(url, ACCEPT_IMAGE, maxBytes);
    return {
      bytes: response.body,
      contentType: response.contentType,
      contentDisposition: response.contentDisposition,
      finalUrl,
    };
  }

  async postJson(url: URL, body: unknown, referer: string): Promise<PostedJson> {
    this.assertAllowed(url);
    const response = await this.send(
      {
        method: "POST",
        url,
        body: JSON.stringify(body),
        maxBytes: MAX_TEXT_BYTES,
        headers: {
          ...this.baseHeaders(ACCEPT_JSON),
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Origin: this.origin,
          Referer: referer,
        },
      },
      0,
    );
    if (REDIRECT_STATUSES.has(response.status)) {
      this.assertAllowed(this.resolveLocation(response.location, url));
      throw new DownloadError(this.messages.session.postRedirect({ path: url.pathname }));
    }
    this.assertSuccess(response.status, url);
    return { text: new TextDecoder("utf-8").decode(response.body), status: response.status };
  }

  private async request(
    start: URL,
    accept: string,
    maxBytes: number,
  ): Promise<{ response: HttpResponse; finalUrl: URL }> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      this.assertAllowed(url);
      const response = await this.send({ url, headers: this.baseHeaders(accept), maxBytes }, hop);
      if (!REDIRECT_STATUSES.has(response.status)) {
        this.assertSuccess(response.status, url);
        return { response, finalUrl: url };
      }
      url = this.resolveLocation(response.location, url);
    }
    throw new DownloadError(this.messages.session.tooManyRedirects({ path: start.pathname }));
  }

  private async send(request: HttpRequest, hop: number): Promise<HttpResponse> {
    const method = request.method ?? "GET";
    const target = `${request.url.pathname}${request.url.search}`;
    const response = await this.tracer.span(SCOPE, "request", { method, url: target, hop }, () => this.http.get(request));
    this.tracer.event("debug", SCOPE, "response", {
      method,
      url: target,
      hop,
      status: response.status,
      contentType: response.contentType,
      bytes: response.body.length,
      location: response.location,
    });
    return response;
  }

  private baseHeaders(accept: string): Record<string, string> {
    return { "User-Agent": USER_AGENT, Accept: accept, Cookie: this.cookie.headerValue() };
  }

  private assertAllowed(url: URL): void {
    if (url.origin !== this.origin) {
      throw new DownloadError(this.messages.session.blockedOrigin({ origin: url.origin }));
    }
    if (LOGIN_PATH.test(url.pathname)) throw this.authenticationError();
  }

  private resolveLocation(location: string | undefined, from: URL): URL {
    if (!location) throw new DownloadError(this.messages.session.redirectWithoutLocation({ path: from.pathname }));
    try {
      return new URL(location, from);
    } catch (error) {
      throw new DownloadError(this.messages.session.invalidLocation({ path: from.pathname }), { cause: error });
    }
  }

  private assertSuccess(status: number, url: URL): void {
    if (status >= 200 && status < 300) return;
    if (status === 404) throw new NotFoundError(this.messages.session.notFound({ path: url.pathname }));
    if (status === 401 || status === 403) throw this.authenticationError();
    const retryable = status >= 500 || status === 429 || status === 408;
    throw new DownloadError(this.messages.session.httpStatus({ status: String(status), path: url.pathname }), {
      retryable,
    });
  }

  private authenticationError(): AuthenticationError {
    return new AuthenticationError(
      this.messages.session.authFailed({ cookieNames: this.cookie.names().join(", ") }),
    );
  }
}
