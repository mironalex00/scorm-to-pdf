import { join } from "node:path";
import type { CourseItem } from "../domain/catalog.ts";

const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "application/zip": ".zip",
};

/** Nombres de archivo seguros en macOS, Linux y Windows, conservando acentos y legibilidad. */
export class FileNamer {
  private readonly fallbackName: string;
  private readonly maxNameBytes: number;

  constructor(deps: { fallbackName: string; maxNameBytes: number }) {
    this.fallbackName = deps.fallbackName;
    this.maxNameBytes = deps.maxNameBytes;
  }

  baseName(raw: string): string {
    const cleaned = raw
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .trim();
    const name = this.truncate(cleaned).replace(/[. ]+$/, "");
    if (name === "") return this.fallbackName;

    const stem = name.split(".")[0]!;
    return RESERVED_WINDOWS_NAME.test(stem) ? `${stem}_${name.slice(stem.length)}` : name;
  }

  fileName(input: {
    baseName: string;
    sourceFileName: string;
    contentType: string | undefined;
    forcedExtension?: string;
  }): string {
    const extension = input.forcedExtension ?? this.extensionFor(input.sourceFileName, input.contentType);
    const alreadyThere = extension !== "" && input.baseName.toLowerCase().endsWith(extension.toLowerCase());
    return alreadyThere ? input.baseName : `${input.baseName}${extension}`;
  }

  sectionDir(sectionNumber: number): string {
    return String(sectionNumber);
  }

  itemPath(destRoot: string, item: CourseItem, fileName: string): string {
    return join(destRoot, this.sectionDir(item.sectionNumber), fileName);
  }

  private extensionFor(sourceFileName: string, contentType: string | undefined): string {
    const fromSource = /\.[A-Za-z0-9]{1,8}$/.exec(sourceFileName)?.[0];
    if (fromSource) return fromSource;
    const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
    return EXTENSION_BY_TYPE[type] ?? "";
  }

  private truncate(name: string): string {
    let bytes = 0;
    let result = "";
    for (const character of name) {
      bytes += Buffer.byteLength(character);
      if (bytes > this.maxNameBytes) break;
      result += character;
    }
    return result;
  }
}
