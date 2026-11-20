/** Interfaces for I/O and platform adapters. */

export interface HttpRequest {
  readonly method?: "GET" | "POST";
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  /** Maximum accepted response size in bytes. */
  readonly maxBytes: number;
  /** Request body for POST. */
  readonly body?: string;
  /** Cancels the request and response read. */
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly status: number;
  /** Redirect target returned by the server. */
  readonly location: string | undefined;
  readonly contentType: string;
  /** Original file metadata from the Content-Disposition header. */
  readonly contentDisposition: string | undefined;
  readonly body: Uint8Array;
}

export interface HttpClient {
  get(request: HttpRequest): Promise<HttpResponse>;
}

export interface FileSink {
  /** Writes the file and returns its absolute path. */
  write(path: string, content: Uint8Array): Promise<string>;
  /** Publish the file only if the destination is free. */
  writeIfAbsent(path: string, content: Uint8Array): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
}

export interface ProgressUpdate {
  readonly done: number;
  readonly total: number;
  readonly label: string;
}

export interface Logger {
  /** Human-readable information suppressed by --quiet. */
  info(message: string): void;
  /** Command output printed even in quiet mode. */
  result(message: string): void;
  warn(message: string): void;
  progress(update: ProgressUpdate): void;
}

export interface Delay {
  wait(milliseconds: number): Promise<void>;
}

/** Lists courses and resolves their materials for download. */
export interface LearningPlatform {
  readonly id: string;
  listCourses(): Promise<import("../domain/catalog.ts").CourseSummary[]>;
  loadContents(course: import("../domain/catalog.ts").CourseSummary): Promise<import("../domain/catalog.ts").CourseContents>;
  fetchItem(item: import("../domain/catalog.ts").CourseItem): Promise<import("../domain/catalog.ts").FetchedItem>;
}
