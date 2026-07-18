import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const nodeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const applicationNames = new Set([
  "mission-control",
  "workshop",
  "verification",
]);
const forbiddenFrameworkImports = [
  "fastify",
  "pg",
  "amqplib",
  "@opentelemetry/",
  "openai",
  "@anthropic-ai/",
  "@google/generative-ai",
];

function isForbiddenFrameworkImport(specifier: string): boolean {
  return forbiddenFrameworkImports.some(
    (name) => specifier === name || specifier.startsWith(name),
  );
}

/** @param {string} specifier @param {string} importer */
function targetArea(
  specifier: string,
  importer: string,
): [string, string] | undefined {
  if (specifier.startsWith("@patchquest/")) {
    const name = specifier.slice("@patchquest/".length).split("/")[0];
    if (name === undefined) return undefined;
    return applicationNames.has(name) ? ["apps", name] : ["packages", name];
  }
  if (!specifier.startsWith(".")) return undefined;
  const absolute = path.resolve(nodeRoot, path.dirname(importer), specifier);
  const [area, name] = path.relative(nodeRoot, absolute).split(path.sep);
  return area !== undefined && name !== undefined ? [area, name] : undefined;
}

/** @param {string} source @param {string} importer */
export function findArchitectureViolations(
  source: string,
  importer: string,
): string[] {
  const violations: string[] = [];
  const [importerArea, importerName] = importer.split(/[\\/]/);
  const sourceFile = ts.createSourceFile(
    importer,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  /** @param {import("typescript").Node} node */
  function visit(node: ts.Node): void {
    let expression: ts.StringLiteral | undefined;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      expression = node.moduleSpecifier;
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      expression = node.arguments[0];
    }
    if (expression) {
      const importerParts = importer.split(/[\\/]/);
      const importerLayer =
        importerParts[2] === "src" ? importerParts[3] : undefined;
      if (
        importerArea === "apps" &&
        importerLayer !== undefined &&
        ["domain", "application"].includes(importerLayer) &&
        isForbiddenFrameworkImport(expression.text)
      ) {
        violations.push(
          `${importer}: ${importerLayer} may not import framework, infrastructure, telemetry, or provider module ${expression.text}`,
        );
      }
      const target = targetArea(expression.text, importer);
      if (target) {
        const [targetAreaName, targetName] = target;
        if (targetAreaName === "apps" && targetName !== importerName) {
          violations.push(
            `${importer}: ${importerArea === "apps" ? "applications" : "shared packages"} may not import application ${targetName}`,
          );
        }
        if (
          expression.text.startsWith(".") &&
          importerArea === "apps" &&
          targetAreaName === "apps" &&
          targetName === importerName &&
          importerLayer !== undefined &&
          ["domain", "application"].includes(importerLayer)
        ) {
          const absolute = path.resolve(
            nodeRoot,
            path.dirname(importer),
            expression.text,
          );
          const targetParts = path.relative(nodeRoot, absolute).split(path.sep);
          const targetLayer =
            targetParts[2] === "src" ? targetParts[3] : undefined;
          const allowedLayers =
            importerLayer === "domain"
              ? new Set(["domain"])
              : new Set(["domain", "application"]);
          if (!targetLayer || !allowedLayers.has(targetLayer))
            violations.push(
              `${importer}: ${importerLayer} may not import outward layer ${targetLayer ?? "outside-src"}`,
            );
        }
        if (
          importerArea === "packages" &&
          importerName === "contracts" &&
          !(targetAreaName === "packages" && targetName === "contracts")
        ) {
          violations.push(
            `${importer}: contracts is the innermost package and cannot import ${expression.text}`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...new Set(violations)];
}

/** @param {string} directory */
async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["dist", "node_modules", "coverage"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (/\.[cm]?tsx?$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

export async function verifyArchitecture(): Promise<number> {
  const files = [
    ...(await walk(path.join(nodeRoot, "apps"))),
    ...(await walk(path.join(nodeRoot, "packages"))),
  ];
  const violations: string[] = [];
  for (const file of files) {
    const relative = path.relative(nodeRoot, file);
    violations.push(
      ...findArchitectureViolations(await readFile(file, "utf8"), relative),
    );
  }
  if (violations.length > 0) throw new Error(violations.join("\n"));
  return files.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = await verifyArchitecture();
  console.log(
    `architecture: ${count} TypeScript source files respect dependency boundaries`,
  );
}
