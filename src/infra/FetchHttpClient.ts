import { DownloadError } from "../domain/errors.ts";
import type { HttpClient, HttpRequest, HttpResponse } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";

/**
 * Adaptador de `fetch`. No sigue redirecciones (lo hace MoodleSession, que controla el origen),
 * limita el tiempo total y el tamaño del cuerpo, y marca como reintentables los fallos de red.
 */
export class FetchHttpClient implements HttpClient {
  private readonly timeoutMs: number;
  private readonly messages: Messages;

  constructor(settings: { timeoutMs: number; messages: Messages }) {
    this.timeoutMs = settings.timeoutMs;
    this.messages = settings.messages;
  }

  async get(request: HttpRequest): Promise<HttpResponse> {
    try {
      const response = await fetch(request.url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await this.readBody(response, request);
      return {
        status: response.status,
        location: response.headers.get("location") ?? undefined,
        contentType: response.headers.get("content-type") ?? "",
        contentDisposition: response.headers.get("content-disposition") ?? undefined,
        body,
      };
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      const reason = error as Error;
      throw new DownloadError(
        this.messages.http.networkFailure({ path: request.url.pathname, name: reason.name, detail: reason.message }),
        { retryable: true, cause: error },
      );
    }
  }

  private async readBody(response: Response, request: HttpRequest): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();

    if (Number(response.headers.get("content-length")) > request.maxBytes) {
      await response.body.cancel();
      throw this.tooLarge(request);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > request.maxBytes) {
        await reader.cancel();
        throw this.tooLarge(request);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  private tooLarge(request: HttpRequest): DownloadError {
    return new DownloadError(
      this.messages.http.responseTooLarge({ path: request.url.pathname, max: String(request.maxBytes) }),
    );
  }
}
