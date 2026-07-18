import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalGateDigest,
  canonicalSourceInventory,
  computeRepositoryRevision,
  type LearningState,
} from "../../scripts/verify-learning.ts";

const executeFile = promisify(execFile);
const nodeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const courseRoot = path.resolve(nodeRoot, "..");
const cli = path.join(nodeRoot, "scripts/verify-learning.ts");
const evaluatedStateFile = path.join(
  courseRoot,
  ".agents/skills/learn-patchquest/references/evaluated-state.example.json",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { force: true, recursive: true });
});

async function temporaryRepository(label: string): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), `patchquest-cli-${label}-`),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function runCli(
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return await executeFile(process.execPath, [cli, ...arguments_], {
    cwd: nodeRoot,
    env: { ...process.env, ...environment },
  });
}

async function expectCliFailure(
  arguments_: string[],
  expectedCode: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<void> {
  try {
    await runCli(arguments_, environment);
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr)
        : String(error);
    expect(stderr).toContain(expectedCode);
    return;
  }
  throw new Error(`CLI unexpectedly accepted ${expectedCode} fixture`);
}

async function readState(file: string): Promise<LearningState> {
  return JSON.parse(await readFile(file, "utf8")) as LearningState;
}

async function evaluatedState(): Promise<LearningState> {
  return JSON.parse(
    await readFile(evaluatedStateFile, "utf8"),
  ) as LearningState;
}

async function writeState(file: string, state: LearningState): Promise<void> {
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}

async function commitDraft(
  stateFile: string,
  reason: string,
  mutate: (state: LearningState) => void,
): Promise<LearningState> {
  const draftFile = path.join(path.dirname(stateFile), "progress.draft.json");
  const draft = await readState(stateFile);
  mutate(draft);
  await writeState(draftFile, draft);
  await runCli(["checkpoint", stateFile, draftFile, reason]);
  return await readState(stateFile);
}

type Attempt = LearningState["retrievalAttempts"][number];
type Revision = LearningState["revisions"][number];

const module03Criteria = (score: number) => [
  {
    criterionId: "03-classification",
    score,
    evidence:
      "I classified duplicate, domain, and infrastructure failure paths explicitly.",
  },
  {
    criterionId: "03-consequence",
    score,
    evidence:
      "I described whether the owning context retries or records a business result.",
  },
  {
    criterionId: "03-evidence",
    score,
    evidence:
      "I connected the explanation to the scenario and recorded acceptance evidence.",
  },
];

const feedback = (gap: string, nextAction: string) => ({
  target:
    "Classify the failure and explain its owner, retry behavior, and observable consequence.",
  observedEvidence:
    "The response distinguished technical interruption from a business rejection.",
  exactGap: gap,
  process: "Identify the owning context before deciding whether retry is safe.",
  correctiveSupport:
    "Compare one duplicate delivery with one lease-expiry worked example.",
  nextAction,
  selfMonitoringQuestion:
    "Which observed fact proves that this is a retryable interruption rather than a domain result?",
});

function diagnosticAttempt(state: LearningState): Attempt {
  return {
    attemptId: "journey-diagnostic-03",
    sessionId: state.lastSessionId,
    activityId: "03-failure-contrast",
    promptId: "03-failure-contrast",
    moduleId: "03",
    conceptIds: ["idempotency", "domain-vs-infrastructure-failure"],
    attemptedAt: state.lastSessionAt,
    answer:
      "A duplicate can be retried, but I have not yet separated a business rejection from an infrastructure abort.",
    confidencePercent: 55,
    predictedOutcome: "partial",
    outcome: "partial",
    purpose: "diagnostic",
    status: "evaluated",
    calibrationNote:
      "My moderate confidence matches the missing ownership distinction in this first attempt.",
    misconception:
      "I treated every non-success result as though the same retry policy applied.",
    correction:
      "A domain rejection is a business result, while an infrastructure abort can remain retryable.",
    selfEvaluation: { criteria: module03Criteria(1) },
    feedback: feedback(
      "The answer did not identify the owning context for each failure.",
      "Inspect the two contrasting scenarios and explain their ownership.",
    ),
    supportLevel: "worked-example",
    checkRunIds: [],
  };
}

function masteryAttempt(state: LearningState, checkRunId: string): Attempt {
  return {
    attemptId: "journey-mastery-03",
    sessionId: state.lastSessionId,
    activityId: "03-mastery-failure",
    promptId: "03-mastery-failure",
    moduleId: "03",
    conceptIds: ["idempotency", "domain-vs-infrastructure-failure"],
    attemptedAt: state.lastSessionAt,
    answer:
      "The owning context decides whether a result is retryable, but I left the duplicate-delivery consequence implicit.",
    confidencePercent: 75,
    predictedOutcome: "accurate",
    outcome: "partial",
    purpose: "mastery",
    status: "awaiting_revision",
    calibrationNote:
      "My prediction was too high because one required consequence remained implicit.",
    misconception:
      "I assumed naming the owner was enough without predicting the duplicate outcome.",
    correction:
      "The answer must state that idempotent duplicate handling preserves one business effect.",
    selfEvaluation: { criteria: module03Criteria(1) },
    feedback: feedback(
      "The duplicate-delivery business consequence was not explicit.",
      "Revise the answer from memory and state the duplicate consequence.",
    ),
    supportLevel: "independent",
    checkRunIds: [checkRunId],
  };
}

