import { describe, expect, it } from "vitest";
import { findArchitectureViolations } from "../../scripts/check-architecture.ts";

describe("dependency direction", () => {
  it.each([
    ['import "@patchquest/workshop";', "package import"],
    ['export { value } from "@patchquest/workshop";', "re-export"],
    ['void import("@patchquest/workshop");', "dynamic import"],
    ['require("@patchquest/workshop");', "require"],
    ['import "../../workshop/src/index.js";', "relative import"],
  ])("rejects an application boundary import via %s (%s)", (source) => {
    expect(
      findArchitectureViolations(
        source,
        "apps/mission-control/src/forbidden.ts",
      ),
    ).toHaveLength(1);
  });

  it("rejects shared packages importing an application", () => {
    expect(
      findArchitectureViolations(
        'export * from "../../../apps/workshop/src/index.js";',
        "packages/messaging/src/forbidden.ts",
      ),
    ).toHaveLength(1);
  });

  it.each([
    ['import Fastify from "fastify";', "Fastify"],
    ['import pg from "pg";', "PostgreSQL"],
    ['import amqp from "amqplib";', "RabbitMQ"],
    ['import { trace } from "@opentelemetry/api";', "OpenTelemetry"],
    ['import OpenAI from "openai";', "provider SDK"],
    ['import Anthropic from "@anthropic-ai/sdk";', "Anthropic SDK family"],
    ['import Gemini from "@google/genai";', "Google model SDK family"],
    ['import { S3Client } from "@aws-sdk/client-s3";', "AWS SDK family"],
    ['import AWS from "aws-sdk";', "legacy AWS SDK"],
    ['import { execa } from "execa";', "host command helper"],
    ['import { spawn } from "node:child_process";', "host process execution"],
    ['import { createRequire } from "node:module";', "module recovery"],
    ['import { request } from "node:https";', "host network execution"],
    ['const net = require("node:net");', "required host network execution"],
  ])(
    "rejects an infrastructure dependency in domain/application: %s (%s)",
    (source) => {
      expect(
        findArchitectureViolations(
          source,
          "apps/mission-control/src/domain/forbidden.ts",
        ),
      ).toHaveLength(1);
      expect(
        findArchitectureViolations(
          source,
          "apps/mission-control/src/application/forbidden.ts",
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    ['import child = require("node:child_process");', "import-equals"],
    [
      'const load = require; load("node:child_process");',
      "require indirection",
    ],
    [
      'const moduleName = "node:child_process"; import(moduleName);',
      "variable dynamic import",
    ],
    ['process.getBuiltinModule("node:child_process");', "builtin recovery"],
    ['fetch("https://example.test");', "global fetch"],
    ['globalThis.fetch("https://example.test");', "globalThis fetch"],
    [
      'globalThis["fetch"]("https://example.test");',
      "computed globalThis fetch",
    ],
    [
      'const { fetch } = globalThis; fetch("https://example.test");',
      "shorthand destructured globalThis fetch",
    ],
    [
      'const { fetch: send } = globalThis; send("https://example.test");',
      "destructured globalThis fetch",
    ],
    [
      'const runtime = globalThis; runtime["fetch"]("https://example.test");',
      "aliased globalThis",
    ],
    ['global.fetch("https://example.test");', "global fetch"],
    ['global["fetch"]("https://example.test");', "computed global fetch"],
    [
      'const { fetch: send } = global; send("https://example.test");',
      "destructured global fetch",
    ],
    [
      'const runtime = global; runtime.fetch("https://example.test");',
      "aliased global",
    ],
    [
      'process["getBuiltinModule"]("node:child_process");',
      "computed builtin recovery",
    ],
    [
      'const { getBuiltinModule: load } = process; load("node:child_process");',
      "destructured builtin recovery",
    ],
    [
      'const runtime = process; runtime.getBuiltinModule("node:child_process");',
      "aliased process recovery",
    ],
    ['new WebSocket("wss://example.test");', "WebSocket"],
    [
      'const connect = WebSocket; new connect("wss://example.test");',
      "aliased WebSocket",
    ],
    ['new EventSource("https://example.test/events");', "EventSource"],
    [
      'const Stream = EventSource; new Stream("https://example.test/events");',
      "aliased EventSource",
    ],
    [
      'const { EventSource: Stream } = globalThis; new Stream("https://example.test/events");',
      "destructured EventSource",
    ],
    ['eval("1 + 1");', "eval"],
    ['const execute = Function; execute("return 1")();', "Function alias"],
    ["WebAssembly.instantiate(bytes);", "WebAssembly"],
    ['module["require"]("node:child_process");', "module require"],
  ])("rejects indirect production capability access via %s (%s)", (source) => {
    for (const layer of ["domain", "application"]) {
      expect(
        findArchitectureViolations(
          source,
          `apps/mission-control/src/${layer}/forbidden.ts`,
        ),
      ).not.toEqual([]);
    }
  });

  it.each([
    [
      "const client = { fetch: localHandler }; client.fetch();",
      "property name",
    ],
    ["const value = record.process;", "ordinary property"],
    [
      "const { fetch: localFetch } = safeClient; localFetch();",
      "local destructuring",
    ],
    ["class View { fetch() { return 1; } }", "method name"],
    [
      "function inspect(process: { status: string }) { return process.status; }",
      "local process parameter",
    ],
    [
      "const fetch = (value: string) => value; fetch('local');",
      "shadowed local fetch",
    ],
    [
      "const EventSource = class {}; new EventSource();",
      "shadowed local EventSource",
    ],
    [
      "function inspect(global: { value: string }) { return global.value; }",
      "local global parameter",
    ],
  ])(
    "does not confuse an allowed local/property name with a runtime global: %s (%s)",
    (source) => {
      expect(
        findArchitectureViolations(
          source,
          "apps/mission-control/src/application/allowed.ts",
        ),
      ).toEqual([]);
    },
  );

  it.each([
    [
      'import "../application/use-case.js";',
      "apps/mission-control/src/domain/model.ts",
    ],
    [
      'import "../infrastructure/postgres.js";',
      "apps/mission-control/src/application/use-case.ts",
    ],
    ['import "../../index.js";', "apps/mission-control/src/domain/model.ts"],
  ])("rejects an outward layer import from %s (%s)", (source, importer) => {
    expect(findArchitectureViolations(source, importer)).toHaveLength(1);
  });

  it("allows inward domain/application imports and imports of shared packages", () => {
    expect(
      findArchitectureViolations(
        'import "../domain/model.js"; import "@patchquest/contracts"; import { createHash } from "node:crypto"; void import("@patchquest/contracts");',
        "apps/mission-control/src/application/use-case.ts",
      ),
    ).toEqual([]);
  });

  it.each([
    ["../../../../node_modules/typescript/lib/typescript.js", "node_modules"],
    ["../../../../scripts/check-architecture.js", "node scripts"],
    ["../../../workshop/src/domain/index.js", "another application"],
    ["../../../../packages/messaging/src/index.js", "non-contract package"],
  ])("rejects a relative escape resolved into %s (%s)", (specifier) => {
    expect(
      findArchitectureViolations(
        `import ${JSON.stringify(specifier)};`,
        "apps/mission-control/src/application/use-case.ts",
      ),
    ).toHaveLength(1);
  });

  it("resolves TS extensions, extensionless files, and directory indexes inside the allowlist", () => {
    expect(
      findArchitectureViolations(
        'import "../domain/mission.js"; import "../domain/mission";',
        "apps/mission-control/src/application/translators.ts",
      ),
    ).toEqual([]);
    expect(
      findArchitectureViolations(
        'export * from "..";',
        "packages/contracts/src/nested/fixture.ts",
      ),
    ).toEqual([]);
  });

  it("allows node:util/types only for trap-free proxy detection in json-topology", () => {
    const source = 'import { isProxy } from "node:util/types";';
    expect(
      findArchitectureViolations(
        source,
        "apps/mission-control/src/domain/json-topology.ts",
      ),
    ).toEqual([]);
    for (const importer of [
      "apps/mission-control/src/domain/other.ts",
      "apps/mission-control/src/application/other.ts",
    ])
      expect(findArchitectureViolations(source, importer)).toHaveLength(1);
  });

  it.each([
    ["export class Mission {}", "runtime aggregate"],
    ["export function parseMission() {}", "runtime helper"],
    ["export interface MissionSnapshot {}", "persistence projection"],
  ])("keeps shared contracts transport-only: %s (%s)", (source) => {
    expect(
      findArchitectureViolations(source, "packages/contracts/src/forbidden.ts"),
    ).toHaveLength(1);
  });
});
