import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

const originalRepository = process.env.LEARNDECK_COURSE_REPOSITORY;
const originalCacheDirectory = process.env.LEARNDECK_COURSE_CACHE_DIR;
const originalFetch = globalThis.fetch;

afterEach(() => {
  restoreEnvironment("LEARNDECK_COURSE_REPOSITORY", originalRepository);
  restoreEnvironment("LEARNDECK_COURSE_CACHE_DIR", originalCacheDirectory);
  globalThis.fetch = originalFetch;
});

describe("catalogue provenance", () => {
  test("reports a bundled catalogue when no repository is configured", async () => {
    delete process.env.LEARNDECK_COURSE_REPOSITORY;
    const catalog = await CourseCatalog.load();
    const directory = mkdtempSync(join(tmpdir(), "learndeck-provenance-bootstrap-"));
    const store = new CourseStore(join(directory, "progress.db"));

    try {
      const expected = {
        source: "bundled",
        repository: null,
        syncedAt: null,
        warning: null,
      };
      expect(catalog.catalogue).toEqual(expected);
      const app = await createApp(store, catalog);
      const bootstrap = await app(new Request("http://learndeck.test/api/bootstrap", { method: "POST" }));
      expect((await bootstrap.json()).catalogue).toEqual(expected);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("reports a cached catalogue and warning after a failed sync", async () => {
    const directory = mkdtempSync(join(tmpdir(), "learndeck-provenance-cache-"));
    const files: Record<string, string> = {
      "courses/remote-foundations/course.md": [
        "---",
        "schemaVersion: 1",
        "id: remote-foundations",
        "title: Remote Foundations",
        "description: A remote test course.",
        "category: Engineering",
        "tags: []",
        "overview:",
        "  duration: 20 minutes",
        "  sessionLength: 20 minutes",
        "  level: Beginner",
        "  outcomes:",
        "    - Test catalogue provenance.",
        "  prerequisites:",
        "    - Curiosity.",
        "paths:",
        "  - id: default",
        "    label: Default",
        "    serverCommand: bun run app",
        "    testCommand: bun test",
        "    workspaceHint: A workspace",
        "---",
        "# Remote Foundations",
      ].join("\n"),
      "courses/remote-foundations/modules/00-orient.md": [
        "---",
        "id: orient",
        "title: Orient",
        "goal: Test the cache.",
        "action: Read this module.",
        "sources:",
        "  - ./00-orient.md",
        "questions:",
        "  - id: orient-question",
        "    kind: diagnostic",
        "    prompt: What loaded?",
        "    reference: ./00-orient.md",
        "    rubric:",
        "      - Names the remote course.",
        "---",
        "# Orient",
      ].join("\n"),
    };
    const repository = "github:learn-deck/courses@main";
    process.env.LEARNDECK_COURSE_REPOSITORY = repository;
    process.env.LEARNDECK_COURSE_CACHE_DIR = directory;
    try {
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes("api.github.com")) {
          return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
        }
        const path = Object.keys(files).find((candidate) => url.endsWith(`/${candidate}`));
        return path ? new Response(files[path]) : new Response("not found", { status: 404 });
      };
      const live = await CourseCatalog.loadConfigured();
      expect(live.catalogue.source).toBe("live");
      expect(live.catalogue.repository).toBe(repository);
      expect(live.catalogue.syncedAt).toEqual(expect.any(String));
      expect(live.catalogue.warning).toBeNull();

      globalThis.fetch = async () => new Response("offline", { status: 503 });
      const cached = await CourseCatalog.loadConfigured();
      expect(cached.catalogue).toEqual({
        source: "cached",
        repository,
        syncedAt: live.catalogue.syncedAt,
        warning: `Showing the last complete download from ${live.catalogue.syncedAt}. GitHub sync failed.`,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("workspace path contract", () => {
  test("rejects relative workspace paths", async () => {
    const directory = mkdtempSync(join(tmpdir(), "learndeck-provenance-relative-"));
    const store = new CourseStore(join(directory, "progress.db"));
    try {
      const app = await createApp(store, await CourseCatalog.load());
      const response = await createPath(app, "relative/workspace");
      const body = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toContain("relative/workspace");
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a workspace whose parent does not exist", async () => {
    const directory = mkdtempSync(join(tmpdir(), "learndeck-provenance-parent-"));
    const store = new CourseStore(join(directory, "progress.db"));
    const workspacePath = join(directory, "missing-parent", "workspace");
    try {
      const app = await createApp(store, await CourseCatalog.load());
      const response = await createPath(app, workspacePath);
      const body = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toContain(workspacePath);
      expect(existsSync(workspacePath)).toBe(false);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("creates a new workspace directory inside an existing parent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "learndeck-provenance-workspace-"));
    const parent = join(directory, "parent");
    const workspacePath = join(parent, "workspace");
    mkdirSync(parent);
    const store = new CourseStore(join(directory, "progress.db"));
    try {
      const app = await createApp(store, await CourseCatalog.load());
      const response = await createPath(app, workspacePath);
      const body = await response.json() as { id: string; workspaceCreated: boolean };

      expect(response.status).toBe(201);
      expect(body.id).toEqual(expect.any(String));
      expect(body.workspaceCreated).toBe(true);
      expect(existsSync(workspacePath)).toBe(true);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function createPath(app: Awaited<ReturnType<typeof createApp>>, workspacePath: string) {
  return app(new Request("http://learndeck.test/api/courses/ddd-backend-foundations/paths", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ coursePathId: "node-typescript", workspacePath }),
  }));
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
