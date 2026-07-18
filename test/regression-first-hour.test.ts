import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { IntegrationService } from "../src/integrations";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

type Evidence = {
  id: number | string;
  pathId: string;
  sectionId: string;
  note: string;
  ref?: string;
  source: "learner" | "guide";
  recordedAt: string;
};

describe("first-hour regression: workspace and solo progress", () => {
  let directory: string | undefined;
  let store: CourseStore | undefined;

  afterEach(() => {
    store?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    store = undefined;
    directory = undefined;
  });

  test("persists the workspace, self-review, learner evidence, and submitted answer across a restart", async () => {
    directory = mkdtempSync(join(tmpdir(), "learndeck-regression-first-hour-"));
    const databasePath = join(directory, "progress.db");
    const workspaceParent = join(directory, "confirmed-workspaces");
    const workspacePath = join(workspaceParent, "ddd-backend");
    mkdirSync(workspaceParent, { recursive: true });

    const catalog = await CourseCatalog.load();
    const course = catalog.list()[0];
    const firstSection = course.sections[0];
    const firstQuestion = firstSection.questions.find((question) => question.kind === "exit");
    if (!firstQuestion) {
      throw new Error("The first loaded course section " + firstSection.id + " has no exit question for the C4 progression assertion.");
    }

    store = new CourseStore(databasePath);
    let app = await createApp(
      store,
      catalog,
      new IntegrationService(join(directory, "learndeck"), { homeDirectory: join(directory, "home"), operatingSystem: "linux" }),
    );

    const pathResponse = await app(new Request(
      "http://learndeck.test/api/courses/" + encodeURIComponent(course.id) + "/paths",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coursePathId: course.paths[0].id, workspacePath }),
      },
    ));
    expect(pathResponse.status).toBe(201);
    const createdPath = await pathResponse.json() as { id: string; workspaceCreated: boolean };
    expect(createdPath.workspaceCreated).toBe(true);
    expect(existsSync(workspacePath)).toBe(true);

    const relativePathResponse = await app(new Request(
      "http://learndeck.test/api/courses/" + encodeURIComponent(course.id) + "/paths",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coursePathId: course.paths[0].id, workspacePath: "relative-workspace" }),
      },
    ));
    expect(relativePathResponse.status).toBe(400);
    expect((await relativePathResponse.json() as { error: string }).error).toContain("relative-workspace");

    const answerResponse = await app(new Request("http://learndeck.test/api/attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pathId: createdPath.id,
        questionId: firstQuestion.id,
        answer: "The confirmed workspace is separate from LearnDeck, and its health route is observable from the learner-run command.",
      }),
    }));
    expect(answerResponse.status).toBe(201);
    const submitted = await answerResponse.json() as { id: number; questionId: string; result: string };
    expect(submitted.questionId).toBe(firstQuestion.id);
    expect(submitted.result).toBe("submitted");

    const selfReviewResponse = await app(new Request(
      "http://learndeck.test/api/attempts/" + submitted.id + "/self-review",
      { method: "POST" },
    ));
    expect(selfReviewResponse.status).toBe(200);
    expect(await selfReviewResponse.json()).toEqual({ attemptId: submitted.id, result: "self_reviewed" });

    const nextResponse = await app(new Request("http://learndeck.test/api/paths/" + createdPath.id + "/next"));
    expect(nextResponse.status).toBe(200);
    const nextActivity = await nextResponse.json() as { section: { id: string } };
    expect(nextActivity.section.id).toBe(course.sections[1].id);

    const evidenceResponse = await app(new Request(
      "http://learndeck.test/api/paths/" + createdPath.id + "/evidence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sectionId: firstSection.id,
          note: "Created the confirmed workspace and recorded the learner-run setup result.",
          ref: "workspace setup",
        }),
      },
    ));
    expect(evidenceResponse.status).toBe(201);
    const recordedEvidence = await evidenceResponse.json() as Evidence;
    expect(recordedEvidence).toMatchObject({
      pathId: createdPath.id,
      sectionId: firstSection.id,
      note: "Created the confirmed workspace and recorded the learner-run setup result.",
      ref: "workspace setup",
      source: "learner",
    });
    expect(recordedEvidence.recordedAt).toBeString();

    const overviewResponse = await app(new Request("http://learndeck.test/api/paths/" + createdPath.id + "/overview"));
    expect(overviewResponse.status).toBe(200);
    const overview = await overviewResponse.json() as {
      path: { id: string; workspacePath: string };
      attempts: Array<{ id: number; questionId: string; result: string }>;
      progress: Array<{ sectionId: string; status: string }>;
      evidence: Evidence[];
    };
    expect(overview.path).toMatchObject({ id: createdPath.id, workspacePath });
    expect(overview.attempts).toContainEqual(expect.objectContaining({
      id: submitted.id,
      questionId: firstQuestion.id,
      result: "self_reviewed",
    }));
    expect(overview.progress.find((item) => item.sectionId === firstSection.id)?.status).toBe("self_reviewed");
    expect(overview.progress.find((item) => item.sectionId === firstSection.id)?.status).not.toBe("complete");
    expect(overview.evidence).toContainEqual(expect.objectContaining({
      pathId: createdPath.id,
      sectionId: firstSection.id,
      source: "learner",
      note: "Created the confirmed workspace and recorded the learner-run setup result.",
    }));

    const exportResponse = await app(new Request("http://learndeck.test/api/paths/" + createdPath.id + "/export"));
    expect(exportResponse.status).toBe(200);
    const exported = await exportResponse.json() as {
      evidence: Evidence[];
      progress: Array<{ sectionId: string; status: string }>;
    };
    expect(exported.evidence).toContainEqual(expect.objectContaining({
      sectionId: firstSection.id,
      source: "learner",
      note: "Created the confirmed workspace and recorded the learner-run setup result.",
    }));
    expect(exported.progress.find((item) => item.sectionId === firstSection.id)?.status).toBe("self_reviewed");

    store.close();
    store = undefined;
    store = new CourseStore(databasePath);
    app = await createApp(
      store,
      catalog,
      new IntegrationService(join(directory, "learndeck"), { homeDirectory: join(directory, "home"), operatingSystem: "linux" }),
    );

    const reopenedPathsResponse = await app(new Request(
      "http://learndeck.test/api/courses/" + encodeURIComponent(course.id) + "/paths",
    ));
    expect(reopenedPathsResponse.status).toBe(200);
    expect(await reopenedPathsResponse.json()).toContainEqual(expect.objectContaining({
      id: createdPath.id,
      workspacePath,
    }));

    const reopenedOverviewResponse = await app(new Request("http://learndeck.test/api/paths/" + createdPath.id + "/overview"));
    expect(reopenedOverviewResponse.status).toBe(200);
    const reopenedOverview = await reopenedOverviewResponse.json() as {
      attempts: Array<{ id: number; result: string }>;
      progress: Array<{ sectionId: string; status: string }>;
      evidence: Evidence[];
    };
    expect(reopenedOverview.attempts).toContainEqual(expect.objectContaining({ id: submitted.id, result: "self_reviewed" }));
    expect(reopenedOverview.progress.find((item) => item.sectionId === firstSection.id)?.status).toBe("self_reviewed");
    expect(reopenedOverview.evidence).toContainEqual(expect.objectContaining({
      sectionId: firstSection.id,
      source: "learner",
      note: "Created the confirmed workspace and recorded the learner-run setup result.",
    }));

    const reopenedExportResponse = await app(new Request("http://learndeck.test/api/paths/" + createdPath.id + "/export"));
    expect(reopenedExportResponse.status).toBe(200);
    const reopenedExport = await reopenedExportResponse.json() as { evidence: Evidence[] };
    expect(reopenedExport.evidence).toContainEqual(expect.objectContaining({
      sectionId: firstSection.id,
      source: "learner",
      note: "Created the confirmed workspace and recorded the learner-run setup result.",
    }));
  });
});
