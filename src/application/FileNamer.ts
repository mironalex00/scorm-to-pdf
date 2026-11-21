import { join } from "node:path";
import type { CourseItem } from "../domain/catalog.ts";

const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "application/zip": ".zip",
};

/** Normalizes file and directory names while preserving accents. */
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

  directoryNames<Key>(entries: Iterable<readonly [Key, string]>, reserveExtensions = false): Map<Key, string> {
    const names = new Map<Key, string>();
    const used = new Set<string>();
    const stems = new Set<string>();
    const nextSuffix = new Map<string, number>();
    const collides = (value: string) => {
      const lower = value.toLowerCase();
      return used.has(lower) || (reserveExtensions && (stems.has(lower) || used.has(lower.replace(FILE_EXTENSION, ""))));
    };
    for (const [key, title] of entries) {
      const base = this.baseName(title);
      const baseKey = base.toLowerCase();
      let folder = base;
      let suffix = nextSuffix.get(baseKey) ?? 2;
      while (collides(folder)) {
        folder = `${base} (${suffix})`;
        suffix += 1;
      }
      nextSuffix.set(baseKey, suffix);
      names.set(key, folder);
      const lower = folder.toLowerCase();
      used.add(lower);
      if (reserveExtensions) stems.add(lower.replace(FILE_EXTENSION, ""));
    }
    return names;
  }

  itemPath(destRoot: string, item: CourseItem, fileName: string, sectionFolder?: string, itemFolder = ""): string {
    return join(destRoot, sectionFolder ?? this.sectionDir(item.sectionNumber), itemFolder, fileName);
  }

  private extensionFor(sourceFileName: string, contentType: string | undefined): string {
    const fromSource = FILE_EXTENSION.exec(sourceFileName)?.[0];
    if (fromSource) return fromSource;
    const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
    return Object.hasOwn(EXTENSION_BY_TYPE, type) ? EXTENSION_BY_TYPE[type]! : "";
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