function masteryRevision(state: LearningState, checkRunId: string): Revision {
  return {
    revisionId: "journey-mastery-revision-03",
    attemptId: "journey-mastery-03",
    sessionId: state.lastSessionId,
    moduleId: "03",
    activityId: "03-mastery-failure",
    promptId: "03-mastery-failure",
    answer:
      "A duplicate delivery is handled idempotently so one business effect remains; a domain rejection is recorded without blind retry; an infrastructure abort can be retried by its owning context.",
    confidencePercent: 90,
    predictedOutcome: "accurate",
    outcome: "accurate",
    calibrationNote:
      "The higher confidence is supported by an explicit classification, owner, and consequence for every case.",
    selfEvaluation: { criteria: module03Criteria(2) },
    feedback: feedback(
      "No remaining classification or consequence gap was observed.",
      "Retrieve a fresh failure classification in the next session.",
    ),
    evidence:
      "The revision independently names the owner, retry policy, and business effect after the acceptance gate passed.",
    evaluatedAt: state.lastSessionAt,
    checkRunIds: [checkRunId],
  };
}

function delayedAttempt(state: LearningState): Attempt {
  return {
    attemptId: "journey-delayed-03",
    sessionId: state.lastSessionId,
    activityId: "03-delayed-failure",
    promptId: "03-delayed-failure",
    moduleId: "03",
    conceptIds: ["idempotency", "domain-vs-infrastructure-failure"],
    attemptedAt: state.lastSessionAt,
    answer:
      "The domain owns business rejection, while an interrupted technical operation stays retryable; duplicate handling must preserve exactly one business effect.",
    confidencePercent: 85,
    predictedOutcome: "accurate",
    outcome: "accurate",
    purpose: "delayed-review",
    status: "evaluated",
    calibrationNote:
      "The delayed answer retained all three classifications without reopening the source.",
    misconception: null,
    correction: null,
    selfEvaluation: { criteria: module03Criteria(2) },
    feedback: feedback(
      "No material classification gap remained in delayed retrieval.",
      "Continue to module 01 and revisit this distinction at a longer gap.",
    ),
    supportLevel: "independent",
    checkRunIds: [],
  };
}

function recoveryDiagnosticAttempt(state: LearningState): Attempt {
  const attempt = diagnosticAttempt(state);
  return {
    ...attempt,
    attemptId: "recovery-diagnostic-04",
    activityId: "04-boundary-prediction",
    promptId: "04-boundary-prediction",
    moduleId: "04",
    conceptIds: ["dependency-direction", "context-isolation"],
    answer:
      "I predict an application-layer import of another bounded context will violate the inward dependency boundary.",
    selfEvaluation: {
      criteria: [
        {
          criterionId: "04-prediction",
          score: 1,
          evidence:
            "I predicted that a cross-context application import should fail.",
        },
        {
          criterionId: "04-mechanism",
          score: 1,
          evidence:
            "I identified static dependency inspection as the enforcing mechanism.",
        },
        {
          criterionId: "04-proof-and-recovery",
          score: 0,
          evidence:
            "I had not yet observed failure and exact restoration evidence.",
        },
      ],
    },
  };
}

function recoveryMasteryAttempt(
  state: LearningState,
  checkRunIds: string[],
): Attempt {
  return {
    ...recoveryDiagnosticAttempt(state),
    attemptId: "recovery-mastery-04",
    activityId: "04-mastery-boundary",
    promptId: "04-mastery-boundary",
    attemptedAt: state.lastSessionAt,
    answer:
      "Domain and application code depend inward; the architecture gate detects an outward cross-context import, and exact restoration plus both passing gates proves recovery.",
    confidencePercent: 90,
    predictedOutcome: "accurate",
    outcome: "accurate",
    purpose: "mastery",
    status: "evaluated",
    calibrationNote:
      "My confidence is supported by the observed failure, exact byte restoration, and two passing checks.",
    misconception: null,
    correction: null,
    selfEvaluation: {
      criteria: [
        {
          criterionId: "04-prediction",
          score: 2,
          evidence:
            "I predicted the forbidden cross-context dependency before running it.",
        },
        {
          criterionId: "04-mechanism",
          score: 2,
          evidence:
            "I explained how static import inspection enforces inward dependencies.",
        },
        {
          criterionId: "04-proof-and-recovery",
          score: 2,
          evidence:
            "I linked the observed failure, restored fingerprint, and both passing gates.",
        },
      ],
    },
    feedback: feedback(
      "No remaining dependency-direction or recovery gap was observed.",
      "Retrieve the boundary again in the queued next-session review.",
    ),
    supportLevel: "independent",
    checkRunIds,
  };
}

