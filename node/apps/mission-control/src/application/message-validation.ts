import {
  canonicalizeJsonContent,
  hasExactOwnKeys,
  isJsonObject,
  jsonContentFingerprint,
} from "../domain/json-topology.js";

export { isDenseJsonArray } from "../domain/json-topology.js";
export { hasJsonContentTopology } from "../domain/json-topology.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const rfc3339DatePattern = /^(\d{4})-(\d\d)-(\d\d)$/;
const rfc3339TimePattern =
  /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)$/i;

export function isMessageIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

export function isSha256Digest(
  value: unknown,
): value is Readonly<{ algorithm: "sha256"; value: string }> {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["algorithm", "value"]) &&
    value["algorithm"] === "sha256" &&
    typeof value["value"] === "string" &&
    digestPattern.test(value["value"])
  );
}

export function isBoundedText(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

export function isRfc3339DateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(/t|\s/i);
  if (parts.length !== 2) return false;
  const date = rfc3339DatePattern.exec(parts[0] ?? "");
  const time = rfc3339TimePattern.exec(parts[1] ?? "");
  if (!date || !time) return false;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month] ?? 0))
    return false;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3]);
  const sign = time[5] === "-" ? -1 : 1;
  const timezoneHour = Number(time[6] ?? 0);
  const timezoneMinute = Number(time[7] ?? 0);
  if (timezoneHour > 23 || timezoneMinute > 59) return false;
  if (hour <= 23 && minute <= 59 && second < 60) return true;
  const utcMinute = minute - timezoneMinute * sign;
  const utcHour = hour - timezoneHour * sign - (utcMinute < 0 ? 1 : 0);
  return (
    (utcHour === 23 || utcHour === -1) &&
    (utcMinute === 59 || utcMinute === -1) &&
    second < 61
  );
}

export const isPlainRecord = isJsonObject;

export const hasExactKeys = hasExactOwnKeys;

export function deepFreezeCopy<Value>(value: Value): Value {
  const copy = structuredClone(value);
  return deepFreeze(copy);
}

export function canonicalizeNormalizedContent(value: unknown): string {
  return canonicalizeJsonContent(value);
}

export function normalizedContentFingerprint(value: unknown): string {
  return jsonContentFingerprint(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
