import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { IntegrationService } from "../src/integrations";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

type CatalogueProvenance = {
  source: "bundled" | "live" | "cached";
  repository: string | null;
  syncedAt: string | null;
  warning: string | null;
};

describe("first-hour regression: course provenance", () => {
  test("reports bundled provenance when the local course pack is used", async () => {
    const directory = mkdtempSync(join(tmpdir(), "learndeck-regression-bundled-"));
    const store = new CourseStore(join(directory, "progress.db"));

    try {
      const catalog = await CourseCatalog.load();
      const app = await createApp(
        store,
        catalog,
        new IntegrationService(join(directory, "learndeck"), { homeDirectory: join(directory, "home"), operatingSystem: "linux" }),
      );
      const response = await app(new Request("http://learndeck.test/api/bootstrap", { method: "POST" }));
      expect(response.status).toBe(200);
      const body = await response.json() as { catalogue: CatalogueProvenance };

      expect(body.catalogue).toMatchObject({
        source: "bundled",
        repository: null,
        syncedAt: null,
        warning: null,
      });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("reports cached provenance and a warning after sync fails over a complete cache", async () => {
    const directory = mkdtempSync(join(tmpdir(), "learndeck-regression-cached-"));
    const databasePath = join(directory, "progress.db");
    const previousRepository = process.env.LEARNDECK_COURSE_REPOSITORY;
    const previousCache = process.env.LEARNDECK_COURSE_CACHE_DIR;
    const fetchBeforeTest = globalThis.fetch;
    const files: Record<string, string> = {
      "courses/provenance-course/course.md": [
        "---",
        "schemaVersion: 1",
        "id: provenance-course",
        "title: Provenance Course",
        "description: A deterministic course used to exercise catalogue provenance.",
        "category: Testing",
        "tags: []",
        "overview:",
        "  duration: 20 minutes",
        "  sessionLength: 20 minutes",
        "  level: Beginner",
        "  outcomes:",
        "    - Distinguish a live catalogue from a cache.",
        "  prerequisites:",
        "    - A test runner.",
        "paths:",
        "  - id: default",
        "    label: Default",
        "---",
        "# Provenance Course",
        "",
      ].join("\n"),
      "courses/provenance-course/modules/00-orient.md": [
        "---",
        "id: orient",
        "title: Orient",
        "goal: See catalogue provenance.",
        "action: Read the loaded course.",
        "sources:",
        "  - ./00-orient.md",
        "questions:",
        "  - id: orient-question",
        "    kind: diagnostic",
        "    prompt: Which catalogue did you load?",
        "    reference: ./00-orient.md",
        "    rubric:",
        "      - Names the loaded provenance course.",
        "---",
        "# Orient",
        "",
      ].join("\n"),
    };
    const store = new CourseStore(databasePath);

    try {
      process.env.LEARNDECK_COURSE_REPOSITORY = "github:learn-deck/provenance@main";
      process.env.LEARNDECK_COURSE_CACHE_DIR = directory;

      // CourseCatalog exposes no injected sync implementation. Use its existing
      // fetch seam only to create a complete on-disk cache; this test deliberately
      // does not fake or assert a live-network provenance result.
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes("api.github.com")) {
          return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
        }
        const path = Object.keys(files).find((candidate) => url.endsWith("/" + candidate));
        return path ? new Response(files[path]) : new Response("not found", { status: 404 });
      };
      await CourseCatalog.loadConfigured();

      globalThis.fetch = async () => new Response("offline", { status: 503 });
      const cachedCatalog = await CourseCatalog.loadConfigured();
      const app = await createApp(
        store,
        cachedCatalog,
        new IntegrationService(join(directory, "learndeck"), { homeDirectory: join(directory, "home"), operatingSystem: "linux" }),
      );
      const response = await app(new Request("http://learndeck.test/api/bootstrap", { method: "POST" }));
      expect(response.status).toBe(200);
      const body = await response.json() as {
        courses: Array<{ id: string }>;
        catalogue: CatalogueProvenance;
      };

      expect(body.catalogue.source).toBe("cached");
      expect(body.catalogue.warning).toBeString();
      expect(body.catalogue.warning?.trim()).not.toBe("");
      expect(body.courses.map((course) => course.id)).toContain("provenance-course");
    } finally {
      globalThis.fetch = fetchBeforeTest;
      if (previousRepository === undefined) delete process.env.LEARNDECK_COURSE_REPOSITORY;
      else process.env.LEARNDECK_COURSE_REPOSITORY = previousRepository;
      if (previousCache === undefined) delete process.env.LEARNDECK_COURSE_CACHE_DIR;
      else process.env.LEARNDECK_COURSE_CACHE_DIR = previousCache;
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
