import { isProxy } from "node:util/types";

export function isRuntimeProxy(value: object): boolean {
  return isProxy(value);
}
