import { DownloadError } from "../domain/errors.ts";
import type { HttpClient, HttpRequest, HttpResponse } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";

/** Caps request time and response size. Callers handle redirects and retries. */
export class FetchHttpClient implements HttpClient {
  private readonly timeoutMs: number;
  private readonly messages: Messages;

  constructor(settings: { timeoutMs: number; messages: Messages }) {
    this.timeoutMs = settings.timeoutMs;
    this.messages = settings.messages;
  }

  async get(request: HttpRequest): Promise<HttpResponse> {
    try {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const response = await fetch(request.url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
        redirect: "manual",
        signal,
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
      request.signal?.throwIfAborted();
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

    const declared = Number(response.headers.get("content-length"));
    const encoding = response.headers.get("content-encoding")?.toLowerCase();
    const knownLength = Number.isSafeInteger(declared) && declared > 0 && (!encoding || encoding === "identity");
    if (knownLength && declared > request.maxBytes) {
      await response.body.cancel().catch(() => undefined);
      throw this.tooLarge(request);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let contiguous: Uint8Array | undefined;
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const end = total + value.length;
        if (end > request.maxBytes) throw this.tooLarge(request);
        if (knownLength && end <= declared && chunks.length === 0) {
          contiguous ??= new Uint8Array(declared);
          contiguous.set(value, total);
        } else {
          if (contiguous) chunks.push(contiguous.subarray(0, total));
          contiguous = undefined;
          chunks.push(value);
        }
        total = end;
      }
      if (contiguous) return contiguous.subarray(0, total);
      return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, total);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private tooLarge(request: HttpRequest): DownloadError {
    return new DownloadError(
      this.messages.http.responseTooLarge({ path: request.url.pathname, max: String(request.maxBytes) }),
    );
  }
}
