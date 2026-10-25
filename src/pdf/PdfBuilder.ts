import type { JpegInspector } from "./JpegInspector.ts";
import type { Messages } from "../i18n/Messages.ts";

/** Genera un PDF 1.4 con una página por JPEG, incrustado tal cual (DCTDecode). */
export class PdfBuilder {
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly inspector: JpegInspector;
  private readonly messages: Messages;

  constructor(deps: { pageWidth: number; pageHeight: number; inspector: JpegInspector; messages: Messages }) {
    this.messages = deps.messages;
    this.pageWidth = deps.pageWidth;
    this.pageHeight = deps.pageHeight;
    this.inspector = deps.inspector;
  }

  build(jpegs: readonly Uint8Array[]): Uint8Array {
    if (jpegs.length === 0) throw new RangeError(this.messages.pdf.noImages());

    const writer = new PdfWriter(2 + jpegs.length * 3);
    writer.header();

    const pageObjects = jpegs.map((_, index) => 3 + index * 3);
    writer.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    writer.object(
      2,
      `<< /Type /Pages /Kids [${pageObjects.map((n) => `${n} 0 R`).join(" ")}] /Count ${jpegs.length} >>`,
    );

    jpegs.forEach((jpeg, index) => this.addPage(writer, jpeg, index));
    return writer.finish();
  }

  private addPage(writer: PdfWriter, jpeg: Uint8Array, index: number): void {
    const info = this.inspector.inspect(jpeg, index + 1);
    const pageObject = 3 + index * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;

    // Encaja la imagen en la página sin deformarla y la centra.
    const scale = Math.min(this.pageWidth / info.width, this.pageHeight / info.height);
    const drawWidth = info.width * scale;
    const drawHeight = info.height * scale;
    const x = (this.pageWidth - drawWidth) / 2;
    const y = (this.pageHeight - drawHeight) / 2;

    const content =
      `q\n1 1 1 rg\n0 0 ${this.pageWidth} ${this.pageHeight} re f\nq\n` +
      `${this.number(drawWidth)} 0 0 ${this.number(drawHeight)} ${this.number(x)} ${this.number(y)} cm\n` +
      `/Im0 Do\nQ\nQ\n`;

    writer.object(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] ` +
        `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
    );
    writer.object(contentObject, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
    writer.object(
      imageObject,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} ` +
            `/ColorSpace ${info.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode ` +
            `/Length ${jpeg.length} >>\nstream\n`,
          "latin1",
        ),
        jpeg,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
  }

  private number(value: number): string {
    return Number(value.toFixed(5)).toString();
  }
}

/** Acumula objetos PDF numerados y emite la tabla xref con los desplazamientos reales. */
class PdfWriter {
  private readonly chunks: Buffer[] = [];
  private readonly offsets: number[];
  private readonly objectCount: number;
  private position = 0;

  constructor(objectCount: number) {
    this.objectCount = objectCount;
    this.offsets = new Array<number>(objectCount + 1).fill(0);
  }

  header(): void {
    this.append(Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1"));
  }

  object(number: number, body: string | Buffer): void {
    this.offsets[number] = this.position;
    this.append(Buffer.from(`${number} 0 obj\n`, "latin1"));
    this.append(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    this.append(Buffer.from("\nendobj\n", "latin1"));
  }

  finish(): Uint8Array {
    const xrefOffset = this.position;
    const entries = this.offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("");
    this.append(
      Buffer.from(
        `xref\n0 ${this.objectCount + 1}\n0000000000 65535 f \n${entries}` +
          `trailer\n<< /Size ${this.objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
        "latin1",
      ),
    );
    return Buffer.concat(this.chunks);
  }

  private append(buffer: Buffer): void {
    this.chunks.push(buffer);
    this.position += buffer.length;
  }
}
