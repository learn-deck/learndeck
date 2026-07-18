import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { IntegrationService } from "../src/integrations";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

describe("first-course HTTP journey", () => {
  let directory: string;
  let store: CourseStore;
  let app: Awaited<ReturnType<typeof createApp>>;
  let catalog: CourseCatalog;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "learndeck-journey-"));
    store = new CourseStore(join(directory, "progress.db"));
    catalog = await CourseCatalog.load();
    app = await createApp(
      store,
      catalog,
      new IntegrationService("/opt/learndeck", {
        homeDirectory: join(directory, "home"),
        operatingSystem: "linux",
        findExecutable: () => undefined,
      }),
    );
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("bootstraps, starts the first course path, submits its first answer, and records progress", async () => {
    const bootstrap = await app(new Request("http://learndeck.test/api/bootstrap", { method: "POST" }));
    expect(bootstrap.status).toBe(200);
    expect((await bootstrap.json()).ready).toBe(true);

    const coursesResponse = await app(new Request("http://learndeck.test/api/courses"));
    expect(coursesResponse.status).toBe(200);
    const listedCourses = await coursesResponse.json() as Array<{ id: string }>;
    expect(listedCourses.length).toBeGreaterThan(0);

    const firstCourse = catalog.get(listedCourses[0].id);
    const detailResponse = await app(new Request(`http://learndeck.test/api/courses/${encodeURIComponent(firstCourse.id)}`));
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as typeof firstCourse;
    expect(detail.id).toBe(firstCourse.id);

    const firstSection = firstCourse.sections[0];
    const firstQuestion = firstSection.questions[0];
    const pathResponse = await app(
      new Request(`http://learndeck.test/api/courses/${encodeURIComponent(firstCourse.id)}/paths`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coursePathId: firstCourse.paths[0].id,
          workspacePath: "/tmp/learndeck-journey-workspace",
          label: "Journey workspace",
        }),
      }),
    );
    expect(pathResponse.status).toBe(201);
    const path = await pathResponse.json() as { id: string };

    const answerResponse = await app(
      new Request("http://learndeck.test/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pathId: path.id,
          questionId: firstQuestion.id,
          answer: "I can describe the boundary and the observable evidence for this first step.",
        }),
      }),
    );
    expect(answerResponse.status).toBe(201);
    const attempt = await answerResponse.json() as { questionId: string; sectionId: string; result: string };
    expect(attempt.questionId).toBe(firstQuestion.id);
    expect(attempt.sectionId).toBe(firstSection.id);
    expect(attempt.result).toBe("submitted");

    const overviewResponse = await app(new Request(`http://learndeck.test/api/paths/${encodeURIComponent(path.id)}/overview`));
    expect(overviewResponse.status).toBe(200);
    const overview = await overviewResponse.json() as {
      attempts: Array<{ questionId: string; sectionId: string; result: string }>;
      progress: Array<{ sectionId: string; status: string }>;
    };
    expect(overview.attempts.some((candidate) =>
      candidate.questionId === firstQuestion.id && candidate.sectionId === firstSection.id && candidate.result === "submitted"
    )).toBe(true);
    expect(overview.progress.find((candidate) => candidate.sectionId === firstSection.id)?.status).toBe("active");
  });

  test("rejects unknown question and path IDs with client errors", async () => {
    const firstCourse = catalog.list()[0];
    const pathResponse = await app(
      new Request(`http://learndeck.test/api/courses/${encodeURIComponent(firstCourse.id)}/paths`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coursePathId: firstCourse.paths[0].id, workspacePath: "/tmp/learndeck-invalid-inputs" }),
      }),
    );
    expect(pathResponse.status).toBe(201);
    const path = await pathResponse.json() as { id: string };
    const knownQuestionId = firstCourse.sections[0].questions[0].id;

    const unknownQuestion = await app(
      new Request("http://learndeck.test/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pathId: path.id, questionId: "question-that-does-not-exist", answer: "invalid" }),
      }),
    );
    expect(unknownQuestion.status).toBeGreaterThanOrEqual(400);
    expect(unknownQuestion.status).toBeLessThan(500);

    const unknownPath = await app(
      new Request("http://learndeck.test/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pathId: "path-that-does-not-exist", questionId: knownQuestionId, answer: "invalid" }),
      }),
    );
    expect(unknownPath.status).toBeGreaterThanOrEqual(400);
    expect(unknownPath.status).toBeLessThan(500);
  });
});
