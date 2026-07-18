import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IntegrationService } from "../src/integrations";

describe("IntegrationService", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "patchquest-integrations-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test("writes one LearnDeck entry into Cursor's global MCP configuration", async () => {
    const configPath = join(directory, ".cursor", "mcp.json");
    mkdirSync(join(directory, ".cursor"));
    writeFileSync(configPath, JSON.stringify({ mcpServers: { existing: { command: "example" } } }));
    const service = new IntegrationService("/opt/patchquest", {
      homeDirectory: directory,
      findExecutable: (name) => name === "cursor" ? "/usr/local/bin/cursor" : undefined,
    });

    const before = (await service.list()).find((item) => item.id === "cursor");
    expect(before?.detected).toBe(true);
    expect(before?.configured).toBe(false);

    const connected = await service.connect("cursor");
    const configuration = JSON.parse(await Bun.file(configPath).text());
    expect(connected.configured).toBe(true);
    expect(configuration.mcpServers.existing.command).toBe("example");
    expect(configuration.mcpServers.learndeck).toEqual({ command: process.execPath, args: ["/opt/patchquest/src/mcp.ts"] });
  });

  test("uses Claude Code's user-scope MCP command only after connect is requested", async () => {
    let invocation: { command: string; args: string[] } | undefined;
    const service = new IntegrationService("/opt/patchquest", {
      homeDirectory: directory,
      findExecutable: (name) => name === "claude" ? "/usr/local/bin/claude" : undefined,
      run: async (command, args) => {
        invocation = { command, args };
        return { exitCode: 0, stderr: "" };
      },
    });

    expect((await service.list()).find((item) => item.id === "claude-code")?.configured).toBe(false);
    expect(await service.connect("claude-code")).toMatchObject({ configured: true });
    expect(invocation).toEqual({
      command: "/usr/local/bin/claude",
      args: ["mcp", "add", "--scope", "user", "--transport", "stdio", "learndeck", "--", process.execPath, "/opt/patchquest/src/mcp.ts"],
    });
  });

  test("detects configured Codex and uses its documented MCP command only after connect", async () => {
    const configDirectory = join(directory, ".codex");
    mkdirSync(configDirectory);
    const configPath = join(configDirectory, "config.toml");
    writeFileSync(configPath, "[mcp_servers.learndeck]\ncommand = 'bun'\n");
    const configured = new IntegrationService("/opt/patchquest", { homeDirectory: directory });
    expect((await configured.list()).find((item) => item.id === "codex")).toMatchObject({ detected: true, configured: true, configPath });

    let invocation: { command: string; args: string[] } | undefined;
    const service = new IntegrationService("/opt/patchquest", {
      homeDirectory: join(directory, "new-home"),
      findExecutable: (name) => name === "codex" ? "/usr/local/bin/codex" : undefined,
      run: async (command, args) => {
        invocation = { command, args };
        return { exitCode: 0, stderr: "" };
      },
    });
    expect(await service.connect("codex")).toMatchObject({ configured: true });
    expect(invocation).toEqual({
      command: "/usr/local/bin/codex",
      args: ["mcp", "add", "learndeck", "--", process.execPath, "/opt/patchquest/src/mcp.ts"],
    });
  });
});
