import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { verificationGates } from "../../scripts/run-verification.ts";

describe("verification spine", () => {
  it("runs every verification level once in the required order", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    const expected = [
      "policy",
      "format:check",
      "lint",
      "typecheck",
      "build",
      "architecture",
      "unit",
      "contract",
      "integration",
      "acceptance",
      "system",
      "docs",
      "learning",
    ];
    expect(manifest.scripts.verify).toBe("node scripts/run-verification.ts");
    expect(verificationGates).toEqual(expected);
  });
});
