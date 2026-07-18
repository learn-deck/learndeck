import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

describe("PatchQuest HTTP API", () => {
  let directory: string;
  let store: CourseStore;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "patchquest-api-"));
    store = new CourseStore(join(directory, "progress.db"));
    app = await createApp(store);
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("creates a path and accepts a UI answer", async () => {
    const page = await app(new Request("http://patchquest.test/"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Choose a course and path");

    const courses = await app(new Request("http://patchquest.test/api/courses"));
    expect(courses.status).toBe(200);
    expect((await courses.json()).map((course: { id: string }) => course.id)).toContain("ddd-backend-foundations");

    const ddd = await app(new Request("http://patchquest.test/api/courses/ddd-backend-foundations"));
    expect(ddd.status).toBe(200);
    expect((await ddd.json()).sections).toHaveLength(8);

    const pathResponse = await app(
      new Request("http://patchquest.test/api/courses/ddd-backend-foundations/paths", {
        method: "POST",
        body: JSON.stringify({ coursePathId: "go", workspacePath: "/work/go-api", label: "Go course path" }),
      }),
    );
    expect(pathResponse.status).toBe(201);
    const path = await pathResponse.json();

    const answerResponse = await app(
      new Request("http://patchquest.test/api/attempts", {
        method: "POST",
        body: JSON.stringify({
          pathId: path.id,
          questionId: "start-boundary",
          answer: "The course must not overwrite the application workspace.",
          confidence: 75,
        }),
      }),
    );
    expect(answerResponse.status).toBe(201);
    expect((await answerResponse.json()).result).toBe("submitted");
  });
});
