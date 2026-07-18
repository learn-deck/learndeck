import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type IntegrationId = "claude-code" | "codex" | "cursor";
export type IntegrationStatus = "connected" | "stale" | "detected" | "not_found";

export interface AgentIntegration {
  id: IntegrationId;
  label: string;
  detected: boolean;
  configured: boolean;
  status: IntegrationStatus;
  configPath: string;
  nextStep: string;
  explanation?: string;
}

export interface IntegrationDisconnect {
  integrationId: IntegrationId;
  configPath: string;
  removed: boolean;
  message: string;
}

export class IntegrationError extends Error {
  constructor(
    readonly integrationId: IntegrationId,
    readonly configPath: string,
    message: string,
    readonly userAction: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
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

  constructor(readonly root = resolve(process.env.LEARNDECK_ROOT ?? resolve(import.meta.dir, "..")), options: IntegrationOptions = {}) {
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.operatingSystem = options.operatingSystem ?? platform();
    this.findExecutable = options.findExecutable ?? ((name) => Bun.which(name) ?? undefined);
    this.run = options.run ?? runCommand;
  }

  async list(): Promise<AgentIntegration[]> {
    return Promise.all([this.describeCodex(), this.describeCursor(), this.describeClaudeCode()]);
  }

  async connect(id: IntegrationId): Promise<AgentIntegration> {
    try {
      if (id === "codex") return await this.connectCodex();
      if (id === "claude-code") return await this.connectClaudeCode();
      if (id === "cursor") return await this.connectCursor();
      throw new Error(`Unsupported agent integration: ${id}`);
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw this.connectionError(id, "add or repair LearnDeck's own MCP entry", error);
    }
  }

  async disconnect(id: IntegrationId): Promise<IntegrationDisconnect> {
    try {
      if (id === "codex") return await this.disconnectCodex();
      if (id === "claude-code") return await this.disconnectJson(id, join(this.homeDirectory, ".claude.json"));
      if (id === "cursor") return await this.disconnectJson(id, join(this.homeDirectory, ".cursor", "mcp.json"));
      throw new Error(`Unsupported agent integration: ${id}`);
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw this.connectionError(id, "remove only LearnDeck's own MCP entry", error);
    }
  }

  private async describeCodex(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".codex", "config.toml");
    const configuration = await readText(configPath);
    const configured = hasTomlServer(configuration, APP_NAME);
    const executable = this.findExecutable("codex");
    const appDetected = this.hasMacApplication("Codex.app");
    const detected = Boolean(executable) || appDetected || existsSync(dirname(configPath)) || configured;
    return describeIntegration("codex", "Codex", detected, configured, configPath, this.mcpEntry(), extractTomlMcpPath(configuration, APP_NAME));
  }