async function preparedRecoveryRepository(label: string): Promise<{
  repository: string;
  stateFile: string;
  target: string;
  targetRelative: string;
  cleanBytes: Buffer;
  pending: NonNullable<LearningState["current"]["recovery"]>;
  failed: LearningState["checks"][number];
}> {
  const repository = await temporaryRepository(label);
  const stateFile = path.join(repository, ".patchquest/progress.json");
  const targetRelative =
    "node/apps/mission-control/src/application/recovery-exercise.ts";
  const target = path.join(repository, targetRelative);
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(path.join(repository, "node/packages"), { recursive: true });
  await mkdir(path.join(repository, "node/scripts"), { recursive: true });
  await writeFile(target, "export const recoveryBoundary = 'clean';\n");
  const cleanBytes = await readFile(target);
  await copyFile(
    path.join(nodeRoot, "scripts/check-architecture.ts"),
    path.join(repository, "node/scripts/check-architecture.ts"),
  );
  await symlink(
    path.join(nodeRoot, "node_modules"),
    path.join(repository, "node/node_modules"),
    "dir",
  );
  await writeFile(
    path.join(repository, "node/package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: {
          architecture: "node scripts/check-architecture.ts",
          verify: "node scripts/check-architecture.ts",
        },
      },
      null,
      2,
    )}\n`,
  );
  await runCli(["init", repository]);
  await commitDraft(
    stateFile,
    "Recorded module 04 diagnostic before the deliberate proof exercise.",
    (draft) => {
      draft.retrievalAttempts.push(recoveryDiagnosticAttempt(draft));
      const reviewReason =
        "Retrieve the architecture boundary after the recovery lesson is complete.";
      draft.reviewHistory.push({
        eventId: "recovery-review-scheduled-event-04",
        eventType: "scheduled",
        reviewId: "recovery-review-04",
        priorReviewId: null,
        sessionId: draft.lastSessionId,
        promptId: "04-delayed-boundary",
        moduleId: "04",
        conceptIds: ["dependency-direction", "context-isolation"],
        atNextSession: true,
        heuristic: "next-session-unknown",
        reason: reviewReason,
        recordedAt: draft.lastSessionAt,
        retrievalEvidenceRef: null,
      });
      draft.reviewQueue.push({
        reviewId: "recovery-review-04",
        priorReviewId: null,
        scheduledBySessionId: draft.lastSessionId,
        promptId: "04-delayed-boundary",
        moduleId: "04",
        conceptIds: ["dependency-direction", "context-isolation"],
        atNextSession: true,
        heuristic: "next-session-unknown",
        reason: reviewReason,
      });
      draft.current = {
        sessionId: draft.lastSessionId,
        moduleId: "04",
        activityId: "04-forbidden-import-mutation",
        status: "learning",
        loopPhase: "act",
        supportLevel: "faded",
        pendingAction: {
          owner: "learner",
          action:
            "Prepare the bounded forbidden import exercise before running its proof.",
        },
        recovery: null,
      };
    },
  );
  await runCli([
    "recovery-prepare",
    stateFile,
    targetRelative,
    "04",
    "04-forbidden-import-mutation",
    "architecture-gate",
  ]);
  let state = await readState(stateFile);
  const pending = state.current.recovery!;
  await appendFile(target, 'import "@patchquest/workshop";\n');
  await expectCliFailure(
    ["check", stateFile, "04", "architecture-gate"],
    "CHECK_FAILED",
  );
  state = await readState(stateFile);
  return {
    repository,
    stateFile,
    target,
    targetRelative,
    cleanBytes,
    pending,
    failed: state.checks.at(-1)!,
  };
}

async function resumeRecoveryAtMidpoint(
  stateFile: string,
  expectedStatus: "pending" | "bytes_restored_recheck_pending",
): Promise<LearningState> {
  const before = await readState(stateFile);
  const beforeBytes = await readFile(stateFile, "utf8");
  const result = await runCli(["resume", stateFile]);
  expect(result.stdout).toContain(
    `resumed recovery ${before.lastSessionId} ${before.current.recovery!.recoveryId} ${expectedStatus}`,
  );
  expect(await readFile(stateFile, "utf8")).toBe(beforeBytes);
  const resumed = await readState(stateFile);
  expect(resumed.sessions).toHaveLength(before.sessions.length);
  expect(resumed.lastSessionId).toBe(before.lastSessionId);
  expect(resumed.sessions.at(-1)).toMatchObject({
    sessionId: resumed.lastSessionId,
    status: "open",
  });
  expect(resumed.current).toMatchObject({
    sessionId: resumed.lastSessionId,
    loopPhase: "recover",
  });
  expect(resumed.current.recovery).toMatchObject({
    sessionId: resumed.lastSessionId,
    status: expectedStatus,
  });
  await expect(runCli(["state", stateFile])).resolves.toMatchObject({
    stdout: expect.stringContaining("is valid"),
  });
  return resumed;
}

async function queueDueReviewDuringRecovery(
  stateFile: string,
): Promise<LearningState> {
  const state = await commitDraft(
    stateFile,
    "Queued a timed review while recovery remained the blocking current action.",
    (draft) => {
      const reason =
        "Keep the due role-boundary review queued until recovery is finalized.";
      const notBefore = new Date(
        new Date(draft.lastSessionAt).getTime() + 1,
      ).toISOString();
      draft.reviewHistory.push({
        eventId: "recovery-due-review-scheduled-event-00",
        eventType: "scheduled",
        reviewId: "recovery-due-review-00",
        priorReviewId: null,
        sessionId: draft.lastSessionId,
        promptId: "00-delayed-loop",
        moduleId: "00",
        conceptIds: ["verification-vs-approval"],
        notBefore,
        heuristic: "retention-goal",
        reason,
        recordedAt: draft.lastSessionAt,
        retrievalEvidenceRef: null,
      });
      draft.reviewQueue.push({
        reviewId: "recovery-due-review-00",
        priorReviewId: null,
        scheduledBySessionId: draft.lastSessionId,
        promptId: "00-delayed-loop",
        moduleId: "00",
        conceptIds: ["verification-vs-approval"],
        notBefore,
        heuristic: "retention-goal",
        reason,
      });
    },
  );
  expect(
    new Date(state.reviewQueue.at(-1)!.notBefore!).getTime(),
  ).toBeLessThanOrEqual(new Date(state.lastSessionAt).getTime());
  expect(state.current.loopPhase).toBe("recover");
  return state;
}

describe("learning CLI lifecycle", () => {
  it("initializes, repairs its projection, resumes, and preserves state on an injected crash", async () => {
    const repository = await temporaryRepository("lifecycle");
    const target = path.join(repository, ".patchquest");
    const stateFile = path.join(target, "progress.json");
    const logFile = path.join(target, "learning-log.md");

    const initialized = await runCli(["init", repository]);
    expect(initialized.stdout).toContain("learning init: created");
    const initialState = await readFile(stateFile, "utf8");

    await unlink(logFile);
    const validated = await runCli(["state", stateFile]);
    expect(validated.stdout).toContain("log projection created");
    expect(await readFile(stateFile, "utf8")).toBe(initialState);

    await writeFile(logFile, "stale projection\n");
    const projected = await runCli(["log", stateFile]);
    expect(projected.stdout).toContain("learning log projection: updated");
    expect(await readFile(stateFile, "utf8")).toBe(initialState);
    expect(await readFile(logFile, "utf8")).toContain(
      "Derived from `.patchquest/progress.json`",
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runCli(["resume", stateFile]);
    const resumed = await readState(stateFile);
    expect(resumed.sessions).toHaveLength(2);
    expect(resumed.checkpoints).toHaveLength(2);
    expect(resumed.sessions[0]).toMatchObject({ status: "closed" });
    expect(resumed.sessions[1]).toMatchObject({ status: "open" });
    expect(await readdir(path.join(target, "backups"))).toHaveLength(1);

    const beforeFailure = await readFile(stateFile, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expectCliFailure(["resume", stateFile], "ATOMIC_WRITE_INJECTED", {
      NODE_ENV: "test",
      PATCHQUEST_TEST_FAIL_ATOMIC_WRITE: "before-rename",
    });
    expect(await readFile(stateFile, "utf8")).toBe(beforeFailure);
    expect((await readdir(target)).some((name) => name.includes(".tmp-"))).toBe(
      false,
    );

    const draftFile = path.join(target, "progress.draft.json");
    const draft = await readState(stateFile);
    draft.current.pendingAction = {
      owner: "learner",
      action:
        "Answer the saved retrieval prompt before inspecting more source.",
    };
    await writeState(draftFile, draft);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expectCliFailure(
      [
        "checkpoint",
        stateFile,
        draftFile,
        "Persisted the next bounded learner action through a draft.",
      ],
      "ATOMIC_WRITE_INJECTED",
      {
        NODE_ENV: "test",
        PATCHQUEST_TEST_FAIL_ATOMIC_WRITE: "before-rename",
      },
    );
    expect(await readFile(stateFile, "utf8")).toBe(beforeFailure);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runCli([
      "checkpoint",
      stateFile,
      draftFile,
      "Persisted the next bounded learner action through a draft.",
    ]);
    await expect(readFile(draftFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await readState(stateFile)).current.pendingAction.action).toContain(
      "saved retrieval prompt",
    );
  });

  it("uses one order-independent canonical digest for a module gate set", () => {
    const checks = [
      {
        checkId: "complete-verify",
        activityId: "04-recovery-and-verify",
        command: "cd node && npm run verify",
      },
      {
        checkId: "architecture-gate",
        activityId: "04-architecture-check",
        command: "cd node && npm run architecture",
      },
    ];

    expect(canonicalGateDigest("04", checks)).toBe(
      canonicalGateDigest("04", [...checks].reverse()),
    );
    expect(canonicalGateDigest("04", checks)).not.toBe(
      canonicalGateDigest("02", checks),
    );
  });

  it("excludes generated and local-only files from repository revision evidence", async () => {
    const repository = await temporaryRepository("inventory");
    await mkdir(path.join(repository, "src"), { recursive: true });
    await mkdir(path.join(repository, "coverage"), { recursive: true });
    await mkdir(path.join(repository, "dist"), { recursive: true });
    await writeFile(
      path.join(repository, "src/index.ts"),
      "export const n = 1;\n",
    );
    await writeFile(path.join(repository, ".env"), "SECRET=first\n");
    await writeFile(path.join(repository, "coverage/result.json"), "{}\n");
    await writeFile(path.join(repository, "dist/index.js"), "generated\n");
    await writeFile(path.join(repository, "cache.tsbuildinfo"), "generated\n");

    expect(await canonicalSourceInventory(repository)).toEqual([
      "src/index.ts",
    ]);
    const before = await computeRepositoryRevision(repository);
    await writeFile(path.join(repository, ".env"), "SECRET=second\n");
    await writeFile(path.join(repository, "coverage/result.json"), '{"x":1}\n');
    expect(await computeRepositoryRevision(repository)).toBe(before);
    await writeFile(
      path.join(repository, "src/index.ts"),
      "export const n = 2;\n",
    );
    expect(await computeRepositoryRevision(repository)).not.toBe(before);
  });
});

describe("documented public learning journeys", () => {
  it("runs init through diagnostic, proof, mastery correction, completion, delayed review, and resume", async () => {
    const repository = await temporaryRepository("journey");
    const stateFile = path.join(repository, ".patchquest/progress.json");
    await runCli(["init", repository]);

    let state = await commitDraft(
      stateFile,
      "Recorded the source-closed diagnostic before active module work.",
      (draft) => {
        draft.retrievalAttempts.push(diagnosticAttempt(draft));
        draft.current = {
          sessionId: draft.lastSessionId,
          moduleId: "03",
          activityId: "03-scenario-contrast",
          status: "learning",
          loopPhase: "acquire",
          supportLevel: "worked-example",
          pendingAction: {
            owner: "learner",
            action:
              "Compare the duplicate and infrastructure scenarios using the worked example.",
          },
          recovery: null,
        };
      },
    );
    expect(state.retrievalAttempts[0]).toMatchObject({
      purpose: "diagnostic",
      status: "evaluated",
      checkRunIds: [],
    });

    state = await commitDraft(
      stateFile,
      "Recorded bounded active work before running the acceptance proof.",
      (draft) => {
        for (const [activityId, evidence] of [
          [
            "03-scenario-contrast",
            "Compared duplicate delivery with an interrupted infrastructure operation.",
          ],
          [
            "03-retry-explanation",
            "Explained how the owning context decides whether retry is safe.",
          ],
        ] as const)
          draft.completedActivities.push({
            activityRunId: `journey-${activityId}`,
            sessionId: draft.lastSessionId,
            moduleId: "03",
            activityId,
            completedAt: draft.lastSessionAt,
            evidence: [evidence],
            checkRunIds: [],
          });
        draft.current.activityId = "03-acceptance-check";
        draft.current.loopPhase = "prove";
        draft.current.supportLevel = "faded";
        draft.current.pendingAction.action =
          "Run the catalogued acceptance check and record its actual result.";
      },
    );
    expect(state.completedActivities).toHaveLength(2);

    const checked = await runCli(
      ["check", stateFile, "03", "acceptance-gate"],
      {
        NODE_ENV: "test",
        PATCHQUEST_TEST_REPOSITORY_ROOT: courseRoot,
      },
    );
    expect(checked.stdout).toContain(" passed sha256:");
    state = await readState(stateFile);
    const check = state.checks.at(-1)!;
    expect(check).toMatchObject({
      moduleId: "03",
      activityId: "03-acceptance-check",
      checkId: "acceptance-gate",
      command: "cd node && npm run acceptance",
      recordedBy: "learning:check",
      outcome: "passed",
      exitCode: 0,
    });

    await commitDraft(
      stateFile,
      "Bound the passing acceptance evidence to the final active-work record.",
      (draft) => {
        draft.completedActivities.push({
          activityRunId: "journey-03-acceptance-check",
          sessionId: draft.lastSessionId,
          moduleId: "03",
          activityId: "03-acceptance-check",
          completedAt: draft.lastSessionAt,
          evidence: [
            "The catalogued acceptance gate passed and its check run is linked.",
          ],
          checkRunIds: [check.checkRunId],
        });
        draft.current.activityId = "03-mastery-failure";
        draft.current.loopPhase = "retrieve";
        draft.current.supportLevel = "independent";
        draft.current.pendingAction.action =
          "Close the source and answer the final mastery failure prompt.";
      },
    );

    state = await commitDraft(
      stateFile,
      "Evaluated the final source-closed mastery attempt and preserved its gap.",
      (draft) => {
        draft.retrievalAttempts.push(masteryAttempt(draft, check.checkRunId));
        draft.current.loopPhase = "correct";
        draft.current.pendingAction.action =
          "Revise the mastery answer from memory and state the duplicate consequence.";
      },
    );
    expect(state.retrievalAttempts.at(-1)).toMatchObject({
      purpose: "mastery",
      status: "awaiting_revision",
      checkRunIds: [check.checkRunId],
    });
    expect(state.completedModules).toHaveLength(0);

    const correctionSessionId = state.lastSessionId;
    const correctionCheckpointCount = state.checkpoints.length;
    const beforeCorrectionResume = await readFile(stateFile, "utf8");
    const correctionResume = await runCli(["resume", stateFile]);
    expect(correctionResume.stdout).toContain(
      `resumed correction ${correctionSessionId} journey-mastery-03`,
    );
    expect(await readFile(stateFile, "utf8")).toBe(beforeCorrectionResume);
    state = await readState(stateFile);
    expect(state.lastSessionId).toBe(correctionSessionId);
    expect(state.sessions).toHaveLength(1);
    expect(state.checkpoints).toHaveLength(correctionCheckpointCount);
    expect(state.current).toMatchObject({
      sessionId: correctionSessionId,
      moduleId: "03",
      activityId: "03-mastery-failure",
      loopPhase: "correct",
    });

    state = await commitDraft(
      stateFile,
      "Linked accurate mastery revision, delayed review, and post-proof completion evidence.",
      (draft) => {
        draft.retrievalAttempts.at(-1)!.status = "evaluated";
        draft.revisions.push(masteryRevision(draft, check.checkRunId));
        const reviewReason =
          "Retrieve a fresh failure classification next session before lengthening the gap.";
        draft.reviewHistory.push({
          eventId: "journey-review-scheduled-event-03",
          eventType: "scheduled",
          reviewId: "journey-review-03",
          priorReviewId: null,
          sessionId: draft.lastSessionId,
          promptId: "03-delayed-failure",
          moduleId: "03",
          conceptIds: ["idempotency", "domain-vs-infrastructure-failure"],
          atNextSession: true,
          heuristic: "corrected-sooner",
          reason: reviewReason,
          recordedAt: draft.lastSessionAt,
          retrievalEvidenceRef: null,
        });
        draft.reviewQueue = [
          {
            reviewId: "journey-review-03",
            priorReviewId: null,
            scheduledBySessionId: draft.lastSessionId,
            promptId: "03-delayed-failure",
            moduleId: "03",
            conceptIds: ["idempotency", "domain-vs-infrastructure-failure"],
            atNextSession: true,
            heuristic: "corrected-sooner",
            reason: reviewReason,
          },
        ];
        draft.completedModules.push({
          completionId: "journey-completion-03",
          moduleId: "03",
          sessionId: draft.lastSessionId,
          completedAt: draft.lastSessionAt,
          repositoryRevision: check.repositoryRevision,
          gateDigest: check.gateDigest,
          rubric: { passed: true, criteria: module03Criteria(2) },
          activityRunIds: [
            "journey-03-scenario-contrast",
            "journey-03-retry-explanation",
            "journey-03-acceptance-check",
          ],
          checkRunIds: [check.checkRunId],
          retrievalEvidenceRefs: [
            {
              attemptId: "journey-mastery-03",
              revisionId: "journey-mastery-revision-03",
            },
          ],
          delayedReviewIds: ["journey-review-03"],
          firstPersonTakeaway:
            "I can distinguish retryable interruption, domain rejection, and idempotent duplicate handling by owner and consequence.",
        });
        draft.current = {
          sessionId: draft.lastSessionId,
          moduleId: "01",
          activityId: "01-boundaries",
          status: "learning",
          loopPhase: "acquire",
          supportLevel: "worked-example",
          pendingAction: {
            owner: "learner",
            action:
              "Inspect the module 01 boundary diagram after the next-session review.",
          },
          recovery: null,
        };
      },
    );
    expect(state.completedModules).toHaveLength(1);
    expect(state.completedModules[0]!.retrievalEvidenceRefs).toEqual([
      {
        attemptId: "journey-mastery-03",
        revisionId: "journey-mastery-revision-03",
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runCli(["resume", stateFile]);
    state = await readState(stateFile);
    expect(state.lastSessionId).not.toBe(correctionSessionId);
    expect(state.sessions).toHaveLength(2);
    expect(state.current).toMatchObject({
      status: "review",
      moduleId: "03",
      activityId: "03-delayed-failure",
    });

    state = await commitDraft(
      stateFile,
      "Evaluated the due delayed retrieval and removed its completed queue identity.",
      (draft) => {
        draft.retrievalAttempts.push(delayedAttempt(draft));
        const scheduled = draft.reviewHistory[0]!;
        draft.reviewHistory.push({
          ...scheduled,
          eventId: "journey-review-completed-event-03",
          eventType: "completed",
          sessionId: draft.lastSessionId,
          recordedAt: draft.lastSessionAt,
          retrievalEvidenceRef: {
            attemptId: "journey-delayed-03",
            revisionId: null,
          },
        });
        draft.reviewQueue = [];
        draft.current = {
          sessionId: draft.lastSessionId,
          moduleId: "01",
          activityId: "01-boundaries",
          status: "learning",
          loopPhase: "acquire",
          supportLevel: "worked-example",
          pendingAction: {
            owner: "learner",
            action:
              "Inspect the module 01 boundary diagram and answer its diagnostic prompt.",
          },
          recovery: null,
        };
      },
    );
    expect(state.reviewQueue).toEqual([]);
    expect(state.reviewHistory.at(-1)).toMatchObject({
      eventType: "completed",
      retrievalEvidenceRef: {
        attemptId: "journey-delayed-03",
        revisionId: null,
      },
    });
    expect(state.retrievalAttempts.at(-1)).toMatchObject({
      purpose: "delayed-review",
      outcome: "accurate",
      status: "evaluated",
    });
    await expect(runCli(["state", stateFile])).resolves.toMatchObject({
      stdout: expect.stringContaining("is valid"),
    });
  }, 30_000);

  it("prepares a bounded mutation, records its real failure, restores exact bytes, and links the passing recheck", async () => {
    const { stateFile, target, cleanBytes, pending, failed } =
      await preparedRecoveryRepository("recovery-success");
    expect(pending).toMatchObject({
      moduleId: "04",
      activityId: "04-forbidden-import-mutation",
      expectedFailingCheckId: "architecture-gate",
      expectedFailureCheckRunId: null,
      restorationCheckRunId: null,
      restoredFingerprint: null,
      status: "pending",
    });
    expect(failed).toMatchObject({
      checkId: "architecture-gate",
      outcome: "failed",
    });

    const restored = await runCli(["recovery-restore", stateFile]);
    expect(restored.stdout).toContain("learning recovery restored:");
    expect(await readFile(target)).toEqual(cleanBytes);
    let state = await readState(stateFile);
    const passed = state.checks.at(-1)!;
    const restoredEvent = state.recoveryHistory.at(-1)!;
    expect(passed).toMatchObject({
      checkId: "architecture-gate",
      outcome: "passed",
      exitCode: 0,
    });
    expect(restoredEvent).toMatchObject({
      recoveryId: pending.recoveryId,
      status: "restored",
      expectedFailureCheckRunId: failed.checkRunId,
      restorationCheckRunId: passed.checkRunId,
      restoredFingerprint: pending.preExerciseFingerprint,
    });
    expect(state.recoveryHistory.map((event) => event.status)).toEqual([
      "pending",
      "bytes_restored_recheck_pending",
      "restored",
    ]);
    expect(state.current.recovery).toBeNull();
    expect(state.current).toMatchObject({
      moduleId: "04",
      activityId: "04-recovery-and-verify",
      loopPhase: "prove",
    });
    await expect(runCli(["state", stateFile])).resolves.toMatchObject({
      stdout: expect.stringContaining("is valid"),
    });

    const originalSessionId = state.lastSessionId;
    await runCli(["check", stateFile, "04", "complete-verify"]);
    state = await readState(stateFile);
    const completeCheck = state.checks.at(-1)!;
    expect(completeCheck).toMatchObject({
      checkId: "complete-verify",
      sessionId: originalSessionId,
      outcome: "passed",
    });
    expect(completeCheck.repositoryRevision).toBe(passed.repositoryRevision);
    expect(completeCheck.gateDigest).toBe(passed.gateDigest);

    await commitDraft(
      stateFile,
      "Recorded all module 04 active-work evidence after recovery finalized.",
      (draft) => {
        for (const activity of [
          {
            activityRunId: "recovery-activity-architecture-04",
            activityId: "04-architecture-check",
            evidence:
              "Observed the architecture gate reject the deliberate outward dependency.",
            checkRunIds: [passed.checkRunId],
          },
          {
            activityRunId: "recovery-activity-mutation-04",
            activityId: "04-forbidden-import-mutation",
            evidence:
              "Made only the prepared forbidden import and retained its failed check evidence.",
            checkRunIds: [failed.checkRunId],
          },
          {
            activityRunId: "recovery-activity-verify-04",
            activityId: "04-recovery-and-verify",
            evidence:
              "Restored the exact fingerprint and recorded both passing module gates.",
            checkRunIds: [passed.checkRunId, completeCheck.checkRunId],
          },
        ])
          draft.completedActivities.push({
            ...activity,
            sessionId: draft.lastSessionId,
            moduleId: "04",
            completedAt: draft.lastSessionAt,
            evidence: [activity.evidence],
          });
        draft.current = {
          sessionId: draft.lastSessionId,
          moduleId: "04",
          activityId: "04-mastery-boundary",
          status: "learning",
          loopPhase: "retrieve",
          supportLevel: "independent",
          pendingAction: {
            owner: "learner",
            action:
              "Close the source and answer the module 04 mastery boundary prompt.",
          },
          recovery: null,
        };
      },
    );
    const masteryCheckRunIds = [passed.checkRunId, completeCheck.checkRunId];
    state = await commitDraft(
      stateFile,
      "Evaluated accurate source-closed module 04 mastery after all proof.",
      (draft) => {
        draft.retrievalAttempts.push(
          recoveryMasteryAttempt(draft, masteryCheckRunIds),
        );
        draft.current.loopPhase = "record";
        draft.current.pendingAction.action =
          "Record evidence-linked completion and retain the queued review.";
      },
    );
    expect(state.retrievalAttempts.at(-1)).toMatchObject({
      attemptId: "recovery-mastery-04",
      purpose: "mastery",
      outcome: "accurate",
      sessionId: originalSessionId,
    });

    state = await commitDraft(
      stateFile,
      "Completed module 04 in the original recovery session.",
      (draft) => {
        draft.completedModules.push({
          completionId: "recovery-completion-04",
          moduleId: "04",
          sessionId: draft.lastSessionId,
          completedAt: draft.lastSessionAt,
          repositoryRevision: completeCheck.repositoryRevision,
          gateDigest: completeCheck.gateDigest,
          rubric: {
            passed: true,
            criteria: [
              {
                criterionId: "04-prediction",
                score: 2,
                evidence:
                  "The prediction matched the observed architecture failure.",
              },
              {
                criterionId: "04-mechanism",
                score: 2,
                evidence:
                  "The explanation identifies static import inspection and inward dependency.",
              },
              {
                criterionId: "04-proof-and-recovery",
                score: 2,
                evidence:
                  "The exact restoration and both passing check runs are linked.",
              },
            ],
          },
          activityRunIds: [
            "recovery-activity-architecture-04",
            "recovery-activity-mutation-04",
            "recovery-activity-verify-04",
          ],
          checkRunIds: masteryCheckRunIds,
          retrievalEvidenceRefs: [
            { attemptId: "recovery-mastery-04", revisionId: null },
          ],
          delayedReviewIds: ["recovery-review-04"],
          firstPersonTakeaway:
            "I can predict an outward dependency violation, prove it fails, and recover exact bytes safely.",
        });
        draft.current = {
          sessionId: draft.lastSessionId,
          moduleId: "01",
          activityId: "01-boundaries",
          status: "learning",
          loopPhase: "acquire",
          supportLevel: "worked-example",
          pendingAction: {
            owner: "learner",
            action:
              "Resume later so the queued architecture review becomes current.",
          },
          recovery: null,
        };
      },
    );
    expect(state.lastSessionId).toBe(originalSessionId);
    expect(state.completedModules.at(-1)).toMatchObject({
      moduleId: "04",
      sessionId: originalSessionId,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runCli(["resume", stateFile]);
    state = await readState(stateFile);
    expect(state.lastSessionId).not.toBe(originalSessionId);
    expect(state.current).toMatchObject({
      status: "review",
      moduleId: "04",
      activityId: "04-delayed-boundary",
    });
  }, 30_000);

  it("recovers when interruption occurs after exact bytes are restored but before intermediate state persists", async () => {
    const { stateFile, target, cleanBytes, pending } =
      await preparedRecoveryRepository("recovery-after-bytes");
    await expectCliFailure(
      ["recovery-restore", stateFile],
      "RECOVERY_BYTES_PERSIST_INJECTED",
      {
        NODE_ENV: "test",
        PATCHQUEST_TEST_FAIL_RECOVERY_AFTER_BYTES: "1",
      },
    );
    expect(await readFile(target)).toEqual(cleanBytes);
    let state = await readState(stateFile);
    expect(state.current.recovery).toMatchObject({
      recoveryId: pending.recoveryId,
      status: "pending",
    });
    expect(state.reviewQueue[0]).toMatchObject({
      reviewId: "recovery-review-04",
      atNextSession: true,
    });
    state = await resumeRecoveryAtMidpoint(stateFile, "pending");
    expect(await readFile(target)).toEqual(cleanBytes);
    expect(state.current.recovery).toMatchObject({
      recoveryId: pending.recoveryId,
      sessionId: state.lastSessionId,
      status: "pending",
    });
    expect(state.current.status).toBe("blocked");
    expect(state.reviewQueue[0]?.reviewId).toBe("recovery-review-04");

    await runCli(["recovery-restore", stateFile]);
    state = await readState(stateFile);
    expect(state.current.recovery).toBeNull();
    expect(state.recoveryHistory.map((event) => event.status)).toEqual([
      "pending",
      "bytes_restored_recheck_pending",
      "restored",
    ]);
  }, 30_000);

  it("keeps restored bytes and intermediate authority through failed and blocked rechecks, then retries", async () => {
    const failedCase = await preparedRecoveryRepository(
      "recovery-failed-recheck",
    );
    const secondViolation = path.join(
      failedCase.repository,
      "node/apps/mission-control/src/application/second-violation.ts",
    );
    await writeFile(secondViolation, 'import "@patchquest/workshop";\n');
    await expectCliFailure(
      ["recovery-restore", failedCase.stateFile],
      "RECOVERY_RECHECK_NOT_PASSING",
    );
    expect(await readFile(failedCase.target)).toEqual(failedCase.cleanBytes);
    let state = await readState(failedCase.stateFile);
    expect(state.current.recovery?.status).toBe(
      "bytes_restored_recheck_pending",
    );
    expect(state.checks.at(-1)?.outcome).toBe("failed");
    state = await queueDueReviewDuringRecovery(failedCase.stateFile);
    expect(state.reviewQueue.at(-1)).toMatchObject({
      reviewId: "recovery-due-review-00",
      moduleId: "00",
    });
    await resumeRecoveryAtMidpoint(
      failedCase.stateFile,
      "bytes_restored_recheck_pending",
    );
    expect(await readFile(failedCase.target)).toEqual(failedCase.cleanBytes);
    await rm(secondViolation);
    await runCli(["recovery-restore", failedCase.stateFile]);
    expect((await readState(failedCase.stateFile)).current.recovery).toBeNull();

    const blockedCase = await preparedRecoveryRepository(
      "recovery-blocked-recheck",
    );
    await expectCliFailure(
      ["recovery-restore", blockedCase.stateFile],
      "RECOVERY_RECHECK_NOT_PASSING",
      { PATH: "/path-without-npm" },
    );
    expect(await readFile(blockedCase.target)).toEqual(blockedCase.cleanBytes);
    state = await readState(blockedCase.stateFile);
    expect(state.current.recovery?.status).toBe(
      "bytes_restored_recheck_pending",
    );
    expect(state.checks.at(-1)?.outcome).toBe("blocked");
    await resumeRecoveryAtMidpoint(
      blockedCase.stateFile,
      "bytes_restored_recheck_pending",
    );
    expect(await readFile(blockedCase.target)).toEqual(blockedCase.cleanBytes);
    await runCli(["recovery-restore", blockedCase.stateFile]);
    expect(
      (await readState(blockedCase.stateFile)).current.recovery,
    ).toBeNull();
  }, 45_000);

  it("retries finalization after an injected crash following the passing recheck", async () => {
    const { stateFile, target, cleanBytes } = await preparedRecoveryRepository(
      "recovery-after-pass",
    );
    await expectCliFailure(
      ["recovery-restore", stateFile],
      "RECOVERY_FINALIZE_INJECTED",
      {
        NODE_ENV: "test",
        PATCHQUEST_TEST_FAIL_RECOVERY_AFTER_PASS: "1",
      },
    );
    expect(await readFile(target)).toEqual(cleanBytes);
    let state = await readState(stateFile);
    expect(state.current.recovery?.status).toBe(
      "bytes_restored_recheck_pending",
    );
    expect(state.checks.at(-1)?.outcome).toBe("passed");
    const checkCountAfterCrash = state.checks.length;
    await resumeRecoveryAtMidpoint(stateFile, "bytes_restored_recheck_pending");
    expect(await readFile(target)).toEqual(cleanBytes);

    await runCli(["recovery-restore", stateFile]);
    state = await readState(stateFile);
    expect(state.current.recovery).toBeNull();
    expect(state.checks).toHaveLength(checkCountAfterCrash);
    expect(state.recoveryHistory.at(-1)).toMatchObject({
      status: "restored",
      restorationCheckRunId: state.checks.at(-1)!.checkRunId,
    });
  }, 30_000);
});

describe("checkpoint evidence integrity", () => {
  it("rejects retroactive answer, feedback, check, review, and session mutation", async () => {
    const directory = await temporaryRepository("checkpoint-integrity");
    const stateFile = path.join(directory, "progress.json");
    const mutations: Array<{
      name: string;
      apply: (state: LearningState) => void;
    }> = [
      {
        name: "answer",
        apply: (state) => {
          state.retrievalAttempts[0]!.answer +=
            " This sentence was appended after checkpointing.";
        },
      },
      {
        name: "feedback",
        apply: (state) => {
          state.retrievalAttempts[0]!.feedback.observedEvidence +=
            " Retroactive feedback mutation.";
        },
      },
      {
        name: "check",
        apply: (state) => {
          state.checks[0]!.evidence += " Retroactive operational detail.";
        },
      },
      {
        name: "review",
        apply: (state) => {
          state.reviewHistory[0]!.reason += " Retroactive review detail.";
          state.reviewQueue[0]!.reason += " Retroactive review detail.";
        },
      },
      {
        name: "session",
        apply: (state) => {
          state.sessions[0]!.startedAt = "2026-07-17T11:59:59Z";
        },
      },
    ];

    for (const mutation of mutations) {
      const state = await evaluatedState();
      mutation.apply(state);
      await writeState(stateFile, state);
      await expectCliFailure(
        ["state", stateFile],
        mutation.name === "review"
          ? "CHECKPOINT_LATEST_STALE"
          : "CHECKPOINT_EVIDENCE_STALE",
      );
    }
  });

  it("rejects overlapping sessions and out-of-order attempt evidence", async () => {
    const directory = await temporaryRepository("chronology");
    const stateFile = path.join(directory, "progress.json");
    const overlap = await evaluatedState();
    overlap.sessions[1]!.startedAt = "2026-07-17T12:29:00Z";
    await writeState(stateFile, overlap);
    await expectCliFailure(["state", stateFile], "SESSION_OVERLAP");

    const revisionBeforeAttempt = await evaluatedState();
    revisionBeforeAttempt.revisions[0]!.evaluatedAt = "2026-07-17T12:14:00Z";
    await writeState(stateFile, revisionBeforeAttempt);
    await expectCliFailure(["state", stateFile], "REVISION_BEFORE_ATTEMPT");

    const completionBeforeRevision = await evaluatedState();
    completionBeforeRevision.revisions[0]!.evaluatedAt = "2026-07-17T12:24:00Z";
    completionBeforeRevision.completedModules[0]!.completedAt =
      "2026-07-17T12:23:00Z";
    await writeState(stateFile, completionBeforeRevision);
    await expectCliFailure(["state", stateFile], "COMPLETION_BEFORE_REVISION");
  });
});
