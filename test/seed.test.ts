import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";

test("seeds standalone manifests that the catalog can load together", async () => {
  const directory = mkdtempSync(join(tmpdir(), "patchquest-seed-"));
  try {
    await seed(directory, "testing-fundamentals", "Testing Fundamentals");
    await seed(directory, "systems-thinking", "Systems Thinking");
    expect((await CourseCatalog.load(directory)).list().map((course) => course.id)).toEqual(["systems-thinking", "testing-fundamentals"]);
    const course = (await CourseCatalog.load(directory)).get("testing-fundamentals");
    expect(course.title).toBe("Testing Fundamentals");
    expect(course.sections).toHaveLength(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function seed(directory: string, id: string, title: string) {
  const runner = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/seed.ts"), id, title], {
    cwd: resolve(import.meta.dir, ".."),
    env: { ...process.env, PATCHQUEST_COURSES_DIR: directory },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await runner.exited).toBe(0);
}
