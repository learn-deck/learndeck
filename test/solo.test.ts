import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { IntegrationService } from "../src/integrations";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

describe("solo learning API", () => {
  let directory: string;
  let catalog: CourseCatalog;
  let store: CourseStore;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "learndeck-solo-"));
    catalog = await CourseCatalog.load();
    store = new CourseStore(join(directory, "progress.db"));
    app = await createApp(store, catalog, new IntegrationService(join(directory, "app"), {
      homeDirectory: join(directory, "home"),
      findExecutable: () => undefined,
    }));
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function createPath() {
    const course = catalog.get("ddd-backend-foundations");
    return store.createPath(course, { coursePathId: "node-typescript", workspacePath: `/work/${crypto.randomUUID()}` });
  }

  test("records learner evidence and preserves provenance in overview and export", async () => {
    const path = await createPath();
    const response = await app(new Request(`http://learndeck.test/api/paths/${path.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sectionId: "start", note: "Ran npm test and saw the health route pass.", ref: "src/server.ts:12" }),
    }));

    expect(response.status).toBe(201);
    const recorded = await response.json() as Record<string, unknown>;
    expect(recorded).toMatchObject({
      pathId: path.id,
      sectionId: "start",
      note: "Ran npm test and saw the health route pass.",
      ref: "src/server.ts:12",
      source: "learner",
    });
    expect(recorded.id).toBeNumber();
    expect(recorded.recordedAt).toBeString();

    const overview = store.overview(catalog.get(path.courseId), path.id);
    expect(overview.evidence).toContainEqual(expect.objectContaining({
      id: recorded.id,
      pathId: path.id,
      sectionId: "start",
      note: "Ran npm test and saw the health route pass.",
      ref: "src/server.ts:12",
      source: "learner",
    }));

    const exported = store.exportPath(catalog.get(path.courseId), path.id);
    expect(exported.evidence).toContainEqual(expect.objectContaining({
      id: recorded.id,
      pathId: path.id,
      sectionId: "start",
      note: "Ran npm test and saw the health route pass.",
      evidence: "Ran npm test and saw the health route pass.",
      source: "learner",
    }));
  });

  test("self-review advances past an exit answer while keeping the section honest", async () => {
    const path = await createPath();
    const exit = store.submitAnswer(catalog.get(path.courseId), {
      pathId: path.id,
      questionId: "start-evidence",
      answer: "The project lives in its confirmed workspace and exposes the status route.",
    });

    const response = await app(new Request(`http://learndeck.test/api/attempts/${exit.id}/self-review`, { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ attemptId: exit.id, result: "self_reviewed" });

    const overview = store.overview(catalog.get(path.courseId), path.id);
    expect(overview.progress.find((item) => item.sectionId === "start")?.status).toBe("self_reviewed");
    expect(overview.completedSections).toBe(0);
    expect(overview.attempts.find((item) => item.id === exit.id)?.result).toBe("self_reviewed");
    expect(store.nextActivity(catalog.get(path.courseId), path.id).section.id).toBe("domain");
  });

  test("rejects self-review after a real guide evaluation", async () => {
    const path = await createPath();
    const course = catalog.get(path.courseId);
    const exit = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-evidence",
      answer: "The project lives in its confirmed workspace and exposes the status route.",
    });
    store.evaluateAttempt(course, {
      attemptId: exit.id,
      result: "correct",
      feedback: "The answer names the workspace, command, and observable route.",
    });

    const response = await app(new Request(`http://learndeck.test/api/attempts/${exit.id}/self-review`, { method: "POST" }));
    expect(response.status).toBe(409);
  });

  test("a later guide evaluation of a new attempt upgrades a self-reviewed section", async () => {
    const path = await createPath();
    const course = catalog.get(path.courseId);
    const first = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-evidence",
      answer: "I recorded the project folder and status route.",
    });
    const selfReview = await app(new Request(`http://learndeck.test/api/attempts/${first.id}/self-review`, { method: "POST" }));
    expect(selfReview.status).toBe(200);

    const second = store.submitAnswer(course, {
      pathId: path.id,
      questionId: "start-evidence",
      answer: "The project lives in /work/ddd-api, runs with npm run dev, and exposes GET /health.",
    });
    store.evaluateAttempt(course, {
      attemptId: second.id,
      result: "correct",
      feedback: "The new answer gives the concrete workspace, command, and status route.",
    });

    expect(store.overview(course, path.id).progress.find((item) => item.sectionId === "start")?.status).toBe("complete");
  });
});
