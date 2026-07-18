import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

export type JsonObject = Readonly<Record<string, unknown>>;

type JsonDataEntry = readonly [key: string, value: unknown];

function ordinaryJsonObjectEntries(
  value: unknown,
): readonly JsonDataEntry[] | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    isProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return undefined;
  const entries: JsonDataEntry[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      return undefined;
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function ordinaryDenseArrayValues(
  value: unknown,
): readonly unknown[] | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  )
    return undefined;
  const length = Number(lengthDescriptor.value);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return undefined;
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      return undefined;
    values.push(descriptor.value);
  }
  return keys.every(
    (key) =>
      typeof key === "string" &&
      (key === "length" ||
        (Number.isSafeInteger(Number(key)) &&
          Number(key) >= 0 &&
          Number(key) < length &&
          String(Number(key)) === key)),
  )
    ? values
    : undefined;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return ordinaryJsonObjectEntries(value) !== undefined;
}

export function hasExactOwnKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const entries = ordinaryJsonObjectEntries(value);
  if (!entries) return false;
  const allowed = new Set([...required, ...optional]);
  const actual = new Set(entries.map(([key]) => key));
  return (
    entries.every(([key]) => allowed.has(key)) &&
    required.every((key) => actual.has(key))
  );
}

export function isDenseJsonArray(value: unknown): value is readonly unknown[] {
  return ordinaryDenseArrayValues(value) !== undefined;
}

export function canonicalizeJsonContent(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export function hasJsonContentTopology(value: unknown): boolean {
  try {
    canonicalizeJsonContent(value);
    return true;
  } catch {
    return false;
  }
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value) || Object.is(value, -0))
        throw new TypeError("Normalized JSON content requires finite numbers.");
      return JSON.stringify(value);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError("Normalized content must be faithful JSON data.");
    case "object":
      break;
  }
  if (isProxy(value))
    throw new TypeError("Normalized JSON content rejects proxies.");
  if (ancestors.has(value))
    throw new TypeError("Normalized JSON content cannot contain cycles.");
  ancestors.add(value);
  try {
    const arrayValues = ordinaryDenseArrayValues(value);
    if (arrayValues)
      return `[${arrayValues
        .map((child) => canonicalize(child, ancestors))
        .join(",")}]`;
    const objectEntries = ordinaryJsonObjectEntries(value);
    if (objectEntries) {
      return `{${[...objectEntries]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(
          ([key, child]) =>
            `${JSON.stringify(key)}:${canonicalize(child, ancestors)}`,
        )
        .join(",")}}`;
    }
    throw new TypeError(
      "Normalized content rejects custom prototypes and non-JSON containers.",
    );
  } finally {
    ancestors.delete(value);
  }
}

export function jsonContentFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeJsonContent(value))
    .digest("hex");
}
