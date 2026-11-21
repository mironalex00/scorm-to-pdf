export type ItemKind = "resource" | "scorm";

export interface CourseSummary {
  readonly id: string;
  readonly name: string;
}

/** A section title and its numeric index in the course. */
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

/** A direct file or the entry document for a SCORM slide deck. */
export type FetchedItem =
  | { readonly kind: "file"; readonly bytes: Uint8Array; readonly fileName: string; readonly contentType: string }
  | { readonly kind: "slides"; readonly entryUrl: URL; readonly html: string };