  private async describeClaudeCode(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".claude.json");
    const configuration = await readJson(configPath);
    const configured = hasJsonServer(configuration);
    const executable = this.findExecutable("claude");
    const detected = Boolean(executable) || configured;
    return describeIntegration("claude-code", "Claude Code", detected, configured, configPath, this.mcpEntry(), extractJsonMcpPath(configuration));
  }

  private async describeCursor(): Promise<AgentIntegration> {
    const configPath = join(this.homeDirectory, ".cursor", "mcp.json");
    const configuration = await readJson(configPath);
    const configured = hasJsonServer(configuration);
    const executable = this.findExecutable("cursor") ?? this.findExecutable("cursor-agent");
    const detected = Boolean(executable) || this.hasMacApplication("Cursor.app") || existsSync(dirname(configPath)) || configured;
    return describeIntegration("cursor", "Cursor", detected, configured, configPath, this.mcpEntry(), extractJsonMcpPath(configuration));
  }

  private async connectCodex() {
    const existing = await this.describeCodex();
    if (existing.status === "connected") return existing;
    if (existing.status === "stale") {
      const configuration = await readText(existing.configPath);
      if (configuration === undefined) throw new Error(`The stale configuration file ${existing.configPath} disappeared before it could be repaired.`);
      await atomicWrite(existing.configPath, upsertTomlServer(configuration, APP_NAME, this.mcpConfiguration()));
      return { ...(await this.describeCodex()), nextStep: "Restart Codex, then ask it to use LearnDeck." };
    }
    const executable = this.findExecutable("codex");
    if (!executable) throw new Error("Codex was detected but its CLI is unavailable. Enable its command-line launcher, then try again.");
    const result = await this.run(executable, ["mcp", "add", APP_NAME, "--", process.execPath, this.mcpEntry()]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Codex could not add LearnDeck. Check the Codex CLI and try again.");
    return { ...existing, configured: true, status: "connected" as const, nextStep: "Restart or open Codex, then ask it to use LearnDeck." };
  }

  private async connectClaudeCode() {
    const existing = await this.describeClaudeCode();
    if (existing.status === "connected") return existing;
    if (existing.status === "stale") {
      const configuration = await readJson(existing.configPath);
      if (!isRecord(configuration)) throw new Error(`Claude Code's MCP configuration is not a JSON object. Repair ${existing.configPath} before reconnecting LearnDeck.`);
      const mcpServers = configuration.mcpServers;
      if (mcpServers !== undefined && !isRecord(mcpServers)) throw new Error(`Claude Code's mcpServers entry is not a JSON object. Repair ${existing.configPath} before reconnecting LearnDeck.`);
      configuration.mcpServers = { ...(mcpServers ?? {}), [APP_NAME]: this.mcpConfiguration() };
      await atomicWrite(existing.configPath, `${JSON.stringify(configuration, null, 2)}\n`);
      return { ...(await this.describeClaudeCode()), nextStep: "Open or restart Claude Code, then ask it to use LearnDeck." };
    }
    const executable = this.findExecutable("claude");
    if (!executable) throw new Error("Claude Code was detected but its CLI is unavailable. Make `claude` available on PATH, then try again.");
    const result = await this.run(executable, ["mcp", "add", "--scope", "user", "--transport", "stdio", APP_NAME, "--", process.execPath, this.mcpEntry()]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Claude Code could not add LearnDeck. Check the Claude Code CLI and try again.");
    return { ...existing, configured: true, status: "connected" as const, nextStep: "Restart or open Claude Code, then ask it to use LearnDeck." };
  }

  private async connectCursor() {
    const existing = await this.describeCursor();
    if (existing.status === "connected") return existing;
    if (!existing.detected) throw new Error("Cursor was not detected. Open Cursor once or install its command-line launcher, then try again.");

    const configuration = (await readJson(existing.configPath)) ?? {};
    if (!isRecord(configuration)) throw new Error("Cursor's MCP configuration is not a JSON object. Repair it in Cursor before connecting LearnDeck.");
    const mcpServers = configuration.mcpServers;
    if (mcpServers !== undefined && !isRecord(mcpServers)) throw new Error("Cursor's mcpServers entry is not a JSON object. Repair it in Cursor before connecting LearnDeck.");
    configuration.mcpServers = { ...(mcpServers ?? {}), [APP_NAME]: this.mcpConfiguration() };
    await mkdir(dirname(existing.configPath), { recursive: true });
    await atomicWrite(existing.configPath, `${JSON.stringify(configuration, null, 2)}\n`);
    return { ...(await this.describeCursor()), configured: true, nextStep: "Restart Cursor, then use Agent chat to begin LearnDeck." };
  }

  private async disconnectCodex(): Promise<IntegrationDisconnect> {
    const configPath = join(this.homeDirectory, ".codex", "config.toml");
    const configuration = await readText(configPath);
    if (configuration === undefined || !hasTomlServer(configuration, APP_NAME)) {
      return { integrationId: "codex", configPath, removed: false, message: `No LearnDeck MCP entry was found in ${configPath}.` };
    }
    await atomicWrite(configPath, removeTomlServer(configuration, APP_NAME));
    return { integrationId: "codex", configPath, removed: true, message: `Removed LearnDeck's MCP entry from ${configPath}.` };
  }

  private async disconnectJson(id: IntegrationId, configPath: string): Promise<IntegrationDisconnect> {
    const configuration = await readJson(configPath);
    if (configuration === undefined) {
      return { integrationId: id, configPath, removed: false, message: `No LearnDeck MCP entry was found in ${configPath}.` };
    }
    if (!isRecord(configuration)) throw new Error(`The MCP configuration at ${configPath} is not a JSON object.`);
    const mcpServers = configuration.mcpServers;
    if (mcpServers === undefined || !isRecord(mcpServers) || !Object.prototype.hasOwnProperty.call(mcpServers, APP_NAME)) {
      return { integrationId: id, configPath, removed: false, message: `No LearnDeck MCP entry was found in ${configPath}.` };
    }
    const remainingServers = { ...mcpServers };
    delete remainingServers[APP_NAME];
    configuration.mcpServers = remainingServers;
    await atomicWrite(configPath, `${JSON.stringify(configuration, null, 2)}\n`);
    return { integrationId: id, configPath, removed: true, message: `Removed LearnDeck's MCP entry from ${configPath}.` };
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

  private configPath(id: IntegrationId) {
    if (id === "codex") return join(this.homeDirectory, ".codex", "config.toml");
    if (id === "claude-code") return join(this.homeDirectory, ".claude.json");
    return join(this.homeDirectory, ".cursor", "mcp.json");
  }

  private connectionError(id: IntegrationId, operation: string, cause: unknown) {
    const configPath = this.configPath(id);
    const userAction = `Check that ${configPath} is valid and writable, then retry connecting ${labelFor(id)}.`;
    const detail = cause instanceof Error ? cause.message : "an unknown error occurred";
    return new IntegrationError(
      id,
      configPath,
      `LearnDeck could not ${operation} for ${labelFor(id)}. It tried to update only the "${APP_NAME}" MCP entry in ${configPath}. ${detail}`,
      userAction,
    );
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
  return Boolean(isRecord(configuration?.mcpServers) && Object.prototype.hasOwnProperty.call(configuration.mcpServers, APP_NAME));
}

function hasTomlServer(configuration: string | undefined, name: string) {
  return Boolean(configuration?.match(new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegExp(name)}\\]\\s*$`, "m")));
}

function describeIntegration(
  id: IntegrationId,
  label: string,
  detected: boolean,
  configured: boolean,
  configPath: string,
  expectedPath: string,
  configuredPath: string | undefined,
): AgentIntegration {
  const status: IntegrationStatus = !configured ? detected ? "detected" : "not_found" : configuredPath === expectedPath && existsSync(expectedPath) ? "connected" : "stale";
  const explanation = status === "stale"
    ? `LearnDeck is configured in ${configPath}, but its MCP entry points at ${configuredPath ?? "no readable script path"}. The expected script is ${expectedPath}. Reconnect to repair it.`
    : undefined;
  return {
    id,
    label,
    detected,
    configured,
    status,
    configPath,
    nextStep: status === "connected"
      ? `Restart ${label}, then ask it to use LearnDeck.`
      : status === "stale"
        ? `Reconnect ${label} to repair its LearnDeck entry.`
        : status === "detected"
          ? `Connect ${label} to add LearnDeck's MCP entry.`
          : `Open or install ${label}, then return here to connect it.`,
    ...(explanation ? { explanation } : {}),
  };
}

function extractJsonMcpPath(configuration: Record<string, unknown> | undefined) {
  const mcpServers = configuration?.mcpServers;
  if (!isRecord(mcpServers) || !Object.prototype.hasOwnProperty.call(mcpServers, APP_NAME)) return undefined;
  const entry = mcpServers[APP_NAME];
  if (!isRecord(entry) || !Array.isArray(entry.args)) return undefined;
  const paths = entry.args.filter((value): value is string => typeof value === "string");
  return paths.find((value) => value.endsWith("/mcp.ts")) ?? paths.at(-1);
}

function extractTomlMcpPath(configuration: string | undefined, name: string) {
  const section = tomlServerSection(configuration, name);
  const args = section?.match(/^\s*args\s*=\s*\[([^\]]*)\]/m)?.[1];
  if (!args) return undefined;
  const paths = [...args.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  return paths.find((value) => value.endsWith("/mcp.ts")) ?? paths.at(-1);
}

function tomlServerSection(configuration: string | undefined, name: string) {
  if (!configuration) return undefined;
  return configuration.match(new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegExp(name)}\\]\\s*$[\\s\\S]*?(?=^\\s*\\[|$)`, "m"))?.[0];
}

function upsertTomlServer(configuration: string, name: string, entry: { command: string; args: string[] }) {
  const withoutExisting = removeTomlServer(configuration, name).trimEnd();
  const block = `[mcp_servers.${name}]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${entry.args.map((value) => JSON.stringify(value)).join(", ")}]`;
  return `${withoutExisting ? `${withoutExisting}\n\n` : ""}${block}\n`;
}

function removeTomlServer(configuration: string, name: string) {
  return configuration.replace(new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegExp(name)}\\]\\s*$[\\s\\S]*?(?=^\\s*\\[|$)`, "m"), "").replace(/\n{3,}/g, "\n\n");
}

async function atomicWrite(path: string, content: string) {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${APP_NAME}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function labelFor(id: IntegrationId) {
  if (id === "codex") return "Codex";
  if (id === "claude-code") return "Claude Code";
  return "Cursor";
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
