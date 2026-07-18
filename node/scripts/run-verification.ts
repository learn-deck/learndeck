import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run verification`);
  return value;
}

export const verificationGates = [
  "policy",
  "format:check",
  "lint",
  "typecheck",
  "build",
  "architecture",
  "unit",
  "contract",
  "integration",
  "acceptance",
  "system",
  "docs",
  "learning",
] as const;

function run(script: string): void {
  const npmCli = requiredEnvironment("npm_execpath");
  const result = spawnSync(process.execPath, [npmCli, "run", script], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${script} failed with status ${result.status ?? "unknown"}`,
    );
}

export function verify(): void {
  run("clean");
  try {
    for (const gate of verificationGates) run(gate);
  } finally {
    run("clean");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) verify();
