import { createHash } from "node:crypto";
import { isRuntimeProxy } from "./proxy-detection.js";

export type JsonObject = Readonly<Record<string, unknown>>;
type JsonEntry = readonly [string, unknown];

function ordinaryObjectEntries(
  value: unknown,
): readonly JsonEntry[] | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    isRuntimeProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return undefined;
  const entries: JsonEntry[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      return undefined;
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function ordinaryArrayValues(value: unknown): readonly unknown[] | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    isRuntimeProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    return undefined;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !length ||
    !("value" in length) ||
    length.enumerable ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0
  )
    return undefined;
  const values: unknown[] = [];
  const size = Number(length.value);
  if (Reflect.ownKeys(value).length !== size + 1) return undefined;
  for (let index = 0; index < size; index += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !("value" in item) || !item.enumerable) return undefined;
    values.push(item.value);
  }
  return Reflect.ownKeys(value).every(
    (key) =>
      typeof key === "string" &&
      (key === "length" ||
        (Number.isSafeInteger(Number(key)) &&
          Number(key) >= 0 &&
          Number(key) < size &&
          String(Number(key)) === key)),
  )
    ? values
    : undefined;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return ordinaryObjectEntries(value) !== undefined;
}

export function hasExactOwnKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const entries = ordinaryObjectEntries(value);
  if (!entries) return false;
  const allowed = new Set([...required, ...optional]);
  const actual = new Set(entries.map(([key]) => key));
  return (
    entries.every(([key]) => allowed.has(key)) &&
    required.every((key) => actual.has(key))
  );
}

export function isDenseJsonArray(value: unknown): value is readonly unknown[] {
  return ordinaryArrayValues(value) !== undefined;
}

export function canonicalizeJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value) || Object.is(value, -0))
        throw new TypeError(
          "Normalized JSON requires finite non-negative-zero numbers.",
        );
      return JSON.stringify(value);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError("Normalized content must be faithful JSON data.");
    case "object":
      break;
  }
  if (isRuntimeProxy(value))
    throw new TypeError("Normalized JSON rejects proxies.");
  if (ancestors.has(value))
    throw new TypeError("Normalized JSON rejects cycles.");
  ancestors.add(value);
  try {
    const array = ordinaryArrayValues(value);
    if (array)
      return `[${array.map((child) => canonicalize(child, ancestors)).join(",")}]`;
    const entries = ordinaryObjectEntries(value);
    if (entries)
      return `{${[...entries]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(
          ([key, child]) =>
            `${JSON.stringify(key)}:${canonicalize(child, ancestors)}`,
        )
        .join(",")}}`;
    throw new TypeError("Normalized JSON rejects custom containers.");
  } finally {
    ancestors.delete(value);
  }
}

export function hasJsonTopology(value: unknown): boolean {
  try {
    canonicalizeJson(value);
    return true;
  } catch {
    return false;
  }
}

export function jsonFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

export function deepFreezeCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
