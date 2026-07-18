export type QuestionKind = "diagnostic" | "exit" | "review";
export type AttemptResult = "submitted" | "correct" | "partial" | "incorrect" | "self_reviewed";
export type SectionStatus = "not_started" | "active" | "revision" | "self_reviewed" | "complete";
export type EvidenceSource = "learner" | "guide";
export type CatalogueSource = "bundled" | "live" | "cached";

export interface CatalogueProvenance {
  source: CatalogueSource;
  repository: string | null;
  syncedAt: string | null;
  warning: string | null;
}

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
  evidenceSource?: EvidenceSource;
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
  evidence: EvidenceRecord[];
  completedSections: number;
  totalSections: number;
}

export interface NextActivity {
  section: CourseSection;
  question: CourseQuestion;
  progress: SectionProgress | undefined;
}

export interface PathResetResult {
  pathId: string;
  attempts: number;
  evidence: number;
  progressRows: number;
}

export interface PathEvidence {
  id: number;
  pathId: string;
  sectionId: string;
  note: string;
  evidence: string;
  ref: string | null;
  source: EvidenceSource;
  recordedAt: string;
  reviewQuestion?: string;
  updatedAt: string;
}

export interface EvidenceRecord {
  id: number;
  pathId: string;
  sectionId: string;
  note: string;
  ref: string | null;
  source: EvidenceSource;
  recordedAt: string;
  reviewQuestion?: string;
}

export interface SelfReviewResult {
  attemptId: number;
  result: "self_reviewed";
}

export interface PathExport {
  courseId: string;
  courseTitle: string;
  course: { id: string; title: string };
  path: LearningPath;
  progress: SectionProgress[];
  attempts: QuestionAttempt[];
  evidence: PathEvidence[];
}
