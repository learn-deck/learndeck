import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getQuestion, getSection } from "./course";
import type {
  AttemptResult,
  CourseDefinition,
  LearningPath,
  NextActivity,
  PathOverview,
  QuestionAttempt,
  SectionProgress,
  SectionStatus,
} from "./types";

type PathRow = {
  id: string;
  course_id: string;
  language_id: string;
  workspace_path: string;
  label: string;
  created_at: string;
  updated_at: string;
};

type ProgressRow = {
  section_id: string;
  status: SectionStatus;
  evidence: string | null;
  review_question: string | null;
  updated_at: string;
};

type AttemptRow = {
  id: number;
  path_id: string;
  section_id: string;
  question_id: string;
  kind: "diagnostic" | "exit" | "review";
  answer: string;
  confidence: number | null;
  result: AttemptResult;
  feedback: string | null;
  reference: string;
  submitted_at: string;
  evaluated_at: string | null;
};

export class CourseStore {
  readonly db: Database;

  constructor(path = process.env.LEARNDECK_DB_PATH ?? process.env.PATCHQUEST_DB_PATH ?? resolve(import.meta.dir, "../.learndeck/progress.db")) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_paths (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        language_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(course_id, language_id, workspace_path)
      );
      CREATE TABLE IF NOT EXISTS section_progress (
        path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
        section_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('not_started', 'active', 'revision', 'complete')),
        evidence TEXT,
        review_question TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (path_id, section_id)
      );
      CREATE TABLE IF NOT EXISTS question_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
        section_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('diagnostic', 'exit', 'review')),
        answer TEXT NOT NULL,
        confidence INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
        result TEXT NOT NULL CHECK (result IN ('submitted', 'correct', 'partial', 'incorrect')),
        feedback TEXT,
        reference TEXT NOT NULL,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        evaluated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
        actor TEXT NOT NULL CHECK (actor IN ('learner', 'agent', 'system')),
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  createPath(course: CourseDefinition, input: { coursePathId: string; workspacePath: string; label?: string }): LearningPath {
    const coursePath = course.paths.find((path) => path.id === input.coursePathId);
    if (!coursePath) throw new Error(`Unknown course path: ${input.coursePathId}`);
    const workspacePath = input.workspacePath.trim();
    if (!workspacePath) throw new Error("A workspace path is required.");
    const label = input.label?.trim() || `${coursePath.label} — ${workspacePath}`;
    const existing = this.db
      .query<PathRow, [string, string, string]>(
        "SELECT * FROM learning_paths WHERE course_id = ? AND language_id = ? AND workspace_path = ?",
      )
      .get(course.id, coursePath.id, workspacePath);
    if (existing) return mapPath(existing);

    const id = randomUUID();
    this.db
      .query(
        "INSERT INTO learning_paths (id, course_id, language_id, workspace_path, label) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, course.id, coursePath.id, workspacePath, label);
    for (const section of course.sections) {
      this.db.query("INSERT INTO section_progress (path_id, section_id, status) VALUES (?, ?, 'not_started')").run(id, section.id);
    }
    this.log(id, "learner", "path_created", { coursePathId: coursePath.id, workspacePath, label });
    return this.getPath(id);
  }

  listPaths(courseId: string): LearningPath[] {
    return this.db
      .query<PathRow, [string]>("SELECT * FROM learning_paths WHERE course_id = ? ORDER BY updated_at DESC")
      .all(courseId)
      .map(mapPath);
  }

  getPath(pathId: string): LearningPath {
    const row = this.db.query<PathRow, [string]>("SELECT * FROM learning_paths WHERE id = ?").get(pathId);
    if (!row) throw new Error(`Unknown learning path: ${pathId}`);
    return mapPath(row);
  }

  getAttempt(attemptId: number): QuestionAttempt {
    const row = this.db.query<AttemptRow, [number]>("SELECT * FROM question_attempts WHERE id = ?").get(attemptId);
    if (!row) throw new Error(`Unknown attempt: ${attemptId}`);
    return mapAttempt(row);
  }

  overview(course: CourseDefinition, pathId: string): PathOverview {
    const path = this.getPath(pathId);
    if (path.courseId !== course.id) throw new Error("This path belongs to a different course.");
    const progress = this.progress(pathId);
    const attempts = this.attempts(pathId);
    return {
      path,
      progress,
      attempts,
      completedSections: progress.filter((item) => item.status === "complete").length,
      totalSections: course.sections.length,
    };
  }

  nextActivity(course: CourseDefinition, pathId: string): NextActivity {
    const progress = this.progress(pathId);
    for (const section of course.sections) {
      const state = progress.find((entry) => entry.sectionId === section.id);
      if (state?.status !== "complete") {
        const unanswered = section.questions.find((question) => !this.hasEvaluatedAttempt(pathId, question.id));
        return { section, question: unanswered ?? section.questions.at(-1)!, progress: state };
      }
    }
    const finalSection = course.sections.at(-1)!;
    return { section: finalSection, question: finalSection.questions.at(-1)!, progress: progress.at(-1) };
  }

  submitAnswer(
    course: CourseDefinition,
    input: { pathId: string; questionId: string; answer: string; confidence?: number },
  ): QuestionAttempt {
    const answer = input.answer.trim();
    if (!answer) throw new Error("An answer is required.");
    if (input.confidence !== undefined && (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100)) {
      throw new Error("Confidence must be a whole number from 0 to 100.");
    }
    const { section, question } = getQuestion(course, input.questionId);
    const path = this.getPath(input.pathId);
    if (path.courseId !== course.id) throw new Error("This path belongs to a different course.");
    const result = this.db
      .query<AttemptRow, [string, string, string, string, string, number | null, string]>(
        `INSERT INTO question_attempts (path_id, section_id, question_id, kind, answer, confidence, result, reference)
         VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)
         RETURNING *`,
      )
      .get(input.pathId, section.id, question.id, question.kind, answer, input.confidence ?? null, question.reference);
    this.setProgress(input.pathId, section.id, "active");
    this.log(input.pathId, "learner", "answer_submitted", { attemptId: result.id, questionId: question.id });
    return mapAttempt(result);
  }

  evaluateAttempt(
    course: CourseDefinition,
    input: { attemptId: number; result: Exclude<AttemptResult, "submitted">; feedback: string; evidence?: string; reviewQuestion?: string },
  ): QuestionAttempt {
    const feedback = input.feedback.trim();
    if (!feedback) throw new Error("Source-linked feedback is required.");
    const attempt = this.getAttempt(input.attemptId);
    if (this.getPath(attempt.pathId).courseId !== course.id) throw new Error("This attempt belongs to a different course.");
    if (attempt.result !== "submitted") throw new Error("Only submitted answers may be evaluated.");
    const { section, question } = getQuestion(course, attempt.questionId);
    const evaluated = this.db
      .query<AttemptRow, [string, string, number]>(
        "UPDATE question_attempts SET result = ?, feedback = ?, evaluated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *",
      )
      .get(input.result, feedback, input.attemptId);

    const status: SectionStatus = input.result === "correct" && question.kind === "exit" ? "complete" : input.result === "correct" ? "active" : "revision";
    this.setProgress(attempt.pathId, section.id, status, input.evidence, input.reviewQuestion);
    this.log(attempt.pathId, "agent", "answer_evaluated", {
      attemptId: input.attemptId,
      questionId: question.id,
      result: input.result,
      reference: attempt.reference,
    });
    return mapAttempt(evaluated);
  }

  recordEvidence(
    course: CourseDefinition,
    input: { pathId: string; sectionId: string; evidence: string; reviewQuestion?: string },
  ): SectionProgress {
    const evidence = input.evidence.trim();
    if (!evidence) throw new Error("Evidence is required.");
    const path = this.getPath(input.pathId);
    if (path.courseId !== course.id) throw new Error("This path belongs to a different course.");
    getSection(course, input.sectionId);
    this.setProgress(input.pathId, input.sectionId, "active", evidence, input.reviewQuestion);
    this.log(input.pathId, "agent", "evidence_recorded", { sectionId: input.sectionId, evidence });
    return this.progress(input.pathId).find((item) => item.sectionId === input.sectionId)!;
  }

  private progress(pathId: string): SectionProgress[] {
    return this.db
      .query<ProgressRow, [string]>("SELECT * FROM section_progress WHERE path_id = ? ORDER BY rowid")
      .all(pathId)
      .map((row) => ({
        sectionId: row.section_id,
        status: row.status,
        evidence: row.evidence ?? undefined,
        reviewQuestion: row.review_question ?? undefined,
        updatedAt: row.updated_at,
      }));
  }

  private attempts(pathId: string): QuestionAttempt[] {
    return this.db
      .query<AttemptRow, [string]>("SELECT * FROM question_attempts WHERE path_id = ? ORDER BY id DESC")
      .all(pathId)
      .map(mapAttempt);
  }

  private hasEvaluatedAttempt(pathId: string, questionId: string) {
    return Boolean(
      this.db
        .query<{ count: number }, [string, string]>(
          "SELECT COUNT(*) AS count FROM question_attempts WHERE path_id = ? AND question_id = ? AND result = 'correct'",
        )
        .get(pathId, questionId)?.count,
    );
  }

  private setProgress(pathId: string, sectionId: string, status: SectionStatus, evidence?: string, reviewQuestion?: string) {
    this.db
      .query(
        `UPDATE section_progress
         SET status = ?, evidence = COALESCE(?, evidence), review_question = COALESCE(?, review_question), updated_at = CURRENT_TIMESTAMP
         WHERE path_id = ? AND section_id = ?`,
      )
      .run(status, evidence ?? null, reviewQuestion ?? null, pathId, sectionId);
  }

  private log(pathId: string, actor: "learner" | "agent" | "system", eventType: string, payload: object) {
    this.db.query("INSERT INTO activity_log (path_id, actor, event_type, payload) VALUES (?, ?, ?, ?)").run(pathId, actor, eventType, JSON.stringify(payload));
  }
}

function mapPath(row: PathRow): LearningPath {
  return {
    id: row.id,
    courseId: row.course_id,
    coursePathId: row.language_id,
    workspacePath: row.workspace_path,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttempt(row: AttemptRow): QuestionAttempt {
  return {
    id: row.id,
    pathId: row.path_id,
    sectionId: row.section_id,
    questionId: row.question_id,
    kind: row.kind,
    answer: row.answer,
    confidence: row.confidence ?? undefined,
    result: row.result,
    feedback: row.feedback ?? undefined,
    reference: row.reference,
    submittedAt: row.submitted_at,
    evaluatedAt: row.evaluated_at ?? undefined,
  };
}
