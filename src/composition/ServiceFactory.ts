import { BatchDownloader } from "../application/BatchDownloader.ts";
import { CatalogService } from "../application/CatalogService.ts";
import { ConvertScormToPdf } from "../application/ConvertScormToPdf.ts";
import { CourseResolver } from "../application/CourseResolver.ts";
import { FileNamer } from "../application/FileNamer.ts";
import { ItemDownloader } from "../application/ItemDownloader.ts";
import { MoodleSession } from "../application/MoodleSession.ts";
import { NamePlanner } from "../application/NamePlanner.ts";
import { OutputNamer } from "../application/OutputNamer.ts";
import { QuietLogger } from "../application/QuietLogger.ts";
import { ReportPrinter } from "../application/ReportPrinter.ts";
import { ScormLocator } from "../application/ScormLocator.ts";
import { SessionCookie } from "../application/SessionCookie.ts";
import { SlideDownloader } from "../application/SlideDownloader.ts";
import { SlideListParser } from "../application/SlideListParser.ts";
import { SlidesToPdf } from "../application/SlidesToPdf.ts";
import { SourceFileNameResolver } from "../application/SourceFileNameResolver.ts";
import type { HttpClient, LearningPlatform, Logger } from "../application/ports.ts";
import type { GlobalOptions } from "../cli/commands.ts";
import type { ResolvedPlatform } from "../extensions/ExtensionRegistry.ts";
import { HtmlParser } from "../html/HtmlParser.ts";
import type { Messages } from "../i18n/Messages.ts";
import { ConsoleLogger } from "../infra/ConsoleLogger.ts";
import type { OutputStream } from "../infra/ConsoleLogger.ts";
import { FetchHttpClient } from "../infra/FetchHttpClient.ts";
import { NodeFileSink } from "../infra/NodeFileSink.ts";
import { TimerDelay } from "../infra/TimerDelay.ts";
import { JpegInspector } from "../pdf/JpegInspector.ts";
import { PdfBuilder } from "../pdf/PdfBuilder.ts";
import { CourseIndexParser } from "../platforms/moodle/CourseIndexParser.ts";
import { CourseListParser } from "../platforms/moodle/CourseListParser.ts";
import { MoodlePlatform } from "../platforms/moodle/MoodlePlatform.ts";
import { ResourceFetcher } from "../platforms/moodle/ResourceFetcher.ts";
import { PluginfileLocator } from "../platforms/moodle/PluginfileLocator.ts";
import { ScormFetcher } from "../platforms/moodle/ScormFetcher.ts";
import { SesskeyExtractor } from "../platforms/moodle/SesskeyExtractor.ts";
import { CompressedStore } from "../store/CompressedStore.ts";
import type { Redactor } from "../tracing/Redactor.ts";
import type { Tracer } from "../tracing/Tracer.ts";

const MIB = 1024 * 1024;

/** Valores operativos fijos; lo que el usuario puede cambiar vive en las opciones de la CLI. */
export const SETTINGS = {
  requestTimeoutMs: 30_000,
  maxRevision: 30,
  probeBatchSize: 6,
  maxSlides: 500,
  maxImageBytes: 25 * MIB,
  maxFileBytes: 200 * MIB,
  retries: 2,
  backoffMs: 500,
  pageWidth: 960,
  pageHeight: 540,
  maxFileNameStem: 80,
  maxNameBytes: 120,
  itemConcurrency: 3,
  maxUrlPrefix: 2048,
} as const;

export interface Services {
  readonly logger: Logger;
  readonly platform: LearningPlatform;
  readonly catalog: CatalogService;
  readonly resolver: CourseResolver;
  readonly batch: BatchDownloader;
  readonly namer: FileNamer;
  readonly printer: ReportPrinter;
  readonly convert: ConvertScormToPdf;
}

/** Cablea el grafo de servicios de una ejecución. Junto a CliApplication, es la raíz de composición. */
export class ServiceFactory {
  private readonly http: HttpClient | undefined;
  private readonly stdout: OutputStream;
  private readonly stderr: OutputStream;

