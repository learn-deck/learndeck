import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";
import { IntegrationService } from "../src/integrations";
import { createApp } from "../src/server";
import { CourseStore } from "../src/store";

describe("first-hour regression: solo guide state", () => {
  test("connects and disconnects one detected guide without losing course or path data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "learndeck-regression-solo-"));
    const databasePath = join(directory, "progress.db");
    const homeDirectory = join(directory, "home");
    const configPath = join(homeDirectory, ".cursor", "mcp.json");
    const catalog = await CourseCatalog.load();
    const course = catalog.get("example-course");
    const store = new CourseStore(databasePath);

    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { existing: { command: "keep-me" } } }));

    const app = await createApp(
      store,
      catalog,
      new IntegrationService(join(directory, "learndeck"), {
        homeDirectory,
        operatingSystem: "linux",
        findExecutable: (name) => name === "cursor" ? "/usr/local/bin/cursor" : undefined,
      }),
    );

    try {
      const integrationsResponse = await app(new Request("http://learndeck.test/api/integrations"));
      expect(integrationsResponse.status).toBe(200);
      const integrations = await integrationsResponse.json() as Array<{
        id: string;
        configured: boolean;
        status: string;
      }>;
      expect(integrations.find((item) => item.id === "cursor")).toMatchObject({
        configured: false,
        status: "detected",
      });

      const pathResponse = await app(new Request(
        "http://learndeck.test/api/courses/" + encodeURIComponent(course.id) + "/paths",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            coursePathId: course.paths[0].id,
            workspacePath: join(directory, "existing-workspace"),
            label: "Existing first-hour workspace",
          }),
        },
      ));
      expect(pathResponse.status).toBe(201);
      const path = await pathResponse.json() as { id: string };

      const connectResponse = await app(new Request("http://learndeck.test/api/integrations/cursor/connect", { method: "POST" }));
      expect(connectResponse.status).toBe(200);
      const connected = await connectResponse.json() as { configPath: string };
      expect(connected.configPath).toBe(configPath);

      const connectedConfiguration = JSON.parse(readFileSync(configPath, "utf8")) as {
        mcpServers: Record<string, unknown>;
      };
      expect(Object.keys(connectedConfiguration.mcpServers).filter((name) => name === "learndeck")).toHaveLength(1);
      expect(connectedConfiguration.mcpServers.existing).toEqual({ command: "keep-me" });

      const disconnectResponse = await app(new Request("http://learndeck.test/api/integrations/cursor/connect", { method: "DELETE" }));
      expect(disconnectResponse.status).toBe(200);
      const disconnected = await disconnectResponse.json() as {
        configPath: string;
        removed: boolean;
        message: string;
      };
      expect(disconnected).toMatchObject({ configPath, removed: true });
      expect(disconnected.message).toContain(configPath);

      const disconnectedConfiguration = JSON.parse(readFileSync(configPath, "utf8")) as {
        mcpServers: Record<string, unknown>;
      };
      expect(disconnectedConfiguration.mcpServers).toEqual({ existing: { command: "keep-me" } });

      const afterDisconnect = await app(new Request("http://learndeck.test/api/integrations"));
      const cursorAfterDisconnect = (await afterDisconnect.json() as Array<{
        id: string;
        configured: boolean;
        status: string;
      }>).find((item) => item.id === "cursor");
      expect(cursorAfterDisconnect).toMatchObject({ configured: false, status: "detected" });

      const courseResponse = await app(new Request("http://learndeck.test/api/courses/" + encodeURIComponent(course.id)));
      expect(courseResponse.status).toBe(200);
      const loadedCourse = await courseResponse.json() as typeof course;
      expect(loadedCourse.id).toBe(course.id);
      expect(loadedCourse.sections.length).toBe(course.sections.length);
      expect(loadedCourse.sections[0].content).toBeString();

      const overviewResponse = await app(new Request("http://learndeck.test/api/paths/" + encodeURIComponent(path.id) + "/overview"));
      expect(overviewResponse.status).toBe(200);
      const overview = await overviewResponse.json() as {
        path: { id: string };
        progress: unknown[];
      };
      expect(overview.path.id).toBe(path.id);
      expect(overview.progress).toHaveLength(course.sections.length);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
