import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CourseDefinition, CourseQuestion, CourseSection } from "./types";

export class CourseCatalog {
  private constructor(
    readonly directory: string,
    private readonly courses: Map<string, CourseDefinition>,
  ) {}

  static async load(directory = process.env.PATCHQUEST_COURSES_DIR ?? resolve(import.meta.dir, "../courses")): Promise<CourseCatalog> {
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    if (!files.length) throw new Error(`No course manifests found in ${directory}. Run \"bun run seed -- <course-id>\" to create one.`);

    const courses = new Map<string, CourseDefinition>();
    for (const file of files) {
      const course = (await Bun.file(`${directory}/${file}`).json()) as CourseDefinition;
      validateCourse(course, file);
      if (courses.has(course.id)) throw new Error(`Duplicate course ID: ${course.id}`);
      courses.set(course.id, course);
    }
    return new CourseCatalog(directory, courses);
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

function validateCourse(course: CourseDefinition, source: string) {
  if (course.schemaVersion !== 1 || !course.id || !course.title || !course.description || !Array.isArray(course.paths) || !course.paths.length || !Array.isArray(course.sections) || !course.sections.length) {
    throw new Error(`${source} is not a supported PatchQuest course manifest.`);
  }
  assertUnique(course.paths.map((path) => path.id), `${source} path IDs`);
  assertUnique(course.sections.map((section) => section.id), `${source} section IDs`);
  assertUnique(course.sections.flatMap((section) => section.questions.map((question) => question.id)), `${source} question IDs`);
  for (const section of course.sections) {
    if (!section.title || !section.goal || !section.action || !section.sources.length || !section.questions.length) {
      throw new Error(`${source} has an incomplete section: ${section.id || "(missing ID)"}.`);
    }
  }
}

function assertUnique(values: string[], label: string) {
  if (values.some((value) => !value) || new Set(values).size !== values.length) throw new Error(`${label} must be present and unique.`);
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