  constructor(deps: { http: HttpClient | undefined; stdout: OutputStream; stderr: OutputStream }) {
    this.http = deps.http;
    this.stdout = deps.stdout;
    this.stderr = deps.stderr;
  }

  create(input: {
    messages: Messages;
    locale: string;
    tracer: Tracer;
    redactor: Redactor;
    global: GlobalOptions;
    resolved: ResolvedPlatform;
    cookie: SessionCookie;
    /** Registrador alternativo (la TUI no puede escribir en la salida estándar). */
    logger?: Logger | undefined;
  }): Services {
    const { messages, tracer, global, resolved } = input;
    const http = this.http ?? new FetchHttpClient({ timeoutMs: SETTINGS.requestTimeoutMs, messages });
    const logger = input.logger ?? new ConsoleLogger({ stdout: this.stdout, stderr: this.stderr, quiet: global.quiet, messages });
    const session = new MoodleSession({ http, cookie: input.cookie, baseUrl: resolved.baseUrl, messages, tracer });

    const html = new HtmlParser();
    const locator = new PluginfileLocator({ maxPrefix: SETTINGS.maxUrlPrefix });
    const profile = {
      id: resolved.extension.id,
      baseUrl: resolved.baseUrl,
      contentsPaths: resolved.extension.contentsPaths,
      maxFileBytes: SETTINGS.maxFileBytes,
    };
    const platform = new MoodlePlatform({
      id: resolved.extension.id,
      profile,
      session,
      tracer,
      messages,
      sesskeys: new SesskeyExtractor(),
      courseList: new CourseListParser({ messages }),
      courseIndex: new CourseIndexParser({ html }),
      resources: new ResourceFetcher({ session, profile, tracer, messages, fileNames: new SourceFileNameResolver(), html, locator }),
      scorms: new ScormFetcher({ session, profile, tracer, messages, html, locator }),
    });

    const catalog = new CatalogService({
      platform,
      store: new CompressedStore({ redactor: input.redactor }),
      locale: input.locale,
      tracer,
    });
    const pipeline = (pipelineLogger: Logger): SlidesToPdf =>
      new SlidesToPdf({
        messages,
        logger: pipelineLogger,
        parser: new SlideListParser({ maxSlides: SETTINGS.maxSlides, messages }),
        downloader: new SlideDownloader({
          session,
          logger: pipelineLogger,
          delay: new TimerDelay(),
          messages,
          settings: {
            concurrency: global.concurrency,
            maxImageBytes: SETTINGS.maxImageBytes,
            retries: SETTINGS.retries,
            backoffMs: SETTINGS.backoffMs,
          },
        }),
        pdfBuilder: new PdfBuilder({
          pageWidth: SETTINGS.pageWidth,
          pageHeight: SETTINGS.pageHeight,
          inspector: new JpegInspector({ messages }),
          messages,
        }),
      });
    const sink = new NodeFileSink({ messages });
    const namer = new FileNamer({ fallbackName: messages.common.defaultFileName(), maxNameBytes: SETTINGS.maxNameBytes });

    return {
      logger,
      platform,
      catalog,
      resolver: new CourseResolver({ catalog, messages }),
      namer,
      batch: new BatchDownloader({
        // Dentro de un lote el progreso de cada SCORM sería ruido: solo pasan sus avisos.
        items: new ItemDownloader({ platform, slides: pipeline(new QuietLogger({ inner: logger })), namer, sink, tracer }),
        planner: new NamePlanner({ namer }),
        logger,
        tracer,
        settings: { concurrency: Math.min(SETTINGS.itemConcurrency, global.concurrency) },
      }),
      printer: new ReportPrinter({ logger, messages }),
      convert: new ConvertScormToPdf({
        locator: new ScormLocator({
          session,
          logger,
          messages,
          maxRevision: SETTINGS.maxRevision,
          probeBatchSize: SETTINGS.probeBatchSize,
        }),
        slides: pipeline(logger),
        namer: new OutputNamer({ maxStemLength: SETTINGS.maxFileNameStem }),
        sink,
        logger,
        messages,
      }),
    };
  }
}
