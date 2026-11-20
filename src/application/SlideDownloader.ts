import { AuthenticationError, DownloadError, errorMessage } from "../domain/errors.ts";
import type { Delay, Logger } from "./ports.ts";
import type { MoodleSession } from "./MoodleSession.ts";
import type { Slide } from "./SlideListParser.ts";
import type { Messages } from "../i18n/Messages.ts";

export interface DownloadSettings {
  readonly concurrency: number;
  readonly maxImageBytes: number;
  readonly maxDeckBytes?: number;
  readonly retries: number;
  readonly backoffMs: number;
}

interface SlideTask {
  readonly slide: Slide;
  readonly position: number;
  readonly entryUrl: URL;
}

interface PoolState {
  next: number;
  done: number;
  bytes: number;
  failure: unknown;
}

/** Downloads slides concurrently and preserves their order. Retries transient failures. */
export class SlideDownloader {
  private readonly session: MoodleSession;
  private readonly logger: Logger;
  private readonly delay: Delay;
  private readonly settings: DownloadSettings;
  private readonly messages: Messages;

  constructor(deps: {
    session: MoodleSession;
    logger: Logger;
    delay: Delay;
    settings: DownloadSettings;
    messages: Messages;
  }) {
    this.messages = deps.messages;
    this.session = deps.session;
    this.logger = deps.logger;
    this.delay = deps.delay;
    this.settings = deps.settings;
  }

  async download(slides: readonly Slide[], entryUrl: URL): Promise<Uint8Array[]> {
    const images = new Array<Uint8Array>(slides.length);
    const state: PoolState = { next: 0, done: 0, bytes: 0, failure: undefined };
    const workers = Math.min(this.settings.concurrency, slides.length);

    await Promise.all(Array.from({ length: workers }, () => this.runWorker(slides, entryUrl, images, state)));

    if (state.failure !== undefined) throw state.failure;
    return images;
  }

  private async runWorker(
    slides: readonly Slide[],
    entryUrl: URL,
    images: Uint8Array[],
    state: PoolState,
  ): Promise<void> {
    while (state.failure === undefined && state.next < slides.length) {
      const index = state.next;
      state.next += 1;
      const task: SlideTask = { slide: slides[index]!, position: index + 1, entryUrl };
      try {
        const image = await this.fetchWithRetries(task, 0);
        if (state.failure !== undefined) return;
        state.bytes += image.length;
        const limit = this.settings.maxDeckBytes;
        if (limit !== undefined && state.bytes > limit) {
          throw new DownloadError(this.messages.downloader.deckTooLarge({ max: String(limit) }));
        }
        images[index] = image;
        state.done += 1;
        this.logger.progress({ done: state.done, total: slides.length, label: this.labelOf(task) });
      } catch (error) {
        state.failure ??= error;
      }
    }
  }

  private async fetchWithRetries(task: SlideTask, attempt: number): Promise<Uint8Array> {
    try {
      return await this.fetchOnce(task);
    } catch (error) {
      if (error instanceof DownloadError && error.retryable && attempt < this.settings.retries) {
        this.logger.warn(
          this.messages.downloader.retrying({
            label: this.labelOf(task),
            attempt: String(attempt + 1),
            retries: String(this.settings.retries),
            reason: error.message,
          }),
        );
        await this.delay.wait(this.settings.backoffMs * 2 ** attempt);
        return this.fetchWithRetries(task, attempt + 1);
      }
      throw this.describe(error, task);
    }
  }

  private async fetchOnce(task: SlideTask): Promise<Uint8Array> {
    const url = this.resolve(task);
    const { bytes, contentType } = await this.session.getBytes(url, this.settings.maxImageBytes);

    if (contentType !== "" && !contentType.toLowerCase().includes("image/")) {
      throw new DownloadError(this.messages.downloader.unexpectedContentType({ contentType }));
    }
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new DownloadError(this.messages.downloader.notJpeg());
    }
    return bytes;
  }

  private resolve(task: SlideTask): URL {
    try {
      return new URL(task.slide.src, task.entryUrl);
    } catch (error) {
      throw new DownloadError(this.messages.downloader.invalidSrc({ src: task.slide.src }), { cause: error });
    }
  }

  private describe(error: unknown, task: SlideTask): unknown {
    if (error instanceof AuthenticationError) return error;
    const title = task.slide.title === "" ? "" : ` (${task.slide.title})`;
    const detail = errorMessage(error);
    return new DownloadError(
      this.messages.downloader.slideFailed({ position: String(task.position), title, detail }),
      { cause: error },
    );
  }

  private labelOf(task: SlideTask): string {
    return task.slide.title === ""
      ? this.messages.downloader.slideLabel({ position: String(task.position) })
      : task.slide.title;
  }
}
