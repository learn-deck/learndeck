export type QuestionKind = "diagnostic" | "exit" | "review";
export type AttemptResult = "submitted" | "correct" | "partial" | "incorrect";
export type SectionStatus = "not_started" | "active" | "revision" | "complete";

export interface CoursePath {
  id: string;
  label: string;
  serverCommand?: string;
  testCommand?: string;
  workspaceHint?: string;
}

export interface CourseOverview {
  duration: string;
  sessionLength: string;
  level: string;
  outcomes: string[];
  prerequisites: string[];
}

export interface CourseQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  reference: string;
  rubric: string[];
}

export interface CourseSection {
  id: string;
  title: string;
  goal: string;
  action: string;
  content: string;
  sources: string[];
  questions: CourseQuestion[];
}

export interface CourseDefinition {
  schemaVersion: number;
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  overview: CourseOverview;
  paths: CoursePath[];
  sections: CourseSection[];
}

export interface LearningPath {
  id: string;
  courseId: string;
  coursePathId: string;
  workspacePath: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionProgress {
  sectionId: string;
  status: SectionStatus;
  evidence?: string;
  reviewQuestion?: string;
  updatedAt: string;
}

export interface QuestionAttempt {
  id: number;
  pathId: string;
  sectionId: string;
  questionId: string;
  kind: QuestionKind;
  answer: string;
  confidence?: number;
  result: AttemptResult;
  feedback?: string;
  reference: string;
  submittedAt: string;
  evaluatedAt?: string;
}

export interface PathOverview {
  path: LearningPath;
  progress: SectionProgress[];
  attempts: QuestionAttempt[];
  completedSections: number;
  totalSections: number;
}

export interface NextActivity {
  section: CourseSection;
  question: CourseQuestion;
  progress: SectionProgress | undefined;
}
