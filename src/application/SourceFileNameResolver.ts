/** Deduce el nombre original de un archivo descargado: Content-Disposition primero, la URL después. */
export class SourceFileNameResolver {
  resolve(input: { url: URL; contentDisposition: string | undefined }): string {
    const fromHeader = this.fromHeader(input.contentDisposition);
    if (fromHeader !== undefined) return fromHeader;
    const segment = input.url.pathname.split("/").at(-1)!;
    return this.decode(segment) ?? segment;
  }

  private fromHeader(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const extended = /filename\*\s*=\s*utf-8''([^;]+)/i.exec(header);
    const decoded = extended ? this.decode(extended[1]!.trim()) : undefined;
    if (decoded !== undefined) return this.baseName(decoded);
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
    return plain ? this.baseName((plain[1] ?? plain[2]!).trim()) : undefined;
  }

  private baseName(name: string): string {
    return name.split(/[\\/]/).at(-1)!;
  }

  private decode(text: string): string | undefined {
    try {
      return decodeURIComponent(text);
    } catch {
      return undefined;
    }
  }
}
