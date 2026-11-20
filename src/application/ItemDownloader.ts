import type { CourseItem } from "../domain/catalog.ts";
import type { Tracer } from "../tracing/Tracer.ts";
import type { FileNamer } from "./FileNamer.ts";
import type { FileSink, LearningPlatform } from "./ports.ts";
import type { SlidesToPdf } from "./SlidesToPdf.ts";

export interface DownloadTarget {
  readonly destRoot: string;
  /** Nombre sin extensión, ya saneado y sin duplicados (lo decide el NamePlanner). */
  readonly baseName: string;
  readonly sectionFolder?: string;
}

export type ItemOutcome =
  | { readonly item: CourseItem; readonly status: "downloaded"; readonly path: string; readonly bytes: number }
  | { readonly item: CourseItem; readonly status: "skipped"; readonly path: string }
  | { readonly item: CourseItem; readonly status: "failed"; readonly error: unknown; readonly authentication: boolean };

export interface ItemTransfer {
  download(item: CourseItem, target: DownloadTarget): Promise<ItemOutcome>;
}

/**
 * Descarga un ítem elegido. La resolución del enlace real se hace aquí, al descargar, no al listar:
 * un archivo directo se guarda tal cual y un SCORM de diapositivas pasa por el flujo de conversión a PDF.
 */
export class ItemDownloader implements ItemTransfer {
  private readonly platform: LearningPlatform;
  private readonly slides: SlidesToPdf;
  private readonly namer: FileNamer;
  private readonly sink: FileSink;
  private readonly tracer: Tracer;

  constructor(deps: {
    platform: LearningPlatform;
    slides: SlidesToPdf;
    namer: FileNamer;
    sink: FileSink;
    tracer: Tracer;
  }) {
    this.platform = deps.platform;
    this.slides = deps.slides;
    this.namer = deps.namer;
    this.sink = deps.sink;
    this.tracer = deps.tracer;
  }

  download(item: CourseItem, target: DownloadTarget): Promise<ItemOutcome> {
    const tracer = this.tracer.with({ item: item.id });
    return tracer.span("download", "item", { name: item.name, kind: item.kind, section: item.sectionNumber }, async () => {
      const fetched = await this.platform.fetchItem(item);
      let fileName: string;
      let content: Uint8Array;
      if (fetched.kind === "file") {
        fileName = this.namer.fileName({
          baseName: target.baseName,
          sourceFileName: fetched.fileName,
          contentType: fetched.contentType,
        });
        content = fetched.bytes;
      } else {
        const rendered = await this.slides.render(this.slides.parse(fetched.html), fetched.entryUrl);
        fileName = this.namer.fileName({
          baseName: target.baseName,
          sourceFileName: "",
          contentType: undefined,
          forcedExtension: ".pdf",
        });
        content = rendered.pdf;
      }

      const path = this.namer.itemPath(target.destRoot, item, fileName, target.sectionFolder);
      if (await this.sink.exists(path)) {
        tracer.event("info", "download", "skipped.exists", { path });
        return { item, status: "skipped", path };
      }
      const written = await this.sink.write(path, content);
      return { item, status: "downloaded", path: written, bytes: content.length };
    });
  }
}
