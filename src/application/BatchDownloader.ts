import { AuthenticationError } from "../domain/errors.ts";
import type { CourseItem, Section } from "../domain/catalog.ts";
import type { Tracer } from "../tracing/Tracer.ts";
import type { DownloadTarget, ItemOutcome, ItemTransfer } from "./ItemDownloader.ts";
import type { NamePlanner } from "./NamePlanner.ts";
import type { Logger } from "./ports.ts";

export interface BatchReport {
  readonly outcomes: ItemOutcome[];
  readonly downloaded: number;
  readonly skipped: number;
  readonly failed: number;
  /** True when an expired session stops the batch. */
  readonly aborted: boolean;
}

interface PoolState {
  next: number;
  done: number;
  aborted: boolean;
}

/** Downloads items with bounded concurrency. An authentication failure stops new work. */
export class BatchDownloader {
  private readonly items: ItemTransfer;
  private readonly planner: NamePlanner;
  private readonly logger: Logger;
  private readonly tracer: Tracer;
  private readonly concurrency: number;
  private readonly signal: AbortSignal | undefined;

  constructor(deps: {
    items: ItemTransfer;
    planner: NamePlanner;
    logger: Logger;
    tracer: Tracer;
    settings: { concurrency: number };
    signal?: AbortSignal | undefined;
  }) {
    this.items = deps.items;
    this.planner = deps.planner;
    this.logger = deps.logger;
    this.tracer = deps.tracer;
    this.concurrency = deps.settings.concurrency;
    this.signal = deps.signal;
  }

  async run(
    items: readonly CourseItem[], destRoot: string, sections: readonly Section[] = [],
    naming?: { allItems: readonly CourseItem[]; groupByItem?: boolean },
  ): Promise<BatchReport> {
    this.tracer.event("info", "download", "batch.start", { total: items.length, concurrency: this.concurrency });
    const groupByItem = naming?.groupByItem ?? naming !== undefined;
    const plan = this.planner.plan(naming?.allItems ?? items, groupByItem);
    const folders = this.planner.sectionFolders(sections);
    const slots = new Array<ItemOutcome | undefined>(items.length);
    const state: PoolState = { next: 0, done: 0, aborted: false };
    const workers = Math.min(this.concurrency, items.length);

    await Promise.all(Array.from({ length: workers }, () => this.runWorker(items, plan, folders, destRoot, slots, state, groupByItem)));
    this.signal?.throwIfAborted();

    const outcomes = slots.filter((outcome): outcome is ItemOutcome => outcome !== undefined);
    const report: BatchReport = {
      outcomes,
      downloaded: outcomes.filter((outcome) => outcome.status === "downloaded").length,
      skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
      aborted: state.aborted,
    };
    this.tracer.event("info", "download", "batch.end", {
      downloaded: report.downloaded,
      skipped: report.skipped,
      failed: report.failed,
      aborted: report.aborted,
    });
    return report;
  }

  private async runWorker(
    items: readonly CourseItem[],
    plan: ReadonlyMap<string, string>,
    folders: ReadonlyMap<number, string>,
    destRoot: string,
    slots: Array<ItemOutcome | undefined>,
    state: PoolState,
    groupByItem: boolean,
  ): Promise<void> {
    while (!this.signal?.aborted && !state.aborted && state.next < items.length) {
      const index = state.next;
      state.next += 1;
      const item = items[index]!;
      const target = { destRoot, baseName: plan.get(item.id)!, sectionFolder: folders.get(item.sectionNumber), groupByItem };
      slots[index] = await this.attempt(item, target, state);
      state.done += 1;
      this.logger.progress({ done: state.done, total: items.length, label: item.name });
    }
  }

  private async attempt(
    item: CourseItem,
    target: DownloadTarget,
    state: PoolState,
  ): Promise<ItemOutcome> {
    try {
      return await this.items.download(item, target);
    } catch (error) {
      const authentication = error instanceof AuthenticationError;
      if (authentication) state.aborted = true;
      return { item, status: "failed", error, authentication };
    }
  }
}
