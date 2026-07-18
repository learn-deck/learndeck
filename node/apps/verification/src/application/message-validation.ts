import {
  canonicalizeJson,
  deepFreezeCopy,
  hasExactOwnKeys,
  hasJsonTopology,
  isDenseJsonArray,
  isJsonObject,
  jsonFingerprint,
} from "../domain/json-topology.js";

export {
  canonicalizeJson,
  deepFreezeCopy,
  hasJsonTopology,
  isDenseJsonArray,
  isJsonObject,
  jsonFingerprint,
};
export const hasExactKeys = hasExactOwnKeys;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isBoundedText(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d(?:\.\d+)?)([Zz]|([+-])(\d\d):(\d\d))$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month] ?? 0) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) < 60 &&
    Number(match[9] ?? 0) <= 23 &&
    Number(match[10] ?? 0) <= 59
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
