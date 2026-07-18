import { existsSync, realpathSync, statSync } from "node:fs";
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
const proxyDetectionBridgeImporters = new Set([
  "apps/mission-control/src/domain/proxy-detection.ts",
  "apps/workshop/src/domain/proxy-detection.ts",
  "apps/verification/src/domain/proxy-detection.ts",
]);

export function normalizeImporterPath(importer: string): string {
  return path.posix.normalize(importer.replaceAll("\\", "/"));
}

function isAllowedProductionSpecifier(
  specifier: string,
  importer: string,
): boolean {
  return (
    specifier.startsWith(".") ||
    specifier === "@patchquest/contracts" ||
    specifier === "node:crypto" ||
    (specifier === "node:util/types" &&
      proxyDetectionBridgeImporters.has(importer))
  );
}

function isExactProxyDetectionImport(node: ts.Node): boolean {
  if (
    !ts.isImportDeclaration(node) ||
    !ts.isStringLiteral(node.moduleSpecifier) ||
    node.moduleSpecifier.text !== "node:util/types"
  )
    return false;
  const clause = node.importClause;
  if (
    !clause ||
    clause.isTypeOnly ||
    clause.name ||
    node.attributes ||
    !clause.namedBindings ||
    !ts.isNamedImports(clause.namedBindings) ||
    clause.namedBindings.elements.length !== 1
  )
    return false;
  const imported = clause.namedBindings.elements[0];
  return Boolean(
    imported &&
    !imported.isTypeOnly &&
    !imported.propertyName &&
    imported.name.text === "isProxy",
  );
}

function hasOnlyExportModifier(node: ts.FunctionDeclaration): boolean {
  const modifiers = ts.getModifiers(node) ?? [];
  return (
    modifiers.length === 1 && modifiers[0]?.kind === ts.SyntaxKind.ExportKeyword
  );
}

function isExactProxyPredicate(node: ts.Node): boolean {
  if (
    !ts.isFunctionDeclaration(node) ||
    !hasOnlyExportModifier(node) ||
    node.name?.text !== "isRuntimeProxy" ||
    node.asteriskToken ||
    node.questionToken ||
    node.typeParameters ||
    node.parameters.length !== 1 ||
    node.type?.kind !== ts.SyntaxKind.BooleanKeyword ||
    !node.body ||
    node.body.statements.length !== 1
  )
    return false;
  const parameter = node.parameters[0];
  if (
    !parameter ||
    (ts.getModifiers(parameter)?.length ?? 0) !== 0 ||
    !ts.isIdentifier(parameter.name) ||
    parameter.name.text !== "value" ||
    parameter.dotDotDotToken ||
    parameter.questionToken ||
    parameter.initializer ||
    parameter.type?.kind !== ts.SyntaxKind.ObjectKeyword
  )
    return false;
  const statement = node.body.statements[0];
  if (!statement || !ts.isReturnStatement(statement) || !statement.expression)
    return false;
  const expression = statement.expression;
  return (
    ts.isCallExpression(expression) &&
    !expression.questionDotToken &&
    !expression.typeArguments &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "isProxy" &&
    expression.arguments.length === 1 &&
    expression.arguments[0] !== undefined &&
    ts.isIdentifier(expression.arguments[0]) &&
    expression.arguments[0].text === "value"
  );
}

function isExactProxyDetectionBridge(sourceFile: ts.SourceFile): boolean {
  return (
    sourceFile.statements.length === 2 &&
    sourceFile.statements[0] !== undefined &&
    isExactProxyDetectionImport(sourceFile.statements[0]) &&
    sourceFile.statements[1] !== undefined &&
    isExactProxyPredicate(sourceFile.statements[1])
  );
}

const forbiddenRuntimeGlobals = new Set([
  "globalThis",
  "global",
  "process",
  "fetch",
  "WebSocket",
  "EventSource",
  "eval",
  "Function",
  "WebAssembly",
  "module",
]);

function isPropertyNameOnly(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node)
  );
}

const sourceExtensionCandidates: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/** @param {string} candidate */
function existingSourceFile(candidate: string): string | undefined {
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined;
  return realpathSync(candidate);
}

