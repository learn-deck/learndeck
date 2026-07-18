import { describe, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { CourseCatalog } from "../src/course";

type Metadata = Record<string, unknown>;

interface AssertionCounter {
  value: number;
}

const coursesDirectory = resolve(import.meta.dir, "..", "courses");

describe("course-pack contract", () => {
  test("validates every discovered course pack and its loaded sections", async () => {
    const courseDirectories = readdirSync(coursesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!courseDirectories.length) throw new Error(`No course directories found in ${coursesDirectory}.`);

    let catalog: CourseCatalog;
    try {
      catalog = await CourseCatalog.load(coursesDirectory);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`CourseCatalog.load() failed while validating courses in ${coursesDirectory}: ${detail}`);
    }

    for (const courseDirectory of courseDirectories) {
      const courseId = courseDirectory.name;
      const courseDirectoryPath = join(coursesDirectory, courseId);
      const counter: AssertionCounter = { value: 0 };
      const courseContext = `[${courseId}] course.md`;
      const manifest = readFrontMatter(join(courseDirectoryPath, "course.md"), courseContext, counter);

      assertContract(manifest.schemaVersion === 1, `${courseContext}: schemaVersion must be 1`, counter);
      const manifestId = assertStringField(manifest, "id", courseContext, counter);
      assertContract(manifestId === courseId, `${courseContext}: id must match directory name ${courseId}`, counter);
      assertStringField(manifest, "title", courseContext, counter);
      assertStringField(manifest, "description", courseContext, counter);
      assertStringField(manifest, "category", courseContext, counter);

      const overview = assertRecord(manifest.overview, `${courseContext}: overview must be a mapping`, counter);
      assertStringField(overview, "duration", `${courseContext} overview`, counter);
      assertStringField(overview, "sessionLength", `${courseContext} overview`, counter);
      assertStringField(overview, "level", `${courseContext} overview`, counter);
      assertStringList(overview.outcomes, "outcomes", `${courseContext} overview`, counter);
      assertStringList(overview.prerequisites, "prerequisites", `${courseContext} overview`, counter);

      const paths = assertNonEmptyArray(manifest.paths, "paths", courseContext, counter);
      const hasCompletePath = paths.some((path) => {
        if (!isRecord(path)) return false;
        return ["id", "label", "serverCommand", "testCommand", "workspaceHint"]
          .every((key) => isNonEmptyString(path[key]));
      });
      assertContract(
        hasCompletePath,
        `${courseContext}: at least one path must have id, label, serverCommand, testCommand, and workspaceHint`,
        counter,
      );

      const modulesDirectory = join(courseDirectoryPath, "modules");
      const moduleFiles = readdirSync(modulesDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort();
      assertContract(moduleFiles.length > 0, `${courseId}: modules/ must contain at least one Markdown module`, counter);

      const moduleIds = new Set<string>();
      const questionIds = new Set<string>();
      const discoveredModuleIds: string[] = [];

      for (const moduleFile of moduleFiles) {
        const modulePath = join(modulesDirectory, moduleFile);
        const moduleContext = `[${courseId}] ${moduleFile}`;
        const module = readFrontMatter(modulePath, moduleContext, counter);
        const moduleId = assertStringField(module, "id", moduleContext, counter);
        assertContract(!moduleIds.has(moduleId), `${moduleContext}: duplicate module id ${moduleId}`, counter);
        moduleIds.add(moduleId);
        discoveredModuleIds.push(moduleId);
        assertStringField(module, "title", moduleContext, counter);
        assertStringField(module, "goal", moduleContext, counter);
        assertStringField(module, "action", moduleContext, counter);

        const sources = assertStringList(module.sources, "sources", moduleContext, counter);
        const questions = assertNonEmptyArray(module.questions, "questions", moduleContext, counter);
        for (const source of sources) {
          assertLocalReference(source, modulePath, `${moduleContext} source ${source}`, counter);
        }

        for (const entry of questions) {
          const questionId = isRecord(entry) && isNonEmptyString(entry.id) ? entry.id : "<missing>";
          const questionContext = `${moduleContext} question ${questionId}`;
          const question = assertRecord(entry, `${questionContext}: question must be a mapping`, counter);
          const parsedQuestionId = assertStringField(question, "id", questionContext, counter);
          assertContract(!questionIds.has(parsedQuestionId), `${questionContext}: duplicate question id`, counter);
          questionIds.add(parsedQuestionId);
          assertStringField(question, "kind", questionContext, counter);
          assertStringField(question, "prompt", questionContext, counter);
          const reference = assertStringField(question, "reference", questionContext, counter);
          assertStringList(question.rubric, "rubric", questionContext, counter);
          assertLocalReference(reference, modulePath, questionContext, counter);
        }
      }

      const loadedCourse = catalog.get(courseId);
      assertContract(
        loadedCourse.sections.length === moduleFiles.length,
        `[${courseId}] CourseCatalog.load(): expected one section per module file (${moduleFiles.length} discovered, ${loadedCourse.sections.length} loaded)`,
        counter,
      );
      assertContract(
        loadedCourse.sections.map((section) => section.id).every((id, index) => id === discoveredModuleIds[index]),
        `[${courseId}] CourseCatalog.load(): loaded section IDs must match the sorted module files`,
        counter,
      );
    }
  });
});

function readFrontMatter(path: string, context: string, counter: AssertionCounter): Metadata {
  const content = readFileSync(path, "utf8");
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assertContract(Boolean(match), `${context}: Markdown must begin with YAML front matter`, counter);

  let metadata: unknown;
  try {
    metadata = parse(match![1]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}: invalid YAML front matter: ${detail}`);
  }
  return assertRecord(metadata, `${context}: YAML front matter must be a mapping`, counter);
}

function assertStringField(value: Metadata, key: string, context: string, counter: AssertionCounter): string {
  const candidate = value[key];
  assertContract(isNonEmptyString(candidate), `${context}: ${key} must be a non-empty string`, counter);
  return candidate as string;
}

function assertStringList(value: unknown, key: string, context: string, counter: AssertionCounter): string[] {
  assertContract(
    Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString),
    `${context}: ${key} must be a non-empty list of strings`,
    counter,
  );
  return value as string[];
}

function assertNonEmptyArray(value: unknown, key: string, context: string, counter: AssertionCounter): unknown[] {
  assertContract(Array.isArray(value) && value.length > 0, `${context}: ${key} must be a non-empty list`, counter);
  return value as unknown[];
}

function assertRecord(value: unknown, message: string, counter: AssertionCounter): Metadata {
  assertContract(isRecord(value), message, counter);
  return value as Metadata;
}

function assertLocalReference(reference: string, modulePath: string, context: string, counter: AssertionCounter) {
  if (/^https:\/\//.test(reference)) return;
  const sourcePath = reference.split("#", 1)[0];
  assertContract(sourcePath.endsWith(".md"), `${context}: local reference ${reference} must point to a Markdown file`, counter);

  let isFile = false;
  try {
    isFile = statSync(resolve(dirname(modulePath), sourcePath)).isFile();
  } catch {
    isFile = false;
  }
  assertContract(isFile, `${context}: local reference ${reference} does not resolve to an existing file`, counter);
}

function assertContract(condition: unknown, message: string, counter: AssertionCounter): asserts condition {
  counter.value += 1;
  if (!condition) throw new Error(message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Metadata {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
