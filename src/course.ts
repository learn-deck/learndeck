import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { parse } from "yaml";
import type { CatalogueProvenance, CourseDefinition, CourseOverview, CoursePath, CourseQuestion, CourseSection, QuestionKind } from "./types";

const COURSE_FILENAME = "course.md";
const GITHUB_REPOSITORY_ENV = "LEARNDECK_COURSE_REPOSITORY";
const CACHE_METADATA_SUFFIX = ".metadata.json";

interface MarkdownDocument {
  metadata: Record<string, unknown>;
  body: string;
}

export class CourseCatalog {
  private constructor(
    readonly directory: string,
    private readonly courses: Map<string, CourseDefinition>,
    readonly catalogue: CatalogueProvenance,
  ) {}

  static async load(directory = courseDirectory()): Promise<CourseCatalog> {
    return CourseCatalog.loadDirectory(directory, {
      source: "bundled",
      repository: null,
      syncedAt: null,
      warning: null,
    });
  }

  private static async loadDirectory(directory: string, catalogue: CatalogueProvenance): Promise<CourseCatalog> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (!entries.length) throw new Error(`No LearnDeck course packs found in ${directory}. Run "bun run seed -- <course-id>" to create one.`);

    const courses = new Map<string, CourseDefinition>();
    for (const courseDirectoryName of entries) {
      const courseDirectoryPath = join(directory, courseDirectoryName);
      const course = await loadCoursePack(courseDirectoryPath);
      if (courses.has(course.id)) throw new Error(`Duplicate course ID: ${course.id}`);
      courses.set(course.id, course);
    }
    return new CourseCatalog(directory, courses, catalogue);
  }

  static async loadConfigured(): Promise<CourseCatalog> {
    const repository = process.env[GITHUB_REPOSITORY_ENV];
    if (!repository) return CourseCatalog.load();
    const spec = parseGitHubRepository(repository);
    const cacheRoot = resolve(process.env.LEARNDECK_COURSE_CACHE_DIR ?? `${import.meta.dir}/../.learndeck/course-cache`);
    const cacheDirectory = join(cacheRoot, `${spec.owner}-${spec.repository}-${spec.branch}`);
    const cacheMetadataPath = `${cacheDirectory}${CACHE_METADATA_SUFFIX}`;
    try {
      await syncGitHubMarkdownRepository(spec, cacheDirectory);
      const catalog = await CourseCatalog.loadDirectory(join(cacheDirectory, "courses"), {
        source: "live",
        repository,
        syncedAt: new Date().toISOString(),
        warning: null,
      });
      await writeCacheMetadata(cacheMetadataPath, { syncedAt: catalog.catalogue.syncedAt! });
      return catalog;
    } catch (error) {
      if (await isDirectory(join(cacheDirectory, "courses"))) {
        const metadata = await readCacheMetadata(cacheMetadataPath);
        const syncedAt = metadata?.syncedAt ?? null;
        const warning = syncedAt
          ? `Showing the last complete download from ${syncedAt}. GitHub sync failed.`
          : "Showing the cached catalogue. GitHub sync failed.";
        return CourseCatalog.loadDirectory(join(cacheDirectory, "courses"), {
          source: "cached",
          repository,
          syncedAt,
          warning,
        });
      }
      throw error;
    }
  }

  list(): CourseDefinition[] {
    return [...this.courses.values()];
  }

  get(courseId: string): CourseDefinition {
    const course = this.courses.get(courseId);
    if (!course) throw new Error(`Unknown course: ${courseId}`);
    return course;
  }
}

