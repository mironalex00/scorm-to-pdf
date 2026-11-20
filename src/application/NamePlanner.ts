import type { CourseItem, Section } from "../domain/catalog.ts";
import type { FileNamer } from "./FileNamer.ts";

/**
 * Asigna de antemano un nombre base a cada ítem. Los duplicados de una misma sección se numeran
 * por orden de entrada, así el resultado no depende de qué descarga termine antes.
 */
export class NamePlanner {
  private readonly namer: FileNamer;

  constructor(deps: { namer: FileNamer }) {
    this.namer = deps.namer;
  }

  sectionFolders(sections: readonly Section[]): Map<number, string> {
    const ordered = [...sections].sort((a, b) => a.number - b.number);
    return this.namer.directoryNames(ordered.map(({ number, title }) => [number, title.trim() || String(number)]));
  }

  plan(items: readonly CourseItem[]): Map<string, string> {
    const sections = new Map<number, Array<readonly [string, string]>>();
    const plan = new Map<string, string>();
    for (const item of items) {
      const section = sections.get(item.sectionNumber) ?? [];
      section.push([item.id, item.name]);
      sections.set(item.sectionNumber, section);
    }
    for (const section of sections.values()) {
      for (const [id, name] of this.namer.directoryNames(section)) plan.set(id, name);
    }
    return plan;
  }
}
