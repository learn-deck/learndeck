import {
  canonicalizeJson,
  deepFreezeCopy,
  hasExactOwnKeys,
  hasJsonTopology,
  isDenseJsonArray,
  isJsonObject,
  jsonFingerprint,
} from "../domain/json-topology.js";

export { deepFreezeCopy, hasJsonTopology, isDenseJsonArray, isJsonObject };
export const hasExactKeys = hasExactOwnKeys;
export const normalizedContentFingerprint = jsonFingerprint;
export const canonicalizeNormalizedContent = canonicalizeJson;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

export function isBoundedText(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d(?:\.\d+)?)([Zz]|([+-])(\d\d):(\d\d))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezoneHour = Number(match[9] ?? 0);
  const timezoneMinute = Number(match[10] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second < 60 &&
    timezoneHour <= 23 &&
    timezoneMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

export function isSha256Digest(
  value: unknown,
): value is Readonly<{ algorithm: "sha256"; value: string }> {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, ["algorithm", "value"]) &&
    value["algorithm"] === "sha256" &&
    typeof value["value"] === "string" &&
    digestPattern.test(value["value"])
  );
}
