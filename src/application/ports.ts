/** Puertos de salida: lo único que la aplicación necesita del mundo exterior. */

export interface HttpRequest {
  readonly method?: "GET" | "POST";
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  /** Máximo de bytes de cuerpo que se aceptan; si se supera, la petición falla. */
  readonly maxBytes: number;
  /** Cuerpo de la petición (solo POST). */
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  /** Valor de la cabecera Location en las redirecciones; el cliente nunca las sigue. */
  readonly location: string | undefined;
  readonly contentType: string;
  /** Valor de Content-Disposition, que suele traer el nombre real del archivo. */
  readonly contentDisposition: string | undefined;
  readonly body: Uint8Array;
}

export interface HttpClient {
  get(request: HttpRequest): Promise<HttpResponse>;
}

export interface FileSink {
  /** Escribe el contenido y devuelve la ruta absoluta final. */
  write(path: string, content: Uint8Array): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface ProgressUpdate {
  readonly done: number;
  readonly total: number;
  readonly label: string;
}

export interface Logger {
  /** Información para personas; se silencia con --quiet. */
  info(message: string): void;
  /** Lo que el programa produce (la ruta del PDF): se imprime siempre, apto para scripts. */
  result(message: string): void;
  warn(message: string): void;
  progress(update: ProgressUpdate): void;
}

export interface Delay {
  wait(milliseconds: number): Promise<void>;
}

/** Una plataforma educativa: lista cursos, su contenido y resuelve un ítem a algo descargable. */
export interface LearningPlatform {
  readonly id: string;
  listCourses(): Promise<import("../domain/catalog.ts").CourseSummary[]>;
  loadContents(course: import("../domain/catalog.ts").CourseSummary): Promise<import("../domain/catalog.ts").CourseContents>;
  fetchItem(item: import("../domain/catalog.ts").CourseItem): Promise<import("../domain/catalog.ts").FetchedItem>;
}
