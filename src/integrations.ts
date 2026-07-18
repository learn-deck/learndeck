import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

export type IntegrationId = "claude-code" | "codex" | "cursor";

export interface AgentIntegration {
  id: IntegrationId;
  label: string;
  detected: boolean;
  configured: boolean;
  configPath: string;
  nextStep: string;
}

type Runner = (command: string, args: string[]) => Promise<{ exitCode: number; stderr: string }>;

interface IntegrationOptions {
  homeDirectory?: string;
  operatingSystem?: string;
  findExecutable?: (name: string) => string | undefined;
  run?: Runner;
}

const APP_NAME = "learndeck";

export class IntegrationService {
  private readonly homeDirectory: string;
  private readonly operatingSystem: string;
  private readonly findExecutable: (name: string) => string | undefined;
  private readonly run: Runner;

  constructor(readonly root = resolve(import.meta.dir, ".."), options: IntegrationOptions = {}) {
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.operatingSystem = options.operatingSystem ?? platform();
    this.findExecutable = options.findExecutable ?? ((name) => Bun.which(name) ?? undefined);
    this.run = options.run ?? runCommand;
  }

  async list(): Promise<AgentIntegration[]> {
    return Promise.all([this.describeCodex(), this.describeCursor(), this.describeClaudeCode()]);
  }

  async connect(id: IntegrationId): Promise<AgentIntegration> {
    if (id === "codex") return this.connectCodex();
    if (id === "claude-code") return this.connectClaudeCode();
    if (id === "cursor") return this.connectCursor();
    throw new Error(`Unsupported agent integration: ${id}`);
  }

  private async describeCodex(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".codex", "config.toml");
    const configured = hasTomlServer(await readText(configPath), APP_NAME);
    const executable = this.findExecutable("codex");
    const appDetected = this.hasMacApplication("Codex.app");
    return {
      id: "codex",
      label: "Codex",
      detected: Boolean(executable) || appDetected || existsSync(dirname(configPath)) || configured,
      configured,
      configPath,
      nextStep: configured ? "Restart Codex, then ask it to use LearnDeck." : "Open Codex once or install its command-line launcher, then connect it here.",
    };
  }

  private async describeClaudeCode(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".claude.json");
    const configured = hasJsonServer(await readJson(configPath));
    const executable = this.findExecutable("claude");
    return {
      id: "claude-code",
      label: "Claude Code",
      detected: Boolean(executable) || configured,
      configured,
      configPath,
      nextStep: configured ? "Open or restart Claude Code, then ask it to use LearnDeck." : "Install or expose the Claude Code CLI, then connect it here.",
    };
  }

  private async describeCursor(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".cursor", "mcp.json");
    const configured = hasJsonServer(await readJson(configPath));
    const executable = this.findExecutable("cursor") ?? this.findExecutable("cursor-agent");
    return {
      id: "cursor",
      label: "Cursor",
      detected: Boolean(executable) || this.hasMacApplication("Cursor.app") || existsSync(dirname(configPath)) || configured,
      configured,
      configPath,
      nextStep: configured ? "Restart Cursor, then use Agent chat to begin LearnDeck." : "Open Cursor once or install its command-line launcher, then connect it here.",
    };
  }

  private async connectCodex() {
    const existing = await this.describeCodex();
    if (existing.configured) return existing;
    const executable = this.findExecutable("codex");
    if (!executable) throw new Error("Codex was detected but its CLI is unavailable. Enable its command-line launcher, then try again.");
    const result = await this.run(executable, ["mcp", "add", APP_NAME, "--", process.execPath, this.mcpEntry()]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Codex could not add LearnDeck. Check the Codex CLI and try again.");
    return { ...existing, configured: true, nextStep: "Restart or open Codex, then ask it to use LearnDeck." };
  }

  private async connectClaudeCode() {
    const existing = await this.describeClaudeCode();
    if (existing.configured) return existing;
    const executable = this.findExecutable("claude");
    if (!executable) throw new Error("Claude Code was detected but its CLI is unavailable. Make `claude` available on PATH, then try again.");
    const result = await this.run(executable, ["mcp", "add", "--scope", "user", "--transport", "stdio", APP_NAME, "--", process.execPath, this.mcpEntry()]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Claude Code could not add LearnDeck. Check the Claude Code CLI and try again.");
    return { ...existing, configured: true, nextStep: "Restart or open Claude Code, then ask it to use LearnDeck." };
  }

  private async connectCursor() {
    const existing = await this.describeCursor();
    if (existing.configured) return existing;
    if (!existing.detected) throw new Error("Cursor was not detected. Open Cursor once or install its command-line launcher, then try again.");

    const configuration = (await readJson(existing.configPath)) ?? {};
    if (!isRecord(configuration)) throw new Error("Cursor's MCP configuration is not a JSON object. Repair it in Cursor before connecting LearnDeck.");
    const mcpServers = configuration.mcpServers;
    if (mcpServers !== undefined && !isRecord(mcpServers)) throw new Error("Cursor's mcpServers entry is not a JSON object. Repair it in Cursor before connecting LearnDeck.");
    configuration.mcpServers = { ...(mcpServers ?? {}), [APP_NAME]: this.mcpConfiguration() };
    await mkdir(dirname(existing.configPath), { recursive: true });
    await writeFile(existing.configPath, `${JSON.stringify(configuration, null, 2)}\n`);
    return { ...(await this.describeCursor()), configured: true, nextStep: "Restart Cursor, then use Agent chat to begin LearnDeck." };
  }

  private hasMacApplication(name: string) {
    return this.operatingSystem === "darwin" && [join("/Applications", name), join(this.homeDirectory, "Applications", name)].some(existsSync);
  }

  private mcpEntry() {
    return join(this.root, "src", "mcp.ts");
  }

  private mcpConfiguration() {
    return { command: process.execPath, args: [this.mcpEntry()] };
  }
}

export function isIntegrationId(value: string): value is IntegrationId {
  return value === "codex" || value === "claude-code" || value === "cursor";
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${path} as JSON.`);
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${path}.`);
  }
}

function hasJsonServer(configuration: Record<string, unknown> | undefined) {
  return Boolean(isRecord(configuration?.mcpServers) && configuration.mcpServers[APP_NAME]);
}

function hasTomlServer(configuration: string | undefined, name: string) {
  return Boolean(configuration?.match(new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegExp(name)}\\]\\s*$`, "m")));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runCommand(command: string, args: string[]) {
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { exitCode, stderr: stderr.trim() };
}
