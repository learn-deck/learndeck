import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeLearningState,
  isReviewDue,
  rolloverLearningSession,
  type LearningState,
} from "../../scripts/verify-learning.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { force: true, recursive: true });
});

async function temporaryRepository(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "patchquest-init-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("learning-state initialization", () => {
  it("atomically creates one authority and repairs its disposable projection", async () => {
    const repository = await temporaryRepository();
    const now = new Date("2026-07-18T10:00:00.000Z");

    const first = await initializeLearningState(
      repository,
      now,
      "session-init-test",
    );
    const originalState = await readFile(first.stateFile, "utf8");
    const originalLog = await readFile(first.logFile, "utf8");
    await unlink(first.logFile);
    const second = await initializeLearningState(
      repository,
      new Date("2026-07-18T11:00:00.000Z"),
      "session-ignored-test",
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await readFile(first.stateFile, "utf8")).toBe(originalState);
    expect(await readFile(first.logFile, "utf8")).toBe(originalLog);
    expect(await readdir(path.join(repository, ".patchquest"))).toEqual([
      "learning-log.md",
      "progress.json",
    ]);
    expect(originalState).toContain('"sessionId": "session-init-test"');
    expect(originalLog).toContain("Derived from `.patchquest/progress.json`");
    expect(originalLog).toContain("`session-init-test`");
  });

  it("initializes through empty or log-only directories and rejects invalid authority", async () => {
    const emptyRepository = await temporaryRepository();
    const emptyTarget = path.join(emptyRepository, ".patchquest");
    await mkdir(emptyTarget);
    await initializeLearningState(
      emptyRepository,
      new Date("2026-07-18T10:00:00.000Z"),
      "session-empty-directory",
    );
    expect(await readdir(emptyTarget)).toEqual([
      "learning-log.md",
      "progress.json",
    ]);

    const logOnlyRepository = await temporaryRepository();
    const logOnlyTarget = path.join(logOnlyRepository, ".patchquest");
    await mkdir(logOnlyTarget);
    await writeFile(
      path.join(logOnlyTarget, "learning-log.md"),
      "stale view\n",
    );
    await initializeLearningState(
      logOnlyRepository,
      new Date("2026-07-18T10:00:00.000Z"),
      "session-log-only-directory",
    );
    expect(
      await readFile(path.join(logOnlyTarget, "progress.json"), "utf8"),
    ).toContain("session-log-only-directory");
    expect(
      await readFile(path.join(logOnlyTarget, "learning-log.md"), "utf8"),
    ).not.toBe("stale view\n");

    const invalidRepository = await temporaryRepository();
    const invalidTarget = path.join(invalidRepository, ".patchquest");
    await mkdir(invalidTarget);
    const invalidState = path.join(invalidTarget, "progress.json");
    await writeFile(invalidState, "{}\n");
    await expect(
      initializeLearningState(invalidRepository),
    ).rejects.toMatchObject({
      code: "STATE_VERSION_UNSUPPORTED",
      integrityPath: `${invalidState}/schemaVersion`,
    });
  });
});

describe("learning session lifecycle", () => {
  it("closes the old session, opens a fresh session, and makes next-session review due", async () => {
    const repository = await temporaryRepository();
    const initialized = await initializeLearningState(
      repository,
      new Date("2026-07-18T10:00:00.000Z"),
      "session-first-test",
    );
    const state = JSON.parse(
      await readFile(initialized.stateFile, "utf8"),
    ) as LearningState;
    const review = {
      reviewId: "review-next-test",
      priorReviewId: null,
      scheduledBySessionId: "session-first-test",
      promptId: "00-delayed-loop",
      moduleId: "00",
      conceptIds: ["verification-vs-approval"],
      atNextSession: true as const,
      heuristic: "next-session-unknown" as const,
      reason: "Retrieve in a distinct work session.",
    };
    state.reviewQueue.push(review);
    expect(
      isReviewDue(
        review,
        state.current.sessionId,
        new Date(state.lastSessionAt),
      ),
    ).toBe(false);

    const resumed = rolloverLearningSession(
      state,
      new Date("2026-07-18T11:00:00.000Z"),
      "session-second-test",
    );

    expect(resumed.sessions).toEqual([
      {
        sessionId: "session-first-test",
        status: "closed",
        startedAt: "2026-07-18T10:00:00.000Z",
        endedAt: "2026-07-18T11:00:00.000Z",
      },
      {
        sessionId: "session-second-test",
        status: "open",
        startedAt: "2026-07-18T11:00:00.000Z",
        endedAt: null,
      },
    ]);
    expect(resumed.current.sessionId).toBe("session-second-test");
    expect(resumed.current).toMatchObject({
      moduleId: "00",
      activityId: "00-delayed-loop",
      status: "review",
      loopPhase: "retrieve",
    });
    expect(resumed.lastSessionId).toBe("session-second-test");
    expect(
      isReviewDue(
        review,
        resumed.current.sessionId,
        new Date(resumed.lastSessionAt),
      ),
    ).toBe(true);
  });
});
