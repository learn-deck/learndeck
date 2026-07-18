import { readFile } from "node:fs/promises";
import {
  PUBLIC_COMMAND_TYPES_V1,
  PUBLIC_EVENT_TYPES_V1,
  MISSION_RETRY_REASONS_V1,
  type PublicCommandV1,
  type PublicEventV1,
} from "../../packages/contracts/src/index.ts";
import { describe, expect, it } from "vitest";
import type { InboxPort } from "../../apps/mission-control/src/application/ports.ts";
import {
  canonicalizeNormalizedContent,
  normalizedContentFingerprint,
} from "../../apps/mission-control/src/index.ts";

describe("TypeScript v1 transport DTOs", () => {
  it("has catalog parity for exactly three commands and twelve events", async () => {
    const catalog: unknown = JSON.parse(
      await readFile(
        new URL("../../../contracts/schemas/v1/catalog.json", import.meta.url),
        "utf8",
      ),
    );
    if (typeof catalog !== "object" || catalog === null)
      throw new Error("contract catalog is invalid");
    const root = Object.fromEntries(Object.entries(catalog));
    const integration = root["integrationMessages"];
    if (typeof integration !== "object" || integration === null)
      throw new Error("integration catalog is invalid");
    const integrationRecord = Object.fromEntries(Object.entries(integration));
    expect([...PUBLIC_COMMAND_TYPES_V1].sort()).toEqual(
      flattenStringLists(integrationRecord["commandsByIssuer"]).sort(),
    );
    expect([...PUBLIC_EVENT_TYPES_V1].sort()).toEqual(
      flattenStringLists(integrationRecord["eventsByProducer"]).sort(),
    );
    expect([...MISSION_RETRY_REASONS_V1].sort()).toEqual(
      stringList(integrationRecord["missionRetryReasons"]).sort(),
    );
    expect(PUBLIC_COMMAND_TYPES_V1).toHaveLength(3);
    expect(PUBLIC_EVENT_TYPES_V1).toHaveLength(12);
  });

  it("exposes discriminants that narrow command and event payloads", () => {
    function commandSubject(command: PublicCommandV1): string {
      return command.subjectId;
    }
    function eventSubject(event: PublicEventV1): string {
      return event.subjectId;
    }
    expect(typeof commandSubject).toBe("function");
    expect(typeof eventSubject).toBe("function");
  });

  it("requires fingerprint-aware inbox classification and process-first recording", async () => {
    const calls: string[] = [];
    const inbox: InboxPort = {
      classify: (messageId, normalizedFingerprint) => {
        calls.push(`classify:${messageId}:${normalizedFingerprint}`);
        return Promise.resolve("UNSEEN");
      },
      recordProcessed: (messageId, normalizedFingerprint) => {
        calls.push(`record:${messageId}:${normalizedFingerprint}`);
        return Promise.resolve();
      },
    };
    expect(await inbox.classify("event-1", "a".repeat(64))).toBe("UNSEEN");
    calls.push("business-state-and-outbox-accepted");
    await inbox.recordProcessed("event-1", "a".repeat(64));
    expect(calls).toEqual([
      `classify:event-1:${"a".repeat(64)}`,
      "business-state-and-outbox-accepted",
      `record:event-1:${"a".repeat(64)}`,
    ]);
  });

  it("exports one order-stable normalized-content fingerprint for future inbox adapters", () => {
    const left = { eventId: "event-1", data: { count: 1, result: "ok" } };
    const right = { data: { result: "ok", count: 1 }, eventId: "event-1" };
    expect(canonicalizeNormalizedContent(left)).toBe(
      canonicalizeNormalizedContent(right),
    );
    expect(normalizedContentFingerprint(left)).toBe(
      normalizedContentFingerprint(right),
    );
    expect(
      normalizedContentFingerprint({ ...right, eventId: "event-2" }),
    ).not.toBe(normalizedContentFingerprint(left));
    expect(
      normalizedContentFingerprint({
        eventId: "event-1",
        data: { count: 2, result: "ok" },
      }),
    ).not.toBe(normalizedContentFingerprint(left));
  });

  it("rejects every topology that cannot be faithfully normalized as dense JSON", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    const inherited = Object.assign(Object.create({ inherited: true }), {
      eventId: "event-1",
    });
    const withSymbol = { eventId: "event-1" } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("semantic")] = true;
    const nonEnumerable = { eventId: "event-1" };
    Object.defineProperty(nonEnumerable, "semantic", {
      value: true,
      enumerable: false,
    });
    const accessor = { eventId: "event-1" } as Record<string, unknown>;
    let accessorRead = false;
    Object.defineProperty(accessor, "semantic", {
      enumerable: true,
      get() {
        accessorRead = true;
        return true;
      },
    });
    const sparse = new Array<unknown>(1);
    const arrayWithExtra = ["value"] as unknown[] & Record<string, unknown>;
    arrayWithExtra["semantic"] = true;
    for (const invalid of [
      cycle,
      inherited,
      withSymbol,
      nonEnumerable,
      accessor,
      sparse,
      arrayWithExtra,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      undefined,
      () => true,
      Symbol("value"),
      1n,
      new Date(),
      new Map(),
      new Set(),
    ]) {
      expect(() => canonicalizeNormalizedContent(invalid)).toThrow(TypeError);
      expect(() => normalizedContentFingerprint(invalid)).toThrow(TypeError);
    }
    expect(accessorRead).toBe(false);
  });

  it("rejects object and array proxies without invoking reflective or property traps", () => {
    for (const target of [{ eventId: "event-1" }, ["event-1"]]) {
      const trapCounts = {
        get: 0,
        getOwnPropertyDescriptor: 0,
        getPrototypeOf: 0,
        ownKeys: 0,
      };
      const proxy = new Proxy(target, {
        get(proxied, key, receiver) {
          trapCounts.get += 1;
          return Reflect.get(proxied, key, receiver);
        },
        getOwnPropertyDescriptor(proxied, key) {
          trapCounts.getOwnPropertyDescriptor += 1;
          return Reflect.getOwnPropertyDescriptor(proxied, key);
        },
        getPrototypeOf(proxied) {
          trapCounts.getPrototypeOf += 1;
          return Reflect.getPrototypeOf(proxied);
        },
        ownKeys(proxied) {
          trapCounts.ownKeys += 1;
          return Reflect.ownKeys(proxied);
        },
      });
      expect(() => canonicalizeNormalizedContent(proxy)).toThrow(TypeError);
      expect(() => normalizedContentFingerprint(proxy)).toThrow(TypeError);
      expect(trapCounts).toEqual({
        get: 0,
        getOwnPropertyDescriptor: 0,
        getPrototypeOf: 0,
        ownKeys: 0,
      });
    }
  });
});

function flattenStringLists(value: unknown): string[] {
  if (typeof value !== "object" || value === null)
    throw new Error("message catalog section is invalid");
  const result: string[] = [];
  for (const item of Object.values(value)) {
    if (
      !Array.isArray(item) ||
      !item.every((entry) => typeof entry === "string")
    )
      throw new Error("message catalog list is invalid");
    for (const entry of item) result.push(entry);
  }
  return result;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("catalog list is invalid");
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new Error("catalog item is invalid");
    result.push(entry);
  }
  return result;
}
