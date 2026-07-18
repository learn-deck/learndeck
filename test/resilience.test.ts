import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { IntegrationService } from "../src/integrations";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

describe("setup resilience", () => {
  let directory: string;
  let catalog: CourseCatalog;
  let store: CourseStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "learndeck-resilience-"));
    catalog = await CourseCatalog.load();
    store = new CourseStore(join(directory, "progress.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("returns a legible 409 when a guide configuration cannot be written", async () => {
    const blockedHome = join(directory, "home-file");
    writeFileSync(blockedHome, "not a directory");
    const configPath = join(blockedHome, ".cursor", "mcp.json");
    const app = await createApp(store, catalog, new IntegrationService(join(directory, "app"), {
      homeDirectory: blockedHome,
      findExecutable: (name) => name === "cursor" ? "/usr/local/bin/cursor" : undefined,
    }));

    const response = await app(new Request("http://learndeck.test/api/integrations/cursor/connect", { method: "POST" }));
    const body = await response.json() as { error: string; integrationId: string; configPath: string; userAction: string };

    expect(response.status).toBe(409);
    expect(body.integrationId).toBe("cursor");
    expect(body.configPath).toBe(configPath);
    expect(body.error).toContain(configPath);
    expect(body.userAction).toContain(configPath);
  });

  test("reports a stale Cursor entry and repairs it on reconnect", async () => {
    const appRoot = join(directory, "app");
    const expectedEntry = join(appRoot, "src", "mcp.ts");
    const configPath = join(directory, "home", ".cursor", "mcp.json");
    mkdirSync(join(appRoot, "src"), { recursive: true });
    mkdirSync(join(directory, "home", ".cursor"), { recursive: true });
    writeFileSync(expectedEntry, "export {};\n");
    writeFileSync(configPath, JSON.stringify({ mcpServers: {
      existing: { command: "example" },
      learndeck: { command: process.execPath, args: [join(directory, "moved", "src", "mcp.ts")] },
    } }));
    const service = new IntegrationService(appRoot, { homeDirectory: join(directory, "home") });

    const stale = (await service.list()).find((item) => item.id === "cursor");
    expect(stale?.status).toBe("stale");
    expect(stale?.explanation).toContain(configPath);
    expect(stale?.explanation).toContain("moved/src/mcp.ts");

    await service.connect("cursor");
    const repaired = JSON.parse(await Bun.file(configPath).text());
    expect(repaired.mcpServers.learndeck.args).toEqual([expectedEntry]);
    expect((await service.list()).find((item) => item.id === "cursor")?.status).toBe("connected");
  });

  test("disconnect removes only LearnDeck's Cursor entry", async () => {
    const configPath = join(directory, "home", ".cursor", "mcp.json");
    mkdirSync(join(directory, "home", ".cursor"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: {
      existing: { command: "keep-me" },
      another: { command: "also-keep-me" },
      learndeck: { command: process.execPath, args: ["/old/src/mcp.ts"] },
    } }));
    const service = new IntegrationService(join(directory, "app"), { homeDirectory: join(directory, "home") });

    const result = await service.disconnect("cursor");
    const configuration = JSON.parse(await Bun.file(configPath).text());
    expect(result).toMatchObject({ integrationId: "cursor", configPath, removed: true });
    expect(configuration.mcpServers).toEqual({
      existing: { command: "keep-me" },
      another: { command: "also-keep-me" },
    });
  });

  test("resets exactly one path's progress, attempts, and evidence", () => {
    const course = catalog.get("example-course");
    const first = store.createPath(course, { coursePathId: "default", workspacePath: "/work/first" });
    const second = store.createPath(course, { coursePathId: "default", workspacePath: "/work/second" });
    const attempt = store.submitAnswer(course, {
      pathId: first.id,
      questionId: "start-boundary",
      answer: "The course boundary is separate from the learner workspace.",
    });
    store.evaluateAttempt(course, {
      attemptId: attempt.id,
      result: "correct",
      feedback: "The boundary is clear and the next step is to make it observable.",
      evidence: "Recorded the boundary in the project notes.",
    });

    const result = store.resetPath(first.id);
    expect(result).toEqual({ pathId: first.id, attempts: 1, evidence: 1, progressRows: course.sections.length });
    expect(() => store.getPath(first.id)).toThrow();
    expect(store.overview(course, second.id).attempts).toHaveLength(0);
    expect(store.overview(course, second.id).progress.every((item) => item.status === "not_started")).toBe(true);
  });

  test("exports a submitted attempt with the learner's path record", async () => {
    const course = catalog.get("example-course");
    const path = store.createPath(course, { coursePathId: "default", workspacePath: "/work/exported" });
    const app = await createApp(store, catalog, new IntegrationService(join(directory, "app"), {
      homeDirectory: join(directory, "home"),
      findExecutable: () => undefined,
    }));
    const submission = await app(new Request("http://learndeck.test/api/attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathId: path.id, questionId: "start-boundary", answer: "The course runner owns learning state; the workspace owns the application." }),
    }));
    expect(submission.status).toBe(201);

    const response = await app(new Request(`http://learndeck.test/api/paths/${path.id}/export`));
    const exported = await response.json() as {
      course: { id: string; title: string };
      path: { id: string; workspacePath: string };
      progress: unknown[];
      attempts: Array<{ questionId: string; answer: string; result: string; submittedAt: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="learndeck-${path.id}.json"`);
    expect(exported.course).toEqual({ id: course.id, title: course.title });
    expect(exported.path).toMatchObject({ id: path.id, workspacePath: "/work/exported" });
    expect(exported.progress).toHaveLength(course.sections.length);
    expect(exported.attempts).toContainEqual(expect.objectContaining({
      questionId: "start-boundary",
      answer: "The course runner owns learning state; the workspace owns the application.",
      result: "submitted",
    }));
    expect(exported.attempts[0].submittedAt).toBeString();
  });
});
