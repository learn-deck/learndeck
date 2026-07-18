import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

export type IntegrationId = "claude-code" | "cursor";

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
    return Promise.all([this.describeClaudeCode(), this.describeCursor()]);
  }

  async connect(id: IntegrationId): Promise<AgentIntegration> {
    if (id === "claude-code") return this.connectClaudeCode();
    if (id === "cursor") return this.connectCursor();
    throw new Error(`Unsupported agent integration: ${id}`);
  }

  private async describeClaudeCode(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".claude.json");
    const configured = hasServer(await readJson(configPath));
    const executable = this.findExecutable("claude");
    return {
      id: "claude-code",
      label: "Claude Code",
      detected: Boolean(executable) || configured,
      configured,
      configPath,
      nextStep: configured ? "Open or restart Claude Code, then ask it to use PatchQuest." : "Install or expose the Claude Code CLI, then connect it here.",
    };
  }

  private async describeCursor(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".cursor", "mcp.json");
    const configured = hasServer(await readJson(configPath));
    const executable = this.findExecutable("cursor") ?? this.findExecutable("cursor-agent");
    const appDetected = this.operatingSystem === "darwin" && ["/Applications/Cursor.app", join(this.homeDirectory, "Applications", "Cursor.app")].some(existsSync);
    return {
      id: "cursor",
      label: "Cursor",
      detected: Boolean(executable) || appDetected || existsSync(dirname(configPath)) || configured,
      configured,
      configPath,
      nextStep: configured ? "Restart Cursor, then use Agent chat to begin PatchQuest." : "Open Cursor once or install its command-line launcher, then connect it here.",
    };
  }

  private async connectClaudeCode() {
    const existing = await this.describeClaudeCode();
    if (existing.configured) return existing;
    const executable = this.findExecutable("claude");
    if (!executable) throw new Error("Claude Code was not detected. Install its CLI, make `claude` available on PATH, then try again.");

    const result = await this.run(executable, ["mcp", "add", "--scope", "user", "--transport", "stdio", "patchquest", "--", process.execPath, this.mcpEntry()]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Claude Code could not add PatchQuest. Check the Claude Code CLI and try again.");
    const connected = await this.describeClaudeCode();
    return { ...connected, configured: true, nextStep: "Restart or open Claude Code, then ask it to use PatchQuest." };
  }

  private async connectCursor() {
    const existing = await this.describeCursor();
    if (existing.configured) return existing;
    if (!existing.detected) throw new Error("Cursor was not detected. Open Cursor once or install its command-line launcher, then try again.");

    const configuration = (await readJson(existing.configPath)) ?? {};
    if (!isRecord(configuration)) throw new Error("Cursor's MCP configuration is not a JSON object. Repair it in Cursor before connecting PatchQuest.");
    const mcpServers = configuration.mcpServers;
    if (mcpServers !== undefined && !isRecord(mcpServers)) throw new Error("Cursor's mcpServers entry is not a JSON object. Repair it in Cursor before connecting PatchQuest.");
    configuration.mcpServers = { ...(mcpServers ?? {}), patchquest: this.mcpConfiguration() };
    await mkdir(dirname(existing.configPath), { recursive: true });
    await writeFile(existing.configPath, `${JSON.stringify(configuration, null, 2)}\n`);
    return { ...(await this.describeCursor()), configured: true, nextStep: "Restart Cursor, then use Agent chat to begin PatchQuest." };
  }

  private mcpEntry() {
    return join(this.root, "src", "mcp.ts");
  }

  private mcpConfiguration() {
    return { command: process.execPath, args: [this.mcpEntry()] };
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${path} as JSON.`);
  }
}

function hasServer(configuration: Record<string, unknown> | undefined) {
  return Boolean(isRecord(configuration?.mcpServers) && configuration.mcpServers.patchquest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runCommand(command: string, args: string[]) {
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { exitCode, stderr: stderr.trim() };
}
