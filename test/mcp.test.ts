import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("MCP exposes the learner-guidance tools over stdio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "patchquest-mcp-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dir, "../src/mcp.ts")],
    cwd: resolve(import.meta.dir, ".."),
    env: { ...process.env, LEARNDECK_DB_PATH: join(directory, "progress.db") },
  });
  const client = new Client({ name: "learndeck-test", version: "0.4.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "learndeck_list_courses",
      "learndeck_get_course",
      "learndeck_list_paths",
      "learndeck_create_path",
      "learndeck_get_progress",
      "learndeck_get_next_activity",
      "learndeck_record_evidence",
      "learndeck_evaluate_answer",
    ]);
    const courses = await client.callTool({ name: "learndeck_list_courses", arguments: {} });
    expect(courses.isError).toBeFalsy();
    expect(JSON.stringify(courses.structuredContent)).toContain("ddd-backend-foundations");
    const course = await client.callTool({ name: "learndeck_get_course", arguments: { courseId: "ddd-backend-foundations" } });
    expect(course.isError).toBeFalsy();
    expect(JSON.stringify(course.structuredContent)).toContain("rubric");
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);