/** @param {string} specifier @param {string} importer */
function resolveRelativeTarget(specifier: string, importer: string): string {
  const raw = path.resolve(nodeRoot, path.dirname(importer), specifier);
  const extension = path.extname(raw);
  const candidates: string[] = [];
  if (extension) {
    candidates.push(raw);
    for (const replacement of sourceExtensionCandidates[extension] ?? [])
      candidates.push(`${raw.slice(0, -extension.length)}${replacement}`);
  } else {
    candidates.push(raw);
    for (const sourceExtension of [".ts", ".tsx", ".mts", ".cts"])
      candidates.push(`${raw}${sourceExtension}`);
    for (const sourceExtension of [".ts", ".tsx", ".mts", ".cts"])
      candidates.push(path.join(raw, `index${sourceExtension}`));
  }
  return candidates.map(existingSourceFile).find(Boolean) ?? raw;
}

interface TargetArea {
  readonly area: string;
  readonly name: string;
  readonly relativePath?: string;
}

/** @param {string} specifier @param {string} importer */
function targetArea(
  specifier: string,
  importer: string,
): TargetArea | undefined {
  if (specifier.startsWith("@patchquest/")) {
    const name = specifier.slice("@patchquest/".length).split("/")[0];
    if (name === undefined) return undefined;
    return applicationNames.has(name)
      ? { area: "apps", name }
      : { area: "packages", name };
  }
  if (!specifier.startsWith(".")) return undefined;
  const absolute = resolveRelativeTarget(specifier, importer);
  const relativePath = path.relative(nodeRoot, absolute);
  const [area, name] = relativePath.split(path.sep);
  return area !== undefined && name !== undefined
    ? { area, name, relativePath }
    : undefined;
}

