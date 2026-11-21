import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const metrics = [
  { label: "lines", hit: "LH", found: "LF" },
  { label: "branches", hit: "BRH", found: "BRF" },
  { label: "functions", hit: "FNH", found: "FNF" },
] as const;

interface Count {
  hit: number;
  found: number;
}

function executableSourceFiles(): string[] {
  return readdirSync(join(root, "src"), { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".ts") && !file.name.endsWith(".d.ts"))
    .map((file) => join(file.parentPath, file.name))
    .filter((path) => {
      const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
        fileName: path,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2023,
          removeComments: true,
          verbatimModuleSyntax: true,
        },
      });
      const output = outputText.trim();
      return output !== "" && output !== "export {};";
    });
}

function verifyCoverage(report: string): boolean {
  const totals: Count[] = metrics.map(() => ({ hit: 0, found: 0 }));
  const seen = new Set<string>();
  const incomplete: string[] = [];

  for (const record of report.split("end_of_record")) {
    const values = new Map(record.trim().split("\n").map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1).trim()] as const;
    }));
    const source = values.get("SF");
    if (source === undefined) continue;
    const path = resolve(root, source);
    seen.add(path);
    for (const [index, { label, hit, found }] of metrics.entries()) {
      const count = { hit: Number(values.get(hit)), found: Number(values.get(found)) };
      if (!Number.isSafeInteger(count.hit) || !Number.isSafeInteger(count.found)) {
        throw new Error(`Invalid LCOV totals for ${source} (${label}).`);
      }
      totals[index]!.hit += count.hit;
      totals[index]!.found += count.found;
      if (count.hit !== count.found) incomplete.push(`${relative(root, path)} ${label} ${count.hit}/${count.found}`);
    }
  }

  for (const path of executableSourceFiles()) {
    if (!seen.has(path)) incomplete.push(`Missing coverage for ${relative(root, path)}`);
  }
  for (const [index, { label }] of metrics.entries()) {
    const { hit, found } = totals[index]!;
    console.log(`Coverage ${label} ${hit}/${found}`);
  }
  if (incomplete.length > 0) console.error(incomplete.join("\n"));
  return incomplete.length === 0;
}

const temporary = mkdtempSync(join(tmpdir(), "scorm-coverage-"));
try {
  const destination = join(temporary, "coverage.lcov");
  const result = spawnSync(process.execPath, [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=src/**/*.ts",
    ...metrics.map(({ label }) => `--test-coverage-${label}=100`),
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${destination}`,
    "test/**/*.test.ts",
  ], {
    cwd: root,
    env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1", SCORM_ASCII_TEST: "1", SCORM_LANG: "en" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const complete = existsSync(destination) && verifyCoverage(readFileSync(destination, "utf8"));
  process.exitCode = result.status === 0 && complete ? 0 : 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
