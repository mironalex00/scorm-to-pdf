import type {
  Delay,
  FileSink,
  HttpClient,
  HttpRequest,
  HttpResponse,
  Logger,
  ProgressUpdate,
} from "../../src/application/ports.ts";

export function okResponse(
  body: Uint8Array | string,
  contentType = "text/html; charset=utf-8",
  contentDisposition?: string,
): HttpResponse {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return { status: 200, location: undefined, contentType, contentDisposition, body: bytes };
}

export function redirectResponse(location: string | undefined, status = 303): HttpResponse {
  return { status, location, contentType: "text/html", contentDisposition: undefined, body: new Uint8Array() };
}

export function statusResponse(status: number): HttpResponse {
  return { status, location: undefined, contentType: "text/html", contentDisposition: undefined, body: new Uint8Array() };
}

type Handler = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/** Cliente HTTP en memoria: responde según una tabla de rutas y registra cada petición. */
export class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  private readonly routes = new Map<string, Handler>();

  on(url: string, handler: Handler | HttpResponse): this {
    this.routes.set(url, typeof handler === "function" ? handler : () => handler);
    return this;
  }

  async get(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const handler = this.routes.get(request.url.href);
    if (!handler) throw new Error(`FakeHttpClient: ruta no registrada ${request.url.href}`);
    return handler(request);
  }

  requestedUrls(): string[] {
    return this.requests.map((request) => request.url.href);
  }
}

export class MemoryFileSink implements FileSink {
  readonly files = new Map<string, Uint8Array>();

  async write(path: string, content: Uint8Array): Promise<string> {
    this.files.set(path, content);
    return path;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

export class MemoryLogger implements Logger {
  readonly infos: string[] = [];
  readonly results: string[] = [];
  readonly warnings: string[] = [];
  readonly updates: ProgressUpdate[] = [];

  info(message: string): void {
    this.infos.push(message);
  }
  result(message: string): void {
    this.results.push(message);
  }
  warn(message: string): void {
    this.warnings.push(message);
  }
  progress(update: ProgressUpdate): void {
    this.updates.push(update);
  }
}

export class RecordingDelay implements Delay {
  readonly waits: number[] = [];

  async wait(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds);
  }
}
