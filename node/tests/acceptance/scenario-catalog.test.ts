import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("acceptance catalog", () => {
  it("contains the sixteen implementation-neutral scenarios", async () => {
    const names = await readdir(
      new URL("../../../acceptance/scenarios", import.meta.url),
    );
    expect(names.filter((name) => name.endsWith(".json"))).toHaveLength(16);
  });
});
