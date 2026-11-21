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

/** Built-in limits and defaults for service construction. */
export const SETTINGS = {
  requestTimeoutMs: 30_000,
  maxRevision: 30,
  probeBatchSize: 6,
  maxSlides: 500,
  maxImageBytes: 25 * MIB,
  maxDeckBytes: 128 * MIB,
  catalogCacheBytes: 8 * MIB,
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

/** Builds a fresh set of services for each command. */
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
    signal?: AbortSignal;
    /** The interactive selector supplies a logger that does not write to stdout. */
    logger?: Logger | undefined;
  }): Services {
    const { messages, tracer, global, resolved, signal } = input;
    const http = this.http ?? new FetchHttpClient({ timeoutMs: SETTINGS.requestTimeoutMs, messages });
    const logger = input.logger ?? new ConsoleLogger({ stdout: this.stdout, stderr: this.stderr, quiet: global.quiet, messages });
    const session = new MoodleSession({ http, cookie: input.cookie, baseUrl: resolved.baseUrl, messages, tracer, signal });

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
      store: new CompressedStore({ redactor: input.redactor, maxBytes: SETTINGS.catalogCacheBytes }),
      locale: input.locale,
      tracer,
    });
    const batchConcurrency = Math.min(SETTINGS.itemConcurrency, global.concurrency);
    const pipeline = (pipelineLogger: Logger, concurrency: number): SlidesToPdf =>
      new SlidesToPdf({
        messages,
        logger: pipelineLogger,
        parser: new SlideListParser({ maxSlides: SETTINGS.maxSlides, messages }),
        downloader: new SlideDownloader({
          session,
          logger: pipelineLogger,
          delay: new TimerDelay(signal),
          messages,
          settings: {
            concurrency,
            maxImageBytes: SETTINGS.maxImageBytes,
            maxDeckBytes: SETTINGS.maxDeckBytes,
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
    const sink = new NodeFileSink({ messages, signal });
    const namer = new FileNamer({ fallbackName: messages.common.defaultFileName(), maxNameBytes: SETTINGS.maxNameBytes });

    return {
      logger,
      platform,
      catalog,
      resolver: new CourseResolver({ catalog, messages }),
      namer,
      batch: new BatchDownloader({
        // The batch reports progress by material. Nested converters only forward warnings.
        items: new ItemDownloader({
          platform,
          slides: pipeline(new QuietLogger({ inner: logger }), Math.floor(global.concurrency / batchConcurrency)),
          namer,
          sink,
          tracer,
        }),
        planner: new NamePlanner({ namer }),
        logger,
        tracer,
        settings: { concurrency: batchConcurrency },
        signal,
      }),
      printer: new ReportPrinter({ logger, messages }),
      convert: new ConvertScormToPdf({
        locator: new ScormLocator({
          session,
          logger,
          messages,
          maxRevision: SETTINGS.maxRevision,
          probeBatchSize: Math.min(SETTINGS.probeBatchSize, global.concurrency),
        }),
        slides: pipeline(logger, global.concurrency),
        namer: new OutputNamer({ maxStemLength: SETTINGS.maxFileNameStem }),
        sink,
        logger,
        messages,
      }),
    };
  }
}
