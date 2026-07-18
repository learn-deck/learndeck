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
        'import "../domain/model.js"; import "@patchquest/contracts";',
        "apps/mission-control/src/application/use-case.ts",
      ),
    ).toEqual([]);
  });
});
