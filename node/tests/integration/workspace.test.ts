import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("npm workspace", () => {
  it("declares both application and package workspaces", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.workspaces).toEqual(["apps/*", "packages/*"]);
  });
});
