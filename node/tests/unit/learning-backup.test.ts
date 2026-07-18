import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupLearningState } from "../../scripts/verify-learning.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { force: true, recursive: true });
});

describe("learning-state backup", () => {
  it("copies the sole authority to a unique, non-overwriting backup", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "patchquest-learning-"),
    );
    temporaryDirectories.push(directory);
    const state = path.join(directory, "progress.json");
    await writeFile(state, '{"schemaVersion":1}\n');
    const timestamp = new Date("2026-07-17T12:00:00Z");

    const outputs = await backupLearningState(state, timestamp);

    expect(outputs.map((file) => path.basename(file))).toEqual([
      "2026-07-17T12-00-00-000Z-progress.json",
    ]);
    expect(await readFile(outputs[0]!, "utf8")).toBe('{"schemaVersion":1}\n');
    await expect(backupLearningState(state, timestamp)).rejects.toMatchObject({
      code: "BACKUP_EXISTS",
      integrityPath: outputs[0],
    });
  });
});
