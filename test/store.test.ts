import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { CourseStore } from "../src/store";

describe("CourseStore", () => {
  let directory: string;
  let store: CourseStore;
  let course: ReturnType<CourseCatalog["get"]>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "patchquest-store-"));
    store = new CourseStore(join(directory, "progress.db"));
    course = (await CourseCatalog.load()).get("example-course");
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("keeps progress and answer history separate for each project workspace", () => {
    const node = store.createPath(course, {
      coursePathId: "default",
      workspacePath: "/work/node-api",
      label: "Node API",
    });
    const secondWorkspace = store.createPath(course, {
      coursePathId: "default",
      workspacePath: "/work/second-ddd-api",
    });

    const answer = store.submitAnswer(course, {
      pathId: node.id,
      questionId: "start-boundary",
      answer: "The course runner and project are separate so shared material cannot overwrite learner code.",
      confidence: 68,
    });
    store.evaluateAttempt(course, {
      attemptId: answer.id,
      result: "correct",
      feedback: "Target: separation. Observed: you named the ownership boundary and overwrite risk. Next: create the status route.",
      evidence: "Created src/adapters/http/status.ts and ran npm run dev.",
      reviewQuestion: "What belongs in a course runner versus the learner workspace?",
    });

    const nodeOverview = store.overview(course, node.id);
    const secondOverview = store.overview(course, secondWorkspace.id);
    expect(nodeOverview.attempts).toHaveLength(1);
    expect(nodeOverview.progress.find((item) => item.sectionId === "start")?.status).toBe("active");
    expect(secondOverview.attempts).toHaveLength(0);
    expect(secondOverview.progress.find((item) => item.sectionId === "start")?.status).toBe("not_started");
  });

  test("completes a section only after a correct exit answer", () => {
    const path = store.createPath(course, { coursePathId: "default", workspacePath: "/work/ddd-api" });
    const diagnostic = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-boundary",
      answer: "A separate course folder keeps runner material out of the learner project.",
    });
    store.evaluateAttempt(course, {
      attemptId: diagnostic.id,
      result: "correct",
      feedback: "Target: folder separation. Observed: correct. Next: make the status route visible.",
    });
    const exit = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-evidence",
      answer: "My project is /work/ddd-api, I run npm run dev, and LearnDeck keeps progress tied to this project so course evidence does not mix.",
    });
    store.evaluateAttempt(course, {
      attemptId: exit.id,
      result: "correct",
      feedback: "Target: path evidence. Observed: all required elements are present. Next: model one invariant.",
    });

    expect(store.overview(course, path.id).progress.find((item) => item.sectionId === "start")?.status).toBe("complete");
  });
});