async function loadCoursePack(packDirectory: string): Promise<CourseDefinition> {
  const manifestPath = join(packDirectory, COURSE_FILENAME);
  const manifest = await readMarkdown(manifestPath, "course metadata");
  const moduleDirectory = join(packDirectory, "modules");
  const moduleFiles = (await readdir(moduleDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  if (!moduleFiles.length) throw new Error(`${packDirectory} needs at least one Markdown module in modules/.`);

  const sections = await Promise.all(moduleFiles.map(async (file) => {
    const modulePath = join(moduleDirectory, file);
    const module = await readMarkdown(modulePath, "module metadata");
    const section = readSection(module, modulePath);
    await validateReferences(section, modulePath);
    return section;
  }));

  const course: CourseDefinition = {
    schemaVersion: readNumber(manifest.metadata, "schemaVersion", manifestPath),
    id: readString(manifest.metadata, "id", manifestPath),
    title: readString(manifest.metadata, "title", manifestPath),
    description: readString(manifest.metadata, "description", manifestPath),
    category: readOptionalString(manifest.metadata, "category", manifestPath) ?? "General",
    tags: readOptionalStringArray(manifest.metadata.tags, "tags", manifestPath),
    overview: readOverview(manifest.metadata.overview, manifestPath),
    paths: readPaths(manifest.metadata.paths, manifestPath),
    sections,
  };
  validateCourse(course, manifestPath);
  return course;
}

function readOverview(value: unknown, path: string): CourseOverview {
  if (!isRecord(value)) throw new Error(`${path} needs an overview mapping.`);
  return {
    duration: readString(value, "duration", `${path} overview`),
    sessionLength: readString(value, "sessionLength", `${path} overview`),
    level: readString(value, "level", `${path} overview`),
    outcomes: readStringArray(value.outcomes, "outcomes", `${path} overview`),
    prerequisites: readStringArray(value.prerequisites, "prerequisites", `${path} overview`),
  };
}

async function readMarkdown(path: string, label: string): Promise<MarkdownDocument> {
  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${path} must begin with YAML front matter fenced by --- lines.`);
  try {
    const metadata = parse(match[1]);
    if (!isRecord(metadata)) throw new Error("metadata is not a mapping");
    return { metadata, body: match[2].trim() };
  } catch (error) {
    throw new Error(`${path} has invalid YAML front matter: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function readPaths(value: unknown, path: string): CoursePath[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${path} needs a non-empty paths list.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path} path ${index + 1} must be a mapping.`);
    return {
      id: readString(entry, "id", `${path} path ${index + 1}`),
      label: readString(entry, "label", `${path} path ${index + 1}`),
      serverCommand: readOptionalString(entry, "serverCommand", `${path} path ${index + 1}`),
      testCommand: readOptionalString(entry, "testCommand", `${path} path ${index + 1}`),
      workspaceHint: readOptionalString(entry, "workspaceHint", `${path} path ${index + 1}`),
    };
  });
}

function readSection(module: MarkdownDocument, path: string): CourseSection {
  const { metadata, body } = module;
  const questions = metadata.questions;
  if (!Array.isArray(questions) || !questions.length) throw new Error(`${path} needs at least one question.`);
  return {
    id: readString(metadata, "id", path),
    title: readString(metadata, "title", path),
    goal: readString(metadata, "goal", path),
    action: readString(metadata, "action", path),
    content: body,
    sources: readStringArray(metadata.sources, "sources", path),
    questions: questions.map((entry, index) => readQuestion(entry, `${path} question ${index + 1}`)),
  };
}

function readQuestion(value: unknown, path: string): CourseQuestion {
  if (!isRecord(value)) throw new Error(`${path} must be a mapping.`);
  const kind = readString(value, "kind", path);
  if (!isQuestionKind(kind)) throw new Error(`${path} kind must be diagnostic, exit, or review.`);
  return {
    id: readString(value, "id", path),
    kind,
    prompt: readString(value, "prompt", path),
    reference: readString(value, "reference", path),
    rubric: readStringArray(value.rubric, "rubric", path),
  };
}

async function validateReferences(section: CourseSection, modulePath: string) {
  for (const reference of [...section.sources, ...section.questions.map((question) => question.reference)]) {
    if (/^https:\/\//.test(reference)) continue;
    const sourcePath = reference.split("#", 1)[0];
    if (!sourcePath.endsWith(".md")) throw new Error(`${modulePath} references ${reference}; local course sources must be Markdown files.`);
    try {
      const source = await stat(resolve(dirname(modulePath), sourcePath));
      if (!source.isFile()) throw new Error("not a file");
    } catch {
      throw new Error(`${modulePath} references a missing Markdown source: ${reference}`);
    }
  }
}

function validateCourse(course: CourseDefinition, source: string) {
  if (course.schemaVersion !== 1 || !course.id || !course.title || !course.description || !course.paths.length || !course.sections.length) {
    throw new Error(`${source} is not a supported LearnDeck course pack.`);
  }
  assertUnique(course.paths.map((path) => path.id), `${source} path IDs`);
  assertUnique(course.sections.map((section) => section.id), `${source} section IDs`);
  assertUnique(course.sections.flatMap((section) => section.questions.map((question) => question.id)), `${source} question IDs`);
}

function readString(value: Record<string, unknown>, key: string, source: string) {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error(`${source} needs a non-empty ${key}.`);
  return candidate.trim();
}

function readOptionalString(value: Record<string, unknown>, key: string, source: string) {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error(`${source} ${key} must be a non-empty string when present.`);
  return candidate.trim();
}

function readNumber(value: Record<string, unknown>, key: string, source: string) {
  const candidate = value[key];
  if (typeof candidate !== "number") throw new Error(`${source} needs a numeric ${key}.`);
  return candidate;
}

function readStringArray(value: unknown, key: string, source: string) {
  if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${source} needs a non-empty ${key} list of strings.`);
  }
  return value.map((entry) => (entry as string).trim());
}

