import type { CourseItem } from "../domain/catalog.ts";
import type { Tracer } from "../tracing/Tracer.ts";
import type { FileNamer } from "./FileNamer.ts";
import type { FileSink, LearningPlatform } from "./ports.ts";
import type { SlidesToPdf } from "./SlidesToPdf.ts";

export interface DownloadTarget {
  readonly destRoot: string;
  /** Sanitized name assigned by the planner, before the source extension is resolved. */
  readonly baseName: string;
  readonly sectionFolder?: string;
  readonly groupByItem?: boolean;
}

export type ItemOutcome =
  | { readonly item: CourseItem; readonly status: "downloaded"; readonly path: string; readonly bytes: number }
  | { readonly item: CourseItem; readonly status: "skipped"; readonly path: string }
  | { readonly item: CourseItem; readonly status: "failed"; readonly error: unknown; readonly authentication: boolean };

export interface ItemTransfer {
  download(item: CourseItem, target: DownloadTarget): Promise<ItemOutcome>;
}

/** Resolves selected materials and writes either the original file or a converted PDF. */
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
      const itemFolder = target.groupByItem ? target.baseName : "";
      const output = (fileName: string) => this.namer.itemPath(target.destRoot, item, fileName, target.sectionFolder, itemFolder);
      const skipped = (path: string) => {
        tracer.event("info", "download", "skipped.exists", { path });
        return { item, status: "skipped", path } as const;
      };
      const pdfPath = output(this.namer.fileName({ baseName: target.baseName, sourceFileName: "", contentType: undefined, forcedExtension: ".pdf" }));
      if (item.kind === "scorm" && await this.sink.exists(pdfPath)) return skipped(pdfPath);

      const fetched = await this.platform.fetchItem(item);
      let path: string;
      let content: Uint8Array;
      if (fetched.kind === "file") {
        path = output(this.namer.fileName({
          baseName: target.baseName,
          sourceFileName: fetched.fileName,
          contentType: fetched.contentType,
        }));
        content = fetched.bytes;
      } else {
        path = pdfPath;
        content = (await this.slides.render(this.slides.parse(fetched.html), fetched.entryUrl)).pdf;
      }

      if (fetched.kind === "file" && await this.sink.exists(path)) return skipped(path);
      const written = await this.sink.writeIfAbsent(path, content);
      return written === undefined ? skipped(path) : { item, status: "downloaded", path: written, bytes: content.length };
    });
  }
}
