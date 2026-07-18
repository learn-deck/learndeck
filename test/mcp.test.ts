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
    env: { ...process.env, PATCHQUEST_DB_PATH: join(directory, "progress.db") },
  });
  const client = new Client({ name: "patchquest-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "patchquest_get_course",
      "patchquest_list_paths",
      "patchquest_create_path",
      "patchquest_get_progress",
      "patchquest_get_next_activity",
      "patchquest_record_evidence",
      "patchquest_evaluate_answer",
    ]);
    const course = await client.callTool({ name: "patchquest_get_course", arguments: {} });
    expect(course.isError).toBeFalsy();
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);
