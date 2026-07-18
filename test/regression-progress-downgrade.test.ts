import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { CourseStore } from "../src/store";

describe("regression: later activity never downgrades section progress", () => {
  let directory: string;
  let store: CourseStore;
  let course: ReturnType<CourseCatalog["get"]>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "learndeck-downgrade-"));
    store = new CourseStore(join(directory, "progress.db"));
    course = (await CourseCatalog.load()).get("example-course");
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function createPath() {
    return store.createPath(course, { coursePathId: "default", workspacePath: `/work/${crypto.randomUUID()}` });
  }

  function completeStartSection(pathId: string) {
    const exit = store.submitAnswer(course, {
      pathId,
      questionId: "start-evidence",
      answer: "The project lives in its own workspace, runs with npm run dev, and exposes the status route.",
    });
    store.evaluateAttempt(course, {
      attemptId: exit.id,
      result: "correct",
      feedback: "Target: path evidence. Observed: workspace, command, and route are all named. Next: model one invariant.",
    });
  }

  function startStatus(pathId: string) {
    return store.overview(course, pathId).progress.find((item) => item.sectionId === "start")?.status;
  }

  test("guide evidence does not downgrade a complete section", () => {
    const path = createPath();
    completeStartSection(path.id);
    store.recordEvidence(course, { pathId: path.id, sectionId: "start", evidence: "The learner reran the status route check." });
    expect(startStatus(path.id)).toBe("complete");
  });

  test("guide evidence does not downgrade a self-reviewed section", () => {
    const path = createPath();
    const exit = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-evidence",
      answer: "The workspace is confirmed and the route responds.",
    });
    store.selfReviewAttempt(course, exit.id);
    store.recordEvidence(course, { pathId: path.id, sectionId: "start", evidence: "The learner shared the passing command output." });
    expect(startStatus(path.id)).toBe("self_reviewed");
  });

  test("submitting a new answer does not downgrade a complete section", () => {
    const path = createPath();
    completeStartSection(path.id);
    store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-boundary",
      answer: "The runner and the learner project stay separate so course material cannot overwrite code.",
    });
    expect(startStatus(path.id)).toBe("complete");
  });

  test("a correct non-exit evaluation keeps a complete section complete and next activity advances", () => {
    const path = createPath();
    completeStartSection(path.id);
    const review = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-boundary",
      answer: "The boundary keeps runner material out of the learner project.",
    });
    store.evaluateAttempt(course, {
      attemptId: review.id,
      result: "correct",
      feedback: "Target: boundary. Observed: correct ownership split. Next: continue with the domain section.",
    });

    expect(startStatus(path.id)).toBe("complete");
    expect(store.overview(course, path.id).completedSections).toBe(1);
    expect(store.nextActivity(course, path.id).section.id).toBe("author-a-module");
  });

  test("self-reviewing a new exit attempt does not downgrade a complete section", () => {
    const path = createPath();
    completeStartSection(path.id);
    const again = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-evidence",
      answer: "Restating the evidence for my own review.",
    });
    store.selfReviewAttempt(course, again.id);

    expect(startStatus(path.id)).toBe("complete");
    expect(store.overview(course, path.id).completedSections).toBe(1);
  });
});