function readOptionalStringArray(value: unknown, key: string, source: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${source} ${key} must be a list of non-empty strings when present.`);
  }
  return value.map((entry) => (entry as string).trim());
}

function assertUnique(values: string[], label: string) {
  if (values.some((value) => !value) || new Set(values).size !== values.length) throw new Error(`${label} must be present and unique.`);
}

function isQuestionKind(value: string): value is QuestionKind {
  return value === "diagnostic" || value === "exit" || value === "review";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function courseDirectory() {
  return process.env.LEARNDECK_COURSES_DIR ?? process.env.PATCHQUEST_COURSES_DIR ?? resolve(import.meta.dir, "../courses");
}

type GitHubRepository = { owner: string; repository: string; branch: string };

function parseGitHubRepository(value: string): GitHubRepository {
  const match = value.match(/^github:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)@([A-Za-z0-9._/-]+)$/);
  if (!match) throw new Error(`${GITHUB_REPOSITORY_ENV} must use github:owner/repository@branch.`);
  // Git forbids "." and ".." ref segments; here they would also let the cache
  // directory (which gets recursively removed on sync) escape the cache root.
  if (match[3].split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`${GITHUB_REPOSITORY_ENV} branch must not contain "." or ".." path segments.`);
  }
  return { owner: match[1], repository: match[2], branch: match[3] };
}

async function syncGitHubMarkdownRepository(spec: GitHubRepository, cacheDirectory: string) {
  const treeResponse = await fetch(`https://api.github.com/repos/${spec.owner}/${spec.repository}/git/trees/${encodeURIComponent(spec.branch)}?recursive=1`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!treeResponse.ok) throw new Error(`Could not read public course repository ${spec.owner}/${spec.repository}@${spec.branch}: ${treeResponse.status}.`);
  const payload = await treeResponse.json() as { tree?: Array<{ path?: string; type?: string }> };
  const files = (payload.tree ?? []).filter((entry): entry is { path: string; type: string } =>
    entry.type === "blob" && typeof entry.path === "string" && isCourseMarkdown(entry.path),
  );
  if (!files.some((entry) => entry.path.startsWith("courses/") && entry.path.endsWith("/course.md"))) {
    throw new Error(`Public course repository ${spec.owner}/${spec.repository} needs courses/<course-id>/course.md.`);
  }

  const stagingDirectory = `${cacheDirectory}.next`;
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  try {
    for (const file of files) {
      const destination = resolve(stagingDirectory, file.path);
      if (!destination.startsWith(`${stagingDirectory}${sep}`)) throw new Error(`Unsafe Markdown path from public course repository: ${file.path}`);
      const encodedPath = file.path.split("/").map((part) => encodeURIComponent(part)).join("/");
      const response = await fetch(`https://raw.githubusercontent.com/${spec.owner}/${spec.repository}/${encodeURIComponent(spec.branch)}/${encodedPath}`);
      if (!response.ok) throw new Error(`Could not download public course Markdown ${file.path}: ${response.status}.`);
      await mkdir(dirname(destination), { recursive: true });
      await Bun.write(destination, await response.text());
    }
    await rm(cacheDirectory, { recursive: true, force: true });
    await mkdir(dirname(cacheDirectory), { recursive: true });
    await rename(stagingDirectory, cacheDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

function isCourseMarkdown(path: string) {
  return path.endsWith(".md") && (path.startsWith("courses/") || path.startsWith("references/"));
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readCacheMetadata(path: string): Promise<{ syncedAt: string } | undefined> {
  try {
    const value = JSON.parse(await Bun.file(path).text()) as { syncedAt?: unknown };
    return typeof value.syncedAt === "string" && value.syncedAt ? { syncedAt: value.syncedAt } : undefined;
  } catch {
    return undefined;
  }
}

async function writeCacheMetadata(path: string, metadata: { syncedAt: string }) {
  const stagingPath = `${path}.next`;
  await Bun.write(stagingPath, `${JSON.stringify(metadata)}\n`);
  await rename(stagingPath, path);
}

export function getSection(course: CourseDefinition, sectionId: string): CourseSection {
  const section = course.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error(`Unknown course section: ${sectionId}`);
  return section;
}

export function getQuestion(course: CourseDefinition, questionId: string): { section: CourseSection; question: CourseQuestion } {
  for (const section of course.sections) {
    const question = section.questions.find((candidate) => candidate.id === questionId);
    if (question) return { section, question };
  }
  throw new Error(`Unknown course question: ${questionId}`);
}
