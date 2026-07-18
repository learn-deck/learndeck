import type { CourseDefinition, CourseQuestion, CourseSection } from "./types";

const courseFile = Bun.file(`${import.meta.dir}/../course/ddd-course.json`);

export async function loadCourse(): Promise<CourseDefinition> {
  const course = (await courseFile.json()) as CourseDefinition;
  if (course.schemaVersion !== 1 || !course.id || course.sections.length === 0) {
    throw new Error("course/ddd-course.json is not a supported PatchQuest course manifest.");
  }
  return course;
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
