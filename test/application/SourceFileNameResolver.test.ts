import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SourceFileNameResolver } from "../../src/application/SourceFileNameResolver.ts";

const resolver = new SourceFileNameResolver();
const url = (path: string) => new URL(`https://h.example/pluginfile.php/55/mod_resource/content/1/${path}`);

describe("SourceFileNameResolver", () => {
  const cases: Array<[string, string, string | undefined, string]> = [
    ["accepts a quoted filename parameter", "x.pdf", 'attachment; filename="Curs 5.pdf"', "Curs 5.pdf"],
    ["accepts an unquoted filename parameter", "x.pdf", "inline; filename=plain.pdf", "plain.pdf"],
    ["prefers the UTF-8 filename* parameter", "x.pdf", `attachment; filename="a.pdf"; filename*=UTF-8''Exerci%C8%9Bii.pdf`, "Exerciții.pdf"],
    ["uses the final path component of the suggested name", "x.pdf", 'attachment; filename="../../etc/x.pdf"', "x.pdf"],
    ["decodes the final URL segment when the header is missing", "Curs%201.pdf", undefined, "Curs 1.pdf"],
    ["uses the URL when the header has no filename", "a.pdf", "inline", "a.pdf"],
    ["ignores the URL query", "a.pdf?forcedownload=1", undefined, "a.pdf"],
    ["keeps malformed percent encoding unchanged", "a%E0%A4%A.pdf", undefined, "a%E0%A4%A.pdf"],
    ["falls back to filename when filename* is malformed", "x.pdf", `attachment; filename*=UTF-8''%E0%A4%A; filename="ok.pdf"`, "ok.pdf"],
    ["returns an empty name when the response provides none", "", undefined, ""],
  ];
  for (const [name, path, header, expected] of cases) {
    it(name, () => assert.equal(resolver.resolve({ url: url(path), contentDisposition: header }), expected));
  }
});
