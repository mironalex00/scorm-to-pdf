import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** Servidor HTTP real en 127.0.0.1 con puerto efímero, para probar adaptadores sin mocks. */
export class LocalServer {
  readonly requests: IncomingMessage[] = [];
  private readonly server: Server;
  private readonly sockets = new Set<import("node:net").Socket>();

  private constructor(server: Server) {
    this.server = server;
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
  }

  static async start(handler: RequestHandler): Promise<LocalServer> {
    let local: LocalServer;
    const server = createServer((request, response) => {
      local.requests.push(request);
      handler(request, response);
    });
    local = new LocalServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return local;
  }

  get origin(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  url(path: string): URL {
    return new URL(path, this.origin);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
