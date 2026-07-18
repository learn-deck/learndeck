import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { CourseStore } from "../src/store";

describe("regression: evidence integrity across restarts and resets", () => {
  let directory: string;
  let databasePath: string;
  let store: CourseStore;
  let course: ReturnType<CourseCatalog["get"]>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "learndeck-evidence-"));
    databasePath = join(directory, "progress.db");
    store = new CourseStore(databasePath);
    course = (await CourseCatalog.load()).get("example-course");
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("reopening the store does not duplicate learner evidence as guide evidence", () => {
    const path = store.createPath(course, { coursePathId: "default", workspacePath: "/work/restart" });
    store.recordLearnerEvidence(course, {
      pathId: path.id,
      sectionId: "start",
      note: "Ran npm test and saw the health route pass.",
      ref: "src/server.ts:12",
    });
    store.close();

    store = new CourseStore(databasePath);
    const overview = store.overview(course, path.id);
    expect(overview.evidence).toHaveLength(1);
    expect(overview.evidence[0]).toMatchObject({ sectionId: "start", source: "learner" });
    expect(overview.progress.find((item) => item.sectionId === "start")?.evidenceSource).toBe("learner");
  });

  test("reset reports every deleted evidence record", () => {
    const path = store.createPath(course, { coursePathId: "default", workspacePath: "/work/reset-count" });
    store.recordLearnerEvidence(course, { pathId: path.id, sectionId: "start", note: "First learner note." });
    store.recordLearnerEvidence(course, { pathId: path.id, sectionId: "start", note: "Second learner note." });
    store.recordEvidence(course, { pathId: path.id, sectionId: "start", evidence: "Guide-confirmed status route check." });

    const result = store.resetPath(path.id);
    expect(result.evidence).toBe(3);
    expect(result.progressRows).toBe(course.sections.length);
  });
});
