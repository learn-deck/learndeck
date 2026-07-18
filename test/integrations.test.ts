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

  test("reports a connected Codex when its TOML entry points at the current script", async () => {
    const appRoot = join(directory, "app");
    const expectedEntry = join(appRoot, "src", "mcp.ts");
    mkdirSync(join(appRoot, "src"), { recursive: true });
    writeFileSync(expectedEntry, "export {};\n");
    mkdirSync(join(directory, ".codex"));
    writeFileSync(
      join(directory, ".codex", "config.toml"),
      `[mcp_servers.learndeck]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(expectedEntry)}]\n`,
    );
    const service = new IntegrationService(appRoot, { homeDirectory: directory });

    expect((await service.list()).find((item) => item.id === "codex")).toMatchObject({
      configured: true,
      status: "connected",
    });
  });

  test("disconnect removes only LearnDeck's Codex TOML block", async () => {
    const configPath = join(directory, ".codex", "config.toml");
    mkdirSync(join(directory, ".codex"));
    writeFileSync(configPath, [
      "[model]",
      'name = "gpt"',
      "",
      "[mcp_servers.learndeck]",
      'command = "/usr/bin/bun"',
      'args = ["/opt/x/src/mcp.ts"]',
      "",
      "[mcp_servers.other]",
      'command = "keep-me"',
      "",
    ].join("\n"));
    const service = new IntegrationService("/opt/patchquest", { homeDirectory: directory });

    const result = await service.disconnect("codex");
    const configuration = await Bun.file(configPath).text();
    expect(result).toMatchObject({ integrationId: "codex", configPath, removed: true });
    expect(configuration).toContain("[model]");
    expect(configuration).toContain('name = "gpt"');
    expect(configuration).toContain("[mcp_servers.other]");
    expect(configuration).toContain('command = "keep-me"');
    expect(configuration).not.toContain("learndeck");
    expect(configuration).not.toContain('command = "/usr/bin/bun"');
    expect(configuration).not.toContain("/opt/x/src/mcp.ts");
  });

  test("repairing a stale Codex entry rewrites only LearnDeck's block", async () => {
    const appRoot = join(directory, "app");
    const expectedEntry = join(appRoot, "src", "mcp.ts");
    mkdirSync(join(appRoot, "src"), { recursive: true });
    writeFileSync(expectedEntry, "export {};\n");
    const configPath = join(directory, ".codex", "config.toml");
    mkdirSync(join(directory, ".codex"));
    writeFileSync(configPath, [
      "[model]",
      'name = "gpt"',
      "",
      "[mcp_servers.learndeck]",
      'command = "/usr/bin/bun"',
      'args = ["/moved/src/mcp.ts"]',
      "",
    ].join("\n"));
    const service = new IntegrationService(appRoot, { homeDirectory: directory });

    expect((await service.list()).find((item) => item.id === "codex")?.status).toBe("stale");
    await service.connect("codex");

    const configuration = await Bun.file(configPath).text();
    expect(configuration).toContain("[model]");
    expect(configuration).toContain('name = "gpt"');
    expect(configuration.match(/\[mcp_servers\.learndeck\]/g)).toHaveLength(1);
    expect(configuration).toContain(JSON.stringify(expectedEntry));
    expect(configuration).not.toContain("/moved/src/mcp.ts");
    expect((await service.list()).find((item) => item.id === "codex")?.status).toBe("connected");
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
