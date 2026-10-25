export type ItemKind = "resource" | "scorm";

export interface CourseSummary {
  readonly id: string;
  readonly name: string;
}

/** Sección del curso tal como la nombra la plataforma; `number` es su índice, sin casos especiales. */
export interface Section {
  readonly number: number;
  readonly title: string;
}

export interface CourseItem {
  readonly id: string;
  readonly kind: ItemKind;
  readonly name: string;
  readonly url: string;
  readonly sectionNumber: number;
}

export interface CourseContents {
  readonly sections: readonly Section[];
  readonly items: readonly CourseItem[];
}

/** Lo que devuelve una plataforma al resolver un ítem: un archivo en crudo o un SCORM de diapositivas. */
export type FetchedItem =
  | { readonly kind: "file"; readonly bytes: Uint8Array; readonly fileName: string; readonly contentType: string }
  | { readonly kind: "slides"; readonly entryUrl: URL; readonly html: string };