/** @param {string} source @param {string} importer */
export function findArchitectureViolations(
  source: string,
  importer: string,
): string[] {
  importer = normalizeImporterPath(importer);
  const violations: string[] = [];
  const [importerArea, importerName] = importer.split(/[\\/]/);
  const importerParts = importer.split(/[\\/]/);
  const importerLayer =
    importerParts[2] === "src" ? importerParts[3] : undefined;
  const isProductionCore =
    importerArea === "apps" &&
    importerLayer !== undefined &&
    ["domain", "application"].includes(importerLayer);
  const sourceFile = ts.createSourceFile(
    importer,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const isProxyDetectionBridge = proxyDetectionBridgeImporters.has(importer);
  const hasExactProxyDetectionBridge =
    isProxyDetectionBridge && isExactProxyDetectionBridge(sourceFile);
  if (isProxyDetectionBridge && !hasExactProxyDetectionBridge)
    violations.push(
      `${importer}: proxy-detection bridge must contain only the exact node:util/types import and exported isRuntimeProxy predicate`,
    );
  const scopeBindings = new Map<ts.Node, Set<string>>();
  const addBinding = (
    scope: ts.Node | undefined,
    name: ts.BindingName,
  ): void => {
    if (!scope) return;
    const bindings = scopeBindings.get(scope) ?? new Set<string>();
    scopeBindings.set(scope, bindings);
    if (ts.isIdentifier(name)) bindings.add(name.text);
    else
      for (const element of name.elements)
        if (!ts.isOmittedExpression(element)) addBinding(scope, element.name);
  };
  const collectBindings = (
    node: ts.Node,
    parentScope: ts.Node | undefined,
  ): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    )
      addBinding(parentScope, node.name);
    let scope = parentScope;
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node)) {
      scope = node;
      if (!scopeBindings.has(scope)) scopeBindings.set(scope, new Set());
    }
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node)
    )
      addBinding(scope, node.name);
    else if (ts.isImportClause(node) && node.name) addBinding(scope, node.name);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node))
      addBinding(scope, node.name);
    ts.forEachChild(node, (child) => collectBindings(child, scope));
  };
  collectBindings(sourceFile, undefined);
  const isLocallyBound = (node: ts.Identifier): boolean => {
    for (
      let current: ts.Node | undefined = node.parent;
      current;
      current = current.parent
    ) {
      if (scopeBindings.get(current)?.has(node.text)) return true;
    }
    return false;
  };
  /** @param {import("typescript").Node} node */
  function visit(node: ts.Node): void {
    if (importerArea === "packages" && importerName === "contracts") {
      if (
        ts.isClassDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isEnumDeclaration(node)
      ) {
        violations.push(
          `${importer}: contracts may contain transport DTO types only, not runtime classes, functions, or enums`,
        );
      }
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        [
          "Mission",
          "Attempt",
          "VerificationRun",
          "CompletionReview",
          "MissionCompletionProcess",
          "MissionSnapshot",
        ].includes(node.name.text)
      ) {
        violations.push(
          `${importer}: contracts may not export aggregate or persistence model ${node.name.text}`,
        );
      }
    }
    if (isProductionCore && ts.isImportEqualsDeclaration(node)) {
      violations.push(
        `${importer}: ${importerLayer} may not use TypeScript import-equals or require aliases`,
      );
    }
    if (
      isProductionCore &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      violations.push(
        `${importer}: ${importerLayer} may not use CommonJS require`,
      );
    }
    if (
      isProductionCore &&
      ts.isIdentifier(node) &&
      node.text === "require" &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      violations.push(
        `${importer}: ${importerLayer} may not reference require indirectly`,
      );
    }
    if (
      isProductionCore &&
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      (node.arguments.length !== 1 ||
        node.arguments[0] === undefined ||
        !ts.isStringLiteral(node.arguments[0]))
    ) {
      violations.push(
        `${importer}: ${importerLayer} may not use a non-literal dynamic import`,
      );
    }
    if (
      isProductionCore &&
      ts.isIdentifier(node) &&
      forbiddenRuntimeGlobals.has(node.text) &&
      !isPropertyNameOnly(node) &&
      !isLocallyBound(node)
    ) {
      violations.push(
        `${importer}: ${importerLayer} may not reference forbidden runtime global ${node.text}`,
      );
    }
    let expression: ts.StringLiteral | undefined;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      expression = node.moduleSpecifier;
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      expression = node.moduleReference.expression;
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (!isProductionCore &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      expression = node.arguments[0];
    }
    if (expression) {
      const allowedProductionSpecifier =
        !isProductionCore ||
        isAllowedProductionSpecifier(expression.text, importer);
      if (!allowedProductionSpecifier) {
        violations.push(
          `${importer}: ${importerLayer} may import only bounded-context relative modules, @patchquest/contracts, node:crypto, or the exact proxy-detection bridge dependency; received ${expression.text}`,
        );
      }
      if (
        expression.text === "node:util/types" &&
        !(hasExactProxyDetectionBridge && node === sourceFile.statements[0])
      )
        violations.push(
          `${importer}: node:util/types is restricted to the exact bounded-context proxy-detection bridge program`,
        );
      const target = targetArea(expression.text, importer);
      if (target && allowedProductionSpecifier) {
        const {
          area: targetAreaName,
          name: targetName,
          relativePath: targetRelativePath,
        } = target;
        if (
          targetAreaName === "apps" &&
          targetName !== importerName &&
          !(isProductionCore && expression.text.startsWith("."))
        ) {
          violations.push(
            `${importer}: ${importerArea === "apps" ? "applications" : "shared packages"} may not import application ${targetName}`,
          );
        }
        if (
          expression.text.startsWith(".") &&
          isProductionCore &&
          importerLayer !== undefined
        ) {
          const targetParts = (targetRelativePath ?? "").split(path.sep);
          const targetLayer =
            targetParts[2] === "src" ? targetParts[3] : undefined;
          const allowedLayers =
            importerLayer === "domain"
              ? new Set(["domain"])
              : new Set(["domain", "application"]);
          if (
            targetAreaName !== "apps" ||
            targetName !== importerName ||
            !targetLayer ||
            !allowedLayers.has(targetLayer)
          )
            violations.push(
              `${importer}: ${importerLayer} relative import must resolve inside apps/${importerName}/src/${[...allowedLayers].join(" or ")}; received ${targetRelativePath ?? expression.text}`,
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
    const relative = normalizeImporterPath(path.relative(nodeRoot, file));
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
