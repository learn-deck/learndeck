import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Ajv as AjvInstance,
  AnySchema,
  Options,
  ValidateFunction,
} from "ajv";

type DataObject = Record<string, unknown>;
type Outcome = "accurate" | "partial" | "incorrect";
type RequiredCheck = {
  checkId: string;
  activityId: string;
  command: string;
};
type ModuleEntry = {
  id: string;
  title: string;
  availability: "ready" | "planned";
  conceptIds: string[];
  source?: string;
  activityIds?: string[];
  completionActivityIds?: string[];
  retrievalPromptIds?: string[];
  diagnosticPromptIds?: string[];
  masteryPromptIds?: string[];
  delayedRetrievalPromptIds?: string[];
  rubricCriterionIds?: string[];
  requiredChecks?: RequiredCheck[];
  implementationEvidence?: string[];
  correctionRequiredFor?: Outcome[];
  interleaveOnlyWith?: string[];
};
type ReadyModule = ModuleEntry & {
  availability: "ready";
  source: string;
  activityIds: string[];
  completionActivityIds: string[];
  retrievalPromptIds: string[];
  diagnosticPromptIds: string[];
  masteryPromptIds: string[];
  delayedRetrievalPromptIds: string[];
  rubricCriterionIds: string[];
  requiredChecks: RequiredCheck[];
  implementationEvidence: string[];
  correctionRequiredFor: Outcome[];
  interleaveOnlyWith: string[];
};
type ModuleCatalog = { schemaVersion: 1; modules: ModuleEntry[] };
type Session = {
  sessionId: string;
  status: "open" | "closed";
  startedAt: string;
  endedAt: string | null;
};
type RubricCriterion = {
  criterionId: string;
  score: number;
  evidence: string;
};
type Feedback = {
  target: string;
  observedEvidence: string;
  exactGap: string;
  process: string;
  correctiveSupport: string;
  nextAction: string;
  selfMonitoringQuestion: string;
};
type EvaluatedRevision = {
  revisionId: string;
  attemptId: string;
  sessionId: string;
  moduleId: string;
  activityId: string;
  promptId: string;
  answer: string;
  confidencePercent: number;
  predictedOutcome: Outcome;
  outcome: Outcome;
  calibrationNote: string;
  selfEvaluation: { criteria: RubricCriterion[] };
  feedback: Feedback;
  evidence: string;
  evaluatedAt: string;
  checkRunIds: string[];
};
type RetrievalAttempt = {
  attemptId: string;
  sessionId: string;
  activityId: string;
  promptId: string;
  moduleId: string;
  conceptIds: string[];
  attemptedAt: string;
  answer: string;
  confidencePercent: number;
  predictedOutcome: Outcome;
  outcome: Outcome;
  purpose: "diagnostic" | "mastery" | "delayed-review";
  status: "awaiting_revision" | "evaluated";
  calibrationNote: string;
  misconception: string | null;
  correction: string | null;
  selfEvaluation: { criteria: RubricCriterion[] };
  feedback: Feedback;
  supportLevel: "worked-example" | "faded" | "independent";
  checkRunIds: string[];
};
type CompletedActivity = {
  activityRunId: string;
  sessionId: string;
  moduleId: string;
  activityId: string;
  completedAt: string;
  evidence: string[];
  checkRunIds: string[];
};
type Check = {
  checkRunId: string;
  checkId: string;
  sessionId: string;
  moduleId: string;
  activityId: string;
  command: string;
  repositoryRevision: string;
  gateDigest: string;
  recordedBy: "learning:check";
  exitCode: number;
  outcome: "passed" | "failed" | "blocked";
  recordedAt: string;
  evidence: string;
};
type RetrievalEvidenceRef = {
  attemptId: string;
  revisionId: string | null;
};
type CompletedModule = {
  completionId: string;
  moduleId: string;
  sessionId: string;
  completedAt: string;
  repositoryRevision: string;
  gateDigest: string;
  rubric: { passed: true; criteria: RubricCriterion[] };
  activityRunIds: string[];
  checkRunIds: string[];
  retrievalEvidenceRefs: RetrievalEvidenceRef[];
  delayedReviewIds: string[];
  firstPersonTakeaway: string;
};
type ReviewTiming =
  | { notBefore: string; atNextSession?: never }
  | {
      atNextSession: true;
      notBefore?: never;
    };
type ReviewSchedule = ReviewTiming & {
  reviewId: string;
  priorReviewId: string | null;
  scheduledBySessionId: string;
  promptId: string;
  moduleId: string;
  conceptIds: string[];
  heuristic:
    | "corrected-sooner"
    | "successful-later"
    | "retention-goal"
    | "next-session-unknown";
  reason: string;
};
type ReviewEvent = ReviewTiming & {
  eventId: string;
  eventType: "scheduled" | "completed" | "rescheduled";
  reviewId: string;
  priorReviewId: string | null;
  sessionId: string;
  promptId: string;
  moduleId: string;
  conceptIds: string[];
  heuristic: ReviewSchedule["heuristic"];
  reason: string;
  recordedAt: string;
  retrievalEvidenceRef: RetrievalEvidenceRef | null;
};
type RecoveryRecord = {
  eventId?: string;
  recoveryId: string;
  sessionId: string;
  moduleId: string;
  activityId: string;
  target: string;
  preExerciseReference: string;
  preExerciseFingerprint: string;
  deliberateMutation: string;
  expectedFailingCheckId: string;
  expectedFailingCommand: string;
  expectedFailureCheckRunId: string | null;
  restorationCheckRunId: string | null;
  restorationAction: string;
  restoredFingerprint: string | null;
  status: "pending" | "bytes_restored_recheck_pending" | "restored";
  recordedAt: string;
  recoveredAt: string | null;
};
type RecoveryEvent = RecoveryRecord & { eventId: string };
type CurrentActivity = {
  sessionId: string;
  moduleId: string;
  activityId: string;
  status: "calibration" | "learning" | "review" | "blocked" | "complete";
  loopPhase: string;
  supportLevel: "worked-example" | "faded" | "independent";
  pendingAction: { owner: "learner" | "guide"; action: string };
  recovery: RecoveryRecord | null;
};
export type LearningState = {
  schemaVersion: 1;
  sessions: Session[];
  calibration: {
    status: "unassessed" | "concept-specific";
    evidence: string[];
    retentionGoal: string;
    assessedAt: string | null;
  };
  current: CurrentActivity;
  completedModules: CompletedModule[];
  completedActivities: CompletedActivity[];
  checks: Check[];
  conceptLevels: Array<{
    conceptId: string;
    sessionId: string;
    level: "worked-example" | "faded" | "independent";
    evidence: string;
    updatedAt: string;
  }>;
  retrievalAttempts: RetrievalAttempt[];
  revisions: EvaluatedRevision[];
  reviewQueue: ReviewSchedule[];
  reviewHistory: ReviewEvent[];
  recoveryHistory: RecoveryEvent[];
  checkpoints: Checkpoint[];
  lastSessionId: string;
  lastSessionAt: string;
};
type CheckpointSnapshot = {
  current: CurrentActivity;
  calibration: LearningState["calibration"];
  conceptLevels: LearningState["conceptLevels"];
  reviewQueue: ReviewSchedule[];
  completedModuleIds: string[];
  completedActivityRunIds: string[];
  checkRunIds: string[];
  retrievalAttemptIds: string[];
  revisionIds: string[];
  recoveryEventIds: string[];
};
type Checkpoint = {
  checkpointId: string;
  sessionId: string;
  recordedAt: string;
  reason: string;
  previousDigest: string | null;
  evidenceDigest: string;
  stateDigest: string;
  snapshot: CheckpointSnapshot;
};

export class LearningIntegrityError extends Error {
  public readonly code: string;
  public readonly integrityPath: string;

  constructor(code: string, integrityPath: string, message: string) {
    super(`${code} ${integrityPath}: ${message}`);
    this.name = "LearningIntegrityError";
    this.code = code;
    this.integrityPath = integrityPath;
  }
}

function fail(code: string, integrityPath: string, message: string): never {
  throw new LearningIntegrityError(code, integrityPath || "/", message);
}

const require = createRequire(import.meta.url);
const Ajv2020: new (
  options?: Options,
) => AjvInstance = require("ajv/dist/2020.js");
const addFormats: typeof import("ajv-formats").default = require("ajv-formats");

const nodeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(nodeRoot, "..");
const courseRoot = path.join(root, "course");
const catalogFile = path.join(courseRoot, "en/module-catalog.json");
const stateSchemaFile = path.join(courseRoot, "learning-state.schema.json");
const skillRoot = path.join(root, ".agents/skills/learn-patchquest");
const stateTemplateFile = path.join(skillRoot, "assets/learning-state.json");
const logTemplateFile = path.join(skillRoot, "assets/session-log.md");
const evaluatedStateFile = path.join(
  skillRoot,
  "references/evaluated-state.example.json",
);
const evaluatedLogFile = path.join(
  skillRoot,
  "references/evaluated-learning-log.example.md",
);

const isObject = (value: unknown): value is DataObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    fail(
      "JSON_INVALID",
      file,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function verifyTrimmedStrings(value: unknown, integrityPath = ""): void {
  if (typeof value === "string") {
    if (value !== value.trim())
      fail(
        "TEXT_NOT_TRIMMED",
        integrityPath,
        "string values must be trim-normalized",
      );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      verifyTrimmedStrings(item, `${integrityPath}/${index}`),
    );
    return;
  }
  if (isObject(value))
    for (const [key, item] of Object.entries(value))
      verifyTrimmedStrings(item, `${integrityPath}/${key}`);
}

function asCatalog(value: unknown): ModuleCatalog {
  if (!isObject(value) || value["schemaVersion"] !== 1)
    fail("CATALOG_VERSION", "/schemaVersion", "catalog must use version 1");
  if (!Array.isArray(value["modules"]))
    fail("CATALOG_MODULES", "/modules", "catalog needs a module array");
  verifyTrimmedStrings(value);
  return value as ModuleCatalog;
}

function readyModule(module: ModuleEntry, index = -1): ReadyModule {
  if (module.availability !== "ready")
    fail(
      "MODULE_NOT_READY",
      `/modules/${index < 0 ? module.id : index}/availability`,
      `module ${module.id} is planned`,
    );
  return module as ReadyModule;
}

function sameIds(actual: string[], expected: string[]): boolean {
  return (
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

function requireUniqueIds(
  value: unknown,
  integrityPath: string,
  allowEmpty = false,
): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string") ||
    (!allowEmpty && value.length === 0)
  )
    fail(
      "CATALOG_ID_ARRAY",
      integrityPath,
      `expected ${allowEmpty ? "an" : "a non-empty"} ID array`,
    );
  const values = value as string[];
  if (new Set(values).size !== values.length)
    fail("CATALOG_DUPLICATE_ID", integrityPath, "IDs must be unique");
  return values;
}

function verifyCatalogSemantics(catalog: ModuleCatalog): void {
  const expectedIds = Array.from({ length: 10 }, (_, index) =>
    String(index).padStart(2, "0"),
  );
  const ids = catalog.modules.map((module) => module.id);
  if (!sameIds(ids, expectedIds))
    fail(
      "CATALOG_MODULE_SET",
      "/modules",
      "modules 00 through 09 are required",
    );
  if (ids.join(",") !== expectedIds.join(","))
    fail("CATALOG_MODULE_ORDER", "/modules", "modules must stay ordered");

  const byId = new Map(catalog.modules.map((module) => [module.id, module]));
  const globalActivityIds = new Set<string>();
  const globalPromptIds = new Set<string>();
  const executableKeys: Array<keyof ModuleEntry> = [
    "source",
    "activityIds",
    "completionActivityIds",
    "retrievalPromptIds",
    "diagnosticPromptIds",
    "masteryPromptIds",
    "delayedRetrievalPromptIds",
    "rubricCriterionIds",
    "requiredChecks",
    "implementationEvidence",
    "correctionRequiredFor",
    "interleaveOnlyWith",
  ];

  catalog.modules.forEach((module, index) => {
    const base = `/modules/${index}`;
    if (!/^[0-9]{2}$/.test(module.id) || !module.title)
      fail("CATALOG_IDENTITY", base, "module identity metadata is invalid");
    requireUniqueIds(module.conceptIds, `${base}/conceptIds`);
    if (module.availability === "planned") {
      for (const key of executableKeys)
        if (module[key] !== undefined)
          fail(
            "PLANNED_MODULE_EXECUTABLE",
            `${base}/${String(key)}`,
            `planned module ${module.id} cannot advertise executable work`,
          );
      return;
    }

    const ready = readyModule(module, index);
    if (!ready.source)
      fail(
        "READY_SOURCE_MISSING",
        `${base}/source`,
        "ready module needs a source",
      );
    const activities = requireUniqueIds(
      ready.activityIds,
      `${base}/activityIds`,
    );
    const completionActivities = requireUniqueIds(
      ready.completionActivityIds,
      `${base}/completionActivityIds`,
    );
    const prompts = requireUniqueIds(
      ready.retrievalPromptIds,
      `${base}/retrievalPromptIds`,
    );
    const diagnosticPrompts = requireUniqueIds(
      ready.diagnosticPromptIds,
      `${base}/diagnosticPromptIds`,
    );
    const masteryPrompts = requireUniqueIds(
      ready.masteryPromptIds,
      `${base}/masteryPromptIds`,
    );
    const delayedPrompts = requireUniqueIds(
      ready.delayedRetrievalPromptIds,
      `${base}/delayedRetrievalPromptIds`,
    );
    requireUniqueIds(ready.rubricCriterionIds, `${base}/rubricCriterionIds`);
    const implementationEvidence = requireUniqueIds(
      ready.implementationEvidence,
      `${base}/implementationEvidence`,
    );
    if (implementationEvidence.every((file) => file.endsWith(".md")))
      fail(
        "IMPLEMENTATION_EVIDENCE_NONEXECUTABLE",
        `${base}/implementationEvidence`,
        "a ready module needs non-Markdown executable evidence",
      );
    if (!Array.isArray(ready.requiredChecks))
      fail(
        "CATALOG_CHECKS",
        `${base}/requiredChecks`,
        "checks must be an array",
      );
    const checkIds = ready.requiredChecks.map((check) => check.checkId);
    if (new Set(checkIds).size !== checkIds.length)
      fail(
        "CATALOG_DUPLICATE_CHECK",
        `${base}/requiredChecks`,
        "check IDs repeat",
      );
    ready.requiredChecks.forEach((check, checkIndex) => {
      const checkPath = `${base}/requiredChecks/${checkIndex}`;
      if (!check.checkId || !check.command || !check.activityId)
        fail("CATALOG_CHECK_SHAPE", checkPath, "check metadata is incomplete");
      if (!activities.includes(check.activityId))
        fail(
          "CATALOG_CHECK_ACTIVITY",
          `${checkPath}/activityId`,
          "check activity is not catalogued",
        );
      if (!check.command.startsWith("cd node && npm run "))
        fail(
          "CATALOG_CHECK_COMMAND",
          `${checkPath}/command`,
          "check command must be executable from repository root",
        );
    });
    if (!sameIds(ready.correctionRequiredFor, ["partial", "incorrect"]))
      fail(
        "CATALOG_CORRECTION_OUTCOMES",
        `${base}/correctionRequiredFor`,
        "partial and incorrect retrieval require correction",
      );
    if (completionActivities.some((id) => !activities.includes(id)))
      fail(
        "CATALOG_COMPLETION_ACTIVITY",
        `${base}/completionActivityIds`,
        "completion activity is not catalogued",
      );
    if (prompts.some((id) => !activities.includes(id)))
      fail(
        "CATALOG_PROMPT_ACTIVITY",
        `${base}/retrievalPromptIds`,
        "prompt is not a catalogued activity",
      );
    if (delayedPrompts.some((id) => !prompts.includes(id)))
      fail(
        "CATALOG_DELAYED_PROMPT",
        `${base}/delayedRetrievalPromptIds`,
        "delayed prompt is not a retrieval prompt",
      );
    if (
      !sameIds(prompts, [
        ...diagnosticPrompts,
        ...masteryPrompts,
        ...delayedPrompts,
      ])
    )
      fail(
        "CATALOG_PROMPT_PURPOSE_SET",
        `${base}/retrievalPromptIds`,
        "retrieval prompts must belong to exactly one purpose set",
      );
    for (const activityId of activities) {
      if (globalActivityIds.has(activityId))
        fail("CATALOG_GLOBAL_ACTIVITY_DUPLICATE", base, activityId);
      globalActivityIds.add(activityId);
    }
    for (const promptId of prompts) {
      if (globalPromptIds.has(promptId))
        fail("CATALOG_GLOBAL_PROMPT_DUPLICATE", base, promptId);
      globalPromptIds.add(promptId);
    }
    ready.interleaveOnlyWith.forEach((targetId, targetIndex) => {
      const target = byId.get(targetId);
      if (!target || target.availability !== "ready")
        fail(
          "INTERLEAVE_TARGET_UNAVAILABLE",
          `${base}/interleaveOnlyWith/${targetIndex}`,
          targetId,
        );
      if (!(target.interleaveOnlyWith ?? []).includes(module.id))
        fail(
          "INTERLEAVE_NOT_RECIPROCAL",
          `${base}/interleaveOnlyWith/${targetIndex}`,
          `${module.id}/${targetId}`,
        );
    });
  });
}

function markdownSections(
  markdown: string,
  source: string,
): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | undefined;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      heading = line;
      if (sections.has(line)) fail("MODULE_SECTION_DUPLICATE", source, line);
      sections.set(line, "");
    } else if (heading) {
      sections.set(heading, `${sections.get(heading) ?? ""}${line}\n`);
    }
  }
  return sections;
}

function inlineIds(content: string): string[] {
  return [...content.matchAll(/`([0-9]{2}-[a-z0-9-]+)`/g)].map(
    (match) => match[1]!,
  );
}

function inlineCheckIds(content: string): string[] {
  return [...content.matchAll(/`([a-z][a-z0-9-]*(?:-gate|-verify))`/g)].map(
    (match) => match[1]!,
  );
}

function verifyModuleMarkdown(ready: ReadyModule, markdown: string): void {
  const sections = markdownSections(markdown, ready.source);
  const requiredHeadings = [
    "## Retrieval before review",
    "## Bounded action",
    "## Self-evaluation",
    "## Mastery retrieval after proof",
    "## Delayed retrieval",
  ];
  for (const heading of requiredHeadings)
    if (!sections.has(heading))
      fail("MODULE_SECTION_MISSING", ready.source, heading);

  const expectedSection = new Map<string, string>();
  for (const id of ready.retrievalPromptIds)
    expectedSection.set(
      id,
      ready.delayedRetrievalPromptIds.includes(id)
        ? "## Delayed retrieval"
        : ready.masteryPromptIds.includes(id)
          ? "## Mastery retrieval after proof"
          : "## Retrieval before review",
    );
  for (const id of ready.completionActivityIds)
    expectedSection.set(id, "## Bounded action");
  for (const id of ready.rubricCriterionIds)
    expectedSection.set(id, "## Self-evaluation");

  const observed = new Map<string, string[]>();
  for (const [heading, content] of sections)
    for (const id of [...inlineIds(content), ...inlineCheckIds(content)])
      observed.set(id, [...(observed.get(id) ?? []), heading]);
  const cataloguedIds = new Set([
    ...ready.activityIds,
    ...ready.rubricCriterionIds,
    ...ready.requiredChecks.map((check) => check.checkId),
  ]);
  for (const id of observed.keys())
    if (!cataloguedIds.has(id)) fail("MODULE_ID_UNEXPECTED", ready.source, id);
  for (const id of ready.activityIds) {
    const locations = observed.get(id) ?? [];
    if (locations.length !== 1)
      fail(
        locations.length === 0 ? "MODULE_ID_MISSING" : "MODULE_ID_DUPLICATE",
        ready.source,
        id,
      );
    const expected = expectedSection.get(id);
    if (expected && locations[0] !== expected)
      fail("MODULE_ID_MISPLACED", ready.source, `${id} belongs in ${expected}`);
  }
  for (const id of ready.rubricCriterionIds) {
    const locations = observed.get(id) ?? [];
    if (locations.length !== 1)
      fail(
        locations.length === 0 ? "MODULE_ID_MISSING" : "MODULE_ID_DUPLICATE",
        ready.source,
        id,
      );
    if (locations[0] !== "## Self-evaluation")
      fail("MODULE_ID_MISPLACED", ready.source, id);
  }
  for (const check of ready.requiredChecks) {
    const locations = observed.get(check.checkId) ?? [];
    const expectedLocations = [
      "## Bounded action",
      "## Mastery retrieval after proof",
    ];
    if (!sameIds(locations, expectedLocations))
      fail(
        locations.length < expectedLocations.length
          ? "MODULE_CHECK_ID_MISSING"
          : "MODULE_CHECK_ID_DUPLICATE",
        ready.source,
        check.checkId,
      );
  }
  const bounded = sections.get("## Bounded action") ?? "";
  ready.requiredChecks.forEach((check, index) => {
    const occurrences = bounded.split(`\`${check.command}\``).length - 1;
    if (occurrences !== 1)
      fail(
        occurrences === 0
          ? "MODULE_COMMAND_MISSING"
          : "MODULE_COMMAND_DUPLICATE",
        `${ready.source}/requiredChecks/${index}`,
        check.command,
      );
  });
}

async function verifyCatalogFiles(catalog: ModuleCatalog): Promise<void> {
  for (const [index, module] of catalog.modules.entries()) {
    if (module.availability !== "ready") continue;
    const ready = readyModule(module, index);
    const source = path.resolve(path.dirname(catalogFile), ready.source);
    if (!source.startsWith(`${path.dirname(catalogFile)}${path.sep}`))
      fail("MODULE_SOURCE_ESCAPE", `/modules/${index}/source`, ready.source);
    if (!(await exists(source)))
      fail("MODULE_SOURCE_MISSING", `/modules/${index}/source`, ready.source);
    verifyModuleMarkdown(ready, await readFile(source, "utf8"));

    for (const [
      evidenceIndex,
      relative,
    ] of ready.implementationEvidence.entries()) {
      const evidence = path.resolve(root, relative);
      if (!evidence.startsWith(`${root}${path.sep}`))
        fail(
          "IMPLEMENTATION_EVIDENCE_ESCAPE",
          `/modules/${index}/implementationEvidence/${evidenceIndex}`,
          relative,
        );
      if (!(await exists(evidence)))
        fail(
          "IMPLEMENTATION_EVIDENCE_MISSING",
          `/modules/${index}/implementationEvidence/${evidenceIndex}`,
          relative,
        );
    }
  }

  const module02 = await readFile(
    path.join(courseRoot, "en/modules/02-make-promises-executable.md"),
    "utf8",
  );
  for (const phrase of [
    "workshop.create-attempt.v1",
    "workshop.attempt-ready.v1",
  ])
    if (!module02.includes(phrase))
      fail("MODULE_02_COMMAND_EVENT", "modules/02", phrase);
}

async function stateValidator(): Promise<ValidateFunction> {
  const schema = await readJson(stateSchemaFile);
  if (!isObject(schema))
    fail("SCHEMA_SHAPE", "/", "state schema must be an object");
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  });
  addFormats(ajv);
  return ajv.compile(schema as AnySchema);
}

function validateState(
  validate: ValidateFunction,
  value: unknown,
  label: string,
): LearningState {
  if (!validate(value)) {
    const error = validate.errors?.[0];
    fail(
      "SCHEMA_INVALID",
      error?.instancePath || "/",
      `${label}: ${error?.message ?? "unknown schema error"}`,
    );
  }
  verifyTrimmedStrings(value);
  return value as LearningState;
}

function readyById(catalog: ModuleCatalog): Map<string, ReadyModule> {
  return new Map(
    catalog.modules
      .filter(
        (module): module is ReadyModule => module.availability === "ready",
      )
      .map((module) => [module.id, module]),
  );
}

export function isReviewDue(
  review: ReviewSchedule,
  currentSessionId: string,
  now: Date,
): boolean {
  if (review.atNextSession)
    return review.scheduledBySessionId !== currentSessionId;
  return new Date(review.notBefore).getTime() <= now.getTime();
}

function scheduleShape(review: ReviewSchedule | ReviewEvent): DataObject {
  return {
    reviewId: review.reviewId,
    priorReviewId: review.priorReviewId,
    promptId: review.promptId,
    moduleId: review.moduleId,
    conceptIds: review.conceptIds,
    ...(review.atNextSession
      ? { atNextSession: true }
      : { notBefore: review.notBefore }),
    heuristic: review.heuristic,
    reason: review.reason,
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function meaningfulTakeaway(value: string): boolean {
  const words = value.split(/\s+/);
  return (
    /^I\s+(?:can|understand|learned|will|explain|distinguish|use|know)\b/i.test(
      value,
    ) &&
    words.length >= 8 &&
    !/^I\s+(?:did it|finished|passed|am done)[.!]?$/i.test(value)
  );
}

function requireSubstantiveEvidence(
  value: string,
  integrityPath: string,
): void {
  const words = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (
    words.length < 3 ||
    /^(?:todo|tbd|n\/a|none|unknown|done|passed|works|ok)[.!]?$/i.test(value)
  )
    fail(
      "EVIDENCE_TOO_VAGUE",
      integrityPath,
      "record observable evidence with at least three meaningful words",
    );
}

function verifyFeedbackQuality(
  feedback: Feedback,
  integrityPath: string,
): void {
  for (const [key, value] of Object.entries(feedback))
    requireSubstantiveEvidence(value, `${integrityPath}/${key}`);
}

export function canonicalGateDigest(
  moduleId: string,
  requiredChecks: RequiredCheck[],
): string {
  return fingerprint({
    moduleId,
    requiredChecks: [...requiredChecks].sort((left, right) =>
      left.checkId.localeCompare(right.checkId),
    ),
  });
}

export function verifyStateSemantics(
  state: LearningState,
  catalog: ModuleCatalog,
): void {
  const modules = readyById(catalog);
  const sessionIds = new Set<string>();
  const sessions = new Map<string, Session>();
  const allRecordIds = new Map<string, string>();
  const register = (id: string, label: string, integrityPath: string): void => {
    const prior = allRecordIds.get(id);
    if (prior)
      fail(
        "RECORD_ID_REUSED",
        integrityPath,
        `${id} already belongs to ${prior}`,
      );
    allRecordIds.set(id, label);
  };
  state.sessions.forEach((session, index) => {
    const sessionPath = `/sessions/${index}`;
    if (sessionIds.has(session.sessionId))
      fail("SESSION_DUPLICATE", `${sessionPath}/sessionId`, session.sessionId);
    sessionIds.add(session.sessionId);
    sessions.set(session.sessionId, session);
    register(session.sessionId, "session", `${sessionPath}/sessionId`);
    const start = new Date(session.startedAt).getTime();
    const end = session.endedAt
      ? new Date(session.endedAt).getTime()
      : undefined;
    if (end !== undefined && end < start)
      fail(
        "SESSION_TIME_ORDER",
        `${sessionPath}/endedAt`,
        "session ends before start",
      );
    if (index > 0) {
      const prior = state.sessions[index - 1]!;
      if (prior.status !== "closed")
        fail(
          "SESSION_ROLLOVER",
          `${sessionPath}/status`,
          "prior session is still open",
        );
      if (new Date(prior.startedAt).getTime() >= start)
        fail(
          "SESSION_ORDER",
          `${sessionPath}/startedAt`,
          "sessions are not ordered",
        );
      if (!prior.endedAt || new Date(prior.endedAt).getTime() > start)
        fail(
          "SESSION_OVERLAP",
          `${sessionPath}/startedAt`,
          "session starts before the prior session ended",
        );
    }
  });
  const openSessions = state.sessions.filter(
    (session) => session.status === "open",
  );
  if (openSessions.length !== 1)
    fail("SESSION_OPEN_COUNT", "/sessions", "exactly one session must be open");
  const open = openSessions[0]!;
  if (state.lastSessionId !== open.sessionId)
    fail("LAST_SESSION_NOT_OPEN", "/lastSessionId", open.sessionId);
  if (state.current.sessionId !== open.sessionId)
    fail("CURRENT_SESSION_NOT_OPEN", "/current/sessionId", open.sessionId);
  if (
    new Date(state.lastSessionAt).getTime() < new Date(open.startedAt).getTime()
  )
    fail("LAST_SESSION_TIME_STALE", "/lastSessionAt", open.startedAt);

  const requireSession = (id: string, integrityPath: string): void => {
    if (!sessionIds.has(id))
      fail("SESSION_REFERENCE_UNKNOWN", integrityPath, id);
  };
  const requireChronology = (
    sessionId: string,
    timestamp: string,
    integrityPath: string,
  ): void => {
    const session = sessions.get(sessionId);
    if (!session) fail("SESSION_REFERENCE_UNKNOWN", integrityPath, sessionId);
    const time = new Date(timestamp).getTime();
    const start = new Date(session.startedAt).getTime();
    const end = new Date(session.endedAt ?? state.lastSessionAt).getTime();
    if (time < start || time > end)
      fail(
        "EVIDENCE_OUTSIDE_SESSION",
        integrityPath,
        `${timestamp} is outside ${sessionId}`,
      );
  };
  const currentModule = modules.get(state.current.moduleId);
  if (!currentModule)
    fail(
      "CURRENT_MODULE_UNAVAILABLE",
      "/current/moduleId",
      state.current.moduleId,
    );
  if (!currentModule.activityIds.includes(state.current.activityId))
    fail(
      "CURRENT_ACTIVITY_UNKNOWN",
      "/current/activityId",
      state.current.activityId,
    );
  requireSubstantiveEvidence(
    state.current.pendingAction.action,
    "/current/pendingAction/action",
  );
  state.calibration.evidence.forEach((evidence, index) =>
    requireSubstantiveEvidence(evidence, `/calibration/evidence/${index}`),
  );
  requireSubstantiveEvidence(
    state.calibration.retentionGoal,
    "/calibration/retentionGoal",
  );

  if (state.current.loopPhase === "recover") {
    const recovery = state.current.recovery;
    if (!recovery)
      fail(
        "RECOVERY_REQUIRED",
        "/current/recovery",
        "recover phase needs a record",
      );
    if (recovery.eventId)
      fail(
        "RECOVERY_CURRENT_EVENT_ID",
        "/current/recovery/eventId",
        "event IDs belong only in recoveryHistory",
      );
    if (
      recovery.sessionId !== state.current.sessionId ||
      recovery.moduleId !== state.current.moduleId ||
      recovery.activityId !== state.current.activityId
    )
      fail(
        "RECOVERY_SCOPE_MISMATCH",
        "/current/recovery",
        "recovery scope differs",
      );
    if (recovery.target.length < 6 || !/[./]/.test(recovery.target))
      fail(
        "RECOVERY_TARGET_VAGUE",
        "/current/recovery/target",
        recovery.target,
      );
    if (recovery.preExerciseReference.length < 12)
      fail(
        "RECOVERY_REFERENCE_VAGUE",
        "/current/recovery/preExerciseReference",
        recovery.preExerciseReference,
      );
    if (recovery.deliberateMutation.length < 12)
      fail(
        "RECOVERY_MUTATION_VAGUE",
        "/current/recovery/deliberateMutation",
        recovery.deliberateMutation,
      );
    if (recovery.restorationAction.length < 12)
      fail(
        "RECOVERY_RESTORATION_VAGUE",
        "/current/recovery/restorationAction",
        recovery.restorationAction,
      );
    const required = currentModule.requiredChecks.find(
      (check) => check.checkId === recovery.expectedFailingCheckId,
    );
    if (!required || required.command !== recovery.expectedFailingCommand)
      fail(
        "RECOVERY_CHECK_MISMATCH",
        "/current/recovery/expectedFailingCommand",
        recovery.expectedFailingCheckId,
      );
  }

  const recoveryState = new Map<string, RecoveryEvent>();
  state.recoveryHistory.forEach((event, index) => {
    const eventPath = `/recoveryHistory/${index}`;
    register(event.eventId, "recovery event", `${eventPath}/eventId`);
    requireSession(event.sessionId, `${eventPath}/sessionId`);
    requireChronology(
      event.sessionId,
      event.recordedAt,
      `${eventPath}/recordedAt`,
    );
    const prior = recoveryState.get(event.recoveryId);
    if (event.status === "pending") {
      if (prior)
        fail(
          "RECOVERY_PENDING_DUPLICATE",
          `${eventPath}/recoveryId`,
          event.recoveryId,
        );
      recoveryState.set(event.recoveryId, event);
    } else if (event.status === "bytes_restored_recheck_pending") {
      if (!prior || prior.status !== "pending")
        fail(
          "RECOVERY_BYTES_RESTORED_ORPHAN",
          `${eventPath}/recoveryId`,
          event.recoveryId,
        );
      if (
        new Date(event.recordedAt).getTime() <
        new Date(prior.recordedAt).getTime()
      )
        fail(
          "RECOVERY_TIME_ORDER",
          `${eventPath}/recordedAt`,
          event.recoveryId,
        );
      for (const key of [
        "moduleId",
        "activityId",
        "target",
        "preExerciseReference",
        "preExerciseFingerprint",
        "deliberateMutation",
        "expectedFailingCheckId",
        "expectedFailingCommand",
        "restorationAction",
      ] as const)
        if (event[key] !== prior[key])
          fail(
            "RECOVERY_HISTORY_MISMATCH",
            `${eventPath}/${key}`,
            event.recoveryId,
          );
      recoveryState.set(event.recoveryId, event);
    } else {
      if (!prior || prior.status !== "bytes_restored_recheck_pending")
        fail(
          "RECOVERY_RESTORED_ORPHAN",
          `${eventPath}/recoveryId`,
          event.recoveryId,
        );
      if (!event.recoveredAt)
        fail(
          "RECOVERY_RESTORED_TIMESTAMP",
          `${eventPath}/recoveredAt`,
          event.recoveryId,
        );
      requireChronology(
        event.sessionId,
        event.recoveredAt,
        `${eventPath}/recoveredAt`,
      );
      if (
        new Date(event.recoveredAt).getTime() <
        new Date(prior.recordedAt).getTime()
      )
        fail(
          "RECOVERY_TIME_ORDER",
          `${eventPath}/recoveredAt`,
          event.recoveryId,
        );
      for (const key of [
        "moduleId",
        "activityId",
        "target",
        "preExerciseReference",
        "preExerciseFingerprint",
        "deliberateMutation",
        "expectedFailingCheckId",
        "expectedFailingCommand",
        "restorationAction",
      ] as const)
        if (event[key] !== prior[key])
          fail(
            "RECOVERY_HISTORY_MISMATCH",
            `${eventPath}/${key}`,
            event.recoveryId,
          );
      if (
        event.expectedFailureCheckRunId !== prior.expectedFailureCheckRunId ||
        event.restoredFingerprint !== prior.restoredFingerprint
      )
        fail("RECOVERY_HISTORY_MISMATCH", eventPath, event.recoveryId);
      recoveryState.set(event.recoveryId, event);
    }
  });
  const activeRecoveries = [...recoveryState.values()].filter(
    (event) => event.status !== "restored",
  );
  if (activeRecoveries.length > 1)
    fail(
      "RECOVERY_ACTIVE_COUNT",
      "/recoveryHistory",
      "only one recovery can be active",
    );
  if (state.current.recovery) {
    const history = recoveryState.get(state.current.recovery.recoveryId);
    if (!history || history.status !== state.current.recovery.status)
      fail(
        "RECOVERY_HISTORY_REQUIRED",
        "/current/recovery",
        state.current.recovery.recoveryId,
      );
  } else if (activeRecoveries.length > 0) {
    fail(
      "RECOVERY_CURRENT_REQUIRED",
      "/current/recovery",
      activeRecoveries[0]!.recoveryId,
    );
  }

  if (
    (state.conceptLevels.length === 0 &&
      state.calibration.status !== "unassessed") ||
    (state.conceptLevels.length > 0 &&
      state.calibration.status !== "concept-specific")
  )
    fail(
      "CALIBRATION_EVIDENCE_MISMATCH",
      "/calibration/status",
      "calibration status must reflect concept evidence",
    );

  const activities = new Map<string, CompletedActivity>();
  state.completedActivities.forEach((activity, index) => {
    const activityPath = `/completedActivities/${index}`;
    register(
      activity.activityRunId,
      "activity",
      `${activityPath}/activityRunId`,
    );
    requireSession(activity.sessionId, `${activityPath}/sessionId`);
    requireChronology(
      activity.sessionId,
      activity.completedAt,
      `${activityPath}/completedAt`,
    );
    activity.evidence.forEach((evidence, evidenceIndex) =>
      requireSubstantiveEvidence(
        evidence,
        `${activityPath}/evidence/${evidenceIndex}`,
      ),
    );
    const module = modules.get(activity.moduleId);
    if (!module || !module.activityIds.includes(activity.activityId))
      fail("ACTIVITY_CATALOG_MISMATCH", activityPath, activity.activityId);
    activities.set(activity.activityRunId, activity);
  });

  const checks = new Map<string, Check>();
  state.checks.forEach((check, index) => {
    const checkPath = `/checks/${index}`;
    register(check.checkRunId, "check", `${checkPath}/checkRunId`);
    requireSession(check.sessionId, `${checkPath}/sessionId`);
    requireChronology(
      check.sessionId,
      check.recordedAt,
      `${checkPath}/recordedAt`,
    );
    const module = modules.get(check.moduleId);
    if (!module)
      fail("CHECK_CATALOG_MISMATCH", `${checkPath}/moduleId`, check.moduleId);
    const required = module.requiredChecks.find(
      (candidate) => candidate.checkId === check.checkId,
    );
    if (!required)
      fail("CHECK_CATALOG_MISMATCH", `${checkPath}/checkId`, check.checkId);
    if (check.activityId !== required.activityId)
      fail(
        "CHECK_ACTIVITY_MISMATCH",
        `${checkPath}/activityId`,
        required.activityId,
      );
    if (check.command !== required.command)
      fail("CHECK_COMMAND_MISMATCH", `${checkPath}/command`, required.command);
    if (
      (check.outcome === "passed" && check.exitCode !== 0) ||
      (check.outcome === "failed" && check.exitCode <= 0) ||
      (check.outcome === "blocked" && check.exitCode !== -1)
    )
      fail(
        "CHECK_EXIT_OUTCOME_MISMATCH",
        `${checkPath}/exitCode`,
        check.checkRunId,
      );
    if (
      check.gateDigest !==
      canonicalGateDigest(check.moduleId, module.requiredChecks)
    )
      fail("CHECK_DIGEST_INVALID", `${checkPath}/gateDigest`, check.checkRunId);
    requireSubstantiveEvidence(check.evidence, `${checkPath}/evidence`);
    checks.set(check.checkRunId, check);
  });

  state.recoveryHistory.forEach((event, index) => {
    if (event.status === "pending") return;
    const eventPath = `/recoveryHistory/${index}`;
    const pending = state.recoveryHistory
      .slice(0, index)
      .find(
        (candidate) =>
          candidate.recoveryId === event.recoveryId &&
          candidate.status === "pending",
      );
    const failure = event.expectedFailureCheckRunId
      ? checks.get(event.expectedFailureCheckRunId)
      : undefined;
    if (
      !pending ||
      !failure ||
      failure.checkId !== event.expectedFailingCheckId ||
      failure.moduleId !== event.moduleId ||
      failure.outcome !== "failed"
    )
      fail(
        "RECOVERY_FAILURE_CHECK_REQUIRED",
        `${eventPath}/expectedFailureCheckRunId`,
        event.recoveryId,
      );
    if (
      new Date(failure.recordedAt).getTime() <
        new Date(pending.recordedAt).getTime() ||
      new Date(event.recordedAt).getTime() <
        new Date(failure.recordedAt).getTime()
    )
      fail("RECOVERY_CHECK_ORDER", eventPath, event.recoveryId);
    if (event.restoredFingerprint !== event.preExerciseFingerprint)
      fail(
        "RECOVERY_FINGERPRINT_MISMATCH",
        `${eventPath}/restoredFingerprint`,
        event.recoveryId,
      );
    if (event.status === "bytes_restored_recheck_pending") return;

    const intermediate = state.recoveryHistory
      .slice(0, index)
      .find(
        (candidate) =>
          candidate.recoveryId === event.recoveryId &&
          candidate.status === "bytes_restored_recheck_pending",
      );
    const restoration = event.restorationCheckRunId
      ? checks.get(event.restorationCheckRunId)
      : undefined;
    if (
      !intermediate ||
      !restoration ||
      restoration.checkId !== event.expectedFailingCheckId ||
      restoration.moduleId !== event.moduleId ||
      restoration.outcome !== "passed"
    )
      fail(
        "RECOVERY_PASS_CHECK_REQUIRED",
        `${eventPath}/restorationCheckRunId`,
        event.recoveryId,
      );
    if (
      new Date(restoration.recordedAt).getTime() <
        new Date(intermediate.recordedAt).getTime() ||
      new Date(event.recoveredAt!).getTime() <
        new Date(restoration.recordedAt).getTime()
    )
      fail("RECOVERY_CHECK_ORDER", eventPath, event.recoveryId);
  });

  state.completedActivities.forEach((activity, index) => {
    for (const checkRunId of activity.checkRunIds) {
      const check = checks.get(checkRunId);
      if (
        !check ||
        check.moduleId !== activity.moduleId ||
        check.sessionId !== activity.sessionId ||
        new Date(check.recordedAt).getTime() >
          new Date(activity.completedAt).getTime()
      )
        fail(
          "ACTIVITY_CHECK_BINDING",
          `/completedActivities/${index}/checkRunIds`,
          checkRunId,
        );
    }
  });

  const knownConcepts = new Set(
    catalog.modules.flatMap((module) => module.conceptIds),
  );
  const currentConcepts = new Set<string>();
  state.conceptLevels.forEach((concept, index) => {
    const conceptPath = `/conceptLevels/${index}`;
    requireSession(concept.sessionId, `${conceptPath}/sessionId`);
    requireChronology(
      concept.sessionId,
      concept.updatedAt,
      `${conceptPath}/updatedAt`,
    );
    requireSubstantiveEvidence(concept.evidence, `${conceptPath}/evidence`);
    if (!knownConcepts.has(concept.conceptId))
      fail("CONCEPT_UNKNOWN", `${conceptPath}/conceptId`, concept.conceptId);
    if (currentConcepts.has(concept.conceptId))
      fail("CONCEPT_LEVEL_DUPLICATE", conceptPath, concept.conceptId);
    currentConcepts.add(concept.conceptId);
  });

  const attempts = new Map<string, RetrievalAttempt>();
  state.retrievalAttempts.forEach((attempt, index) => {
    const attemptPath = `/retrievalAttempts/${index}`;
    register(attempt.attemptId, "retrieval", `${attemptPath}/attemptId`);
    requireSession(attempt.sessionId, `${attemptPath}/sessionId`);
    requireChronology(
      attempt.sessionId,
      attempt.attemptedAt,
      `${attemptPath}/attemptedAt`,
    );
    requireSubstantiveEvidence(attempt.answer, `${attemptPath}/answer`);
    requireSubstantiveEvidence(
      attempt.calibrationNote,
      `${attemptPath}/calibrationNote`,
    );
    const module = modules.get(attempt.moduleId);
    if (!module || !module.retrievalPromptIds.includes(attempt.promptId))
      fail(
        "RETRIEVAL_PROMPT_UNKNOWN",
        `${attemptPath}/promptId`,
        attempt.promptId,
      );
    const purposePrompts =
      attempt.purpose === "diagnostic"
        ? module.diagnosticPromptIds
        : attempt.purpose === "mastery"
          ? module.masteryPromptIds
          : module.delayedRetrievalPromptIds;
    if (!purposePrompts.includes(attempt.promptId))
      fail(
        "RETRIEVAL_PURPOSE_MISMATCH",
        `${attemptPath}/purpose`,
        `${attempt.purpose}/${attempt.promptId}`,
      );
    if (attempt.activityId !== attempt.promptId)
      fail(
        "RETRIEVAL_ACTIVITY_MISMATCH",
        `${attemptPath}/activityId`,
        attempt.promptId,
      );
    if (attempt.conceptIds.some((id) => !module.conceptIds.includes(id)))
      fail(
        "RETRIEVAL_CONCEPT_MISMATCH",
        `${attemptPath}/conceptIds`,
        attempt.moduleId,
      );
    const criterionIds = attempt.selfEvaluation.criteria.map(
      (criterion) => criterion.criterionId,
    );
    if (!sameIds(criterionIds, module.rubricCriterionIds))
      fail(
        "RETRIEVAL_RUBRIC_INCOMPLETE",
        `${attemptPath}/selfEvaluation`,
        attempt.attemptId,
      );
    attempt.selfEvaluation.criteria.forEach((criterion, criterionIndex) =>
      requireSubstantiveEvidence(
        criterion.evidence,
        `${attemptPath}/selfEvaluation/criteria/${criterionIndex}/evidence`,
      ),
    );
    verifyFeedbackQuality(attempt.feedback, `${attemptPath}/feedback`);
    if (attempt.outcome === "accurate") {
      if (attempt.misconception || attempt.correction)
        fail(
          "ACCURATE_RETRIEVAL_HAS_CORRECTION",
          attemptPath,
          attempt.attemptId,
        );
    } else {
      if (!attempt.misconception || !attempt.correction)
        fail(
          "RETRIEVAL_CORRECTION_REQUIRED",
          `${attemptPath}/correction`,
          attempt.attemptId,
        );
    }
    for (const checkRunId of attempt.checkRunIds) {
      const check = checks.get(checkRunId);
      if (
        !check ||
        check.moduleId !== attempt.moduleId ||
        check.sessionId !== attempt.sessionId ||
        new Date(check.recordedAt).getTime() >
          new Date(attempt.attemptedAt).getTime()
      )
        fail(
          "RETRIEVAL_CHECK_BINDING",
          `${attemptPath}/checkRunIds`,
          checkRunId,
        );
    }
    if (attempt.purpose === "diagnostic" && attempt.checkRunIds.length > 0)
      fail(
        "DIAGNOSTIC_CHECK_BINDING",
        `${attemptPath}/checkRunIds`,
        "diagnostic retrieval precedes active work and checks",
      );
    if (attempt.purpose === "mastery") {
      const diagnostic = state.retrievalAttempts.find(
        (candidate) =>
          candidate.purpose === "diagnostic" &&
          candidate.moduleId === attempt.moduleId &&
          candidate.sessionId === attempt.sessionId &&
          new Date(candidate.attemptedAt).getTime() <
            new Date(attempt.attemptedAt).getTime(),
      );
      if (!diagnostic)
        fail("MASTERY_DIAGNOSTIC_MISSING", attemptPath, attempt.attemptId);
      const priorActivities = state.completedActivities.filter(
        (activity) =>
          activity.moduleId === attempt.moduleId &&
          activity.sessionId === attempt.sessionId &&
          new Date(activity.completedAt).getTime() <=
            new Date(attempt.attemptedAt).getTime(),
      );
      if (
        !sameIds(
          priorActivities.map((activity) => activity.activityId),
          module.completionActivityIds,
        )
      )
        fail("MASTERY_ACTIVE_WORK_INCOMPLETE", attemptPath, attempt.attemptId);
      const masteryChecks = attempt.checkRunIds.map((id) => checks.get(id));
      if (
        masteryChecks.some((check) => !check || check.outcome !== "passed") ||
        !sameIds(
          masteryChecks.map((check) => check?.checkId ?? ""),
          module.requiredChecks.map((check) => check.checkId),
        )
      )
        fail(
          "MASTERY_CHECK_SET",
          `${attemptPath}/checkRunIds`,
          attempt.attemptId,
        );
      if (
        masteryChecks.some(
          (check) =>
            check &&
            (check.repositoryRevision !==
              masteryChecks[0]?.repositoryRevision ||
              check.gateDigest !== masteryChecks[0]?.gateDigest),
        )
      )
        fail(
          "MASTERY_CHECK_STALE",
          `${attemptPath}/checkRunIds`,
          attempt.attemptId,
        );
    }
    attempts.set(attempt.attemptId, attempt);
  });

  state.completedActivities.forEach((activity, index) => {
    const module = modules.get(activity.moduleId);
    if (!module?.completionActivityIds.includes(activity.activityId)) return;
    const diagnostic = state.retrievalAttempts.find(
      (attempt) =>
        attempt.purpose === "diagnostic" &&
        attempt.moduleId === activity.moduleId &&
        attempt.sessionId === activity.sessionId &&
        new Date(attempt.attemptedAt).getTime() <
          new Date(activity.completedAt).getTime(),
    );
    if (!diagnostic)
      fail(
        "ACTIVE_WORK_DIAGNOSTIC_REQUIRED",
        `/completedActivities/${index}/completedAt`,
        `${activity.moduleId}/${activity.activityId}`,
      );
  });
  state.checks.forEach((check, index) => {
    const diagnosticSessionIds = new Set([check.sessionId]);
    const activeRecovery = state.current.recovery;
    if (
      activeRecovery &&
      activeRecovery.status !== "restored" &&
      activeRecovery.moduleId === check.moduleId &&
      state.current.sessionId === check.sessionId
    ) {
      const pending = state.recoveryHistory.find(
        (event) =>
          event.recoveryId === activeRecovery.recoveryId &&
          event.status === "pending",
      );
      if (pending) diagnosticSessionIds.add(pending.sessionId);
    }
    for (const linked of state.recoveryHistory.filter(
      (event) =>
        event.moduleId === check.moduleId &&
        (event.expectedFailureCheckRunId === check.checkRunId ||
          event.restorationCheckRunId === check.checkRunId),
    )) {
      const pending = state.recoveryHistory.find(
        (event) =>
          event.recoveryId === linked.recoveryId && event.status === "pending",
      );
      if (pending) diagnosticSessionIds.add(pending.sessionId);
    }
    const diagnostic = state.retrievalAttempts.find(
      (attempt) =>
        attempt.purpose === "diagnostic" &&
        attempt.moduleId === check.moduleId &&
        diagnosticSessionIds.has(attempt.sessionId) &&
        new Date(attempt.attemptedAt).getTime() <
          new Date(check.recordedAt).getTime(),
    );
    if (!diagnostic)
      fail(
        "CHECK_DIAGNOSTIC_REQUIRED",
        `/checks/${index}/recordedAt`,
        `${check.moduleId}/${check.checkId}`,
      );
  });

  const revisions = new Map<string, EvaluatedRevision>();
  const revisionsByAttempt = new Map<string, EvaluatedRevision[]>();
  state.revisions.forEach((revision, index) => {
    const revisionPath = `/revisions/${index}`;
    register(revision.revisionId, "revision", `${revisionPath}/revisionId`);
    requireSession(revision.sessionId, `${revisionPath}/sessionId`);
    requireChronology(
      revision.sessionId,
      revision.evaluatedAt,
      `${revisionPath}/evaluatedAt`,
    );
    const attempt = attempts.get(revision.attemptId);
    if (!attempt)
      fail(
        "REVISION_ATTEMPT_UNKNOWN",
        `${revisionPath}/attemptId`,
        revision.attemptId,
      );
    if (
      attempt.sessionId !== revision.sessionId ||
      attempt.moduleId !== revision.moduleId ||
      attempt.activityId !== revision.activityId ||
      attempt.promptId !== revision.promptId
    )
      fail("REVISION_SCOPE_MISMATCH", revisionPath, revision.revisionId);
    if (
      new Date(revision.evaluatedAt).getTime() <
      new Date(attempt.attemptedAt).getTime()
    )
      fail(
        "REVISION_BEFORE_ATTEMPT",
        `${revisionPath}/evaluatedAt`,
        revision.revisionId,
      );
    const module = modules.get(revision.moduleId)!;
    if (
      !sameIds(
        revision.selfEvaluation.criteria.map(
          (criterion) => criterion.criterionId,
        ),
        module.rubricCriterionIds,
      )
    )
      fail(
        "REVISION_RUBRIC_INCOMPLETE",
        `${revisionPath}/selfEvaluation`,
        revision.revisionId,
      );
    revision.selfEvaluation.criteria.forEach((criterion, criterionIndex) =>
      requireSubstantiveEvidence(
        criterion.evidence,
        `${revisionPath}/selfEvaluation/criteria/${criterionIndex}/evidence`,
      ),
    );
    verifyFeedbackQuality(revision.feedback, `${revisionPath}/feedback`);
    requireSubstantiveEvidence(revision.answer, `${revisionPath}/answer`);
    requireSubstantiveEvidence(revision.evidence, `${revisionPath}/evidence`);
    for (const checkRunId of revision.checkRunIds) {
      const check = checks.get(checkRunId);
      if (
        !check ||
        check.moduleId !== revision.moduleId ||
        check.sessionId !== revision.sessionId ||
        new Date(check.recordedAt).getTime() >
          new Date(revision.evaluatedAt).getTime()
      )
        fail(
          "REVISION_CHECK_BINDING",
          `${revisionPath}/checkRunIds`,
          checkRunId,
        );
    }
    if (!sameIds(revision.checkRunIds, attempt.checkRunIds))
      fail(
        "REVISION_CHECK_SET",
        `${revisionPath}/checkRunIds`,
        revision.revisionId,
      );
    revisions.set(revision.revisionId, revision);
    revisionsByAttempt.set(revision.attemptId, [
      ...(revisionsByAttempt.get(revision.attemptId) ?? []),
      revision,
    ]);
  });
  state.retrievalAttempts.forEach((attempt, index) => {
    const linked = revisionsByAttempt.get(attempt.attemptId) ?? [];
    if (attempt.outcome === "accurate" && linked.length > 0)
      fail(
        "ACCURATE_RETRIEVAL_HAS_REVISION",
        `/retrievalAttempts/${index}`,
        attempt.attemptId,
      );
    if (attempt.purpose === "diagnostic") {
      if (attempt.status !== "evaluated" || linked.length > 0)
        fail(
          "DIAGNOSTIC_TERMINAL_STATE",
          `/retrievalAttempts/${index}/status`,
          attempt.attemptId,
        );
    } else if (attempt.status === "awaiting_revision") {
      if (attempt.outcome === "accurate")
        fail(
          "ACCURATE_RETRIEVAL_AWAITING_REVISION",
          `/retrievalAttempts/${index}/status`,
          attempt.attemptId,
        );
      if (linked.length > 0)
        fail(
          "AWAITING_REVISION_ALREADY_EVALUATED",
          `/retrievalAttempts/${index}/status`,
          attempt.attemptId,
        );
    } else if (attempt.outcome !== "accurate") {
      if (linked.length !== 1)
        fail(
          "EVALUATED_RETRIEVAL_REVISION_COUNT",
          `/retrievalAttempts/${index}/status`,
          attempt.attemptId,
        );
      if (linked[0]!.outcome !== "accurate")
        fail(
          "EVALUATED_REVISION_NOT_ACCURATE",
          `/revisions/${state.revisions.indexOf(linked[0]!)}/outcome`,
          linked[0]!.revisionId,
        );
    }
  });
  const awaiting = state.retrievalAttempts.filter(
    (attempt) => attempt.status === "awaiting_revision",
  );
  if (awaiting.length > 1)
    fail(
      "AWAITING_REVISION_COUNT",
      "/retrievalAttempts",
      "only one correction can be current",
    );
  if (awaiting.length === 1) {
    const attempt = awaiting[0]!;
    if (state.current.sessionId !== attempt.sessionId)
      fail(
        "AWAITING_REVISION_SESSION_MISMATCH",
        "/current/sessionId",
        attempt.attemptId,
      );
    if (
      state.current.moduleId !== attempt.moduleId ||
      state.current.activityId !== attempt.promptId ||
      !["correct", "retrieve"].includes(state.current.loopPhase) ||
      state.current.pendingAction.owner !== "learner" ||
      !/(?:correct|retriev|revis)/i.test(state.current.pendingAction.action)
    )
      fail("AWAITING_REVISION_NOT_CURRENT", "/current", attempt.attemptId);
  }

  const historyByReview = new Map<string, ReviewEvent>();
  const activeReviews = new Map<string, ReviewEvent>();
  const createdReviewIds = new Set<string>();
  const verifyReviewRetrieval = (
    event: ReviewEvent,
    scheduled: ReviewEvent,
    eventPath: string,
  ): void => {
    const reference = event.retrievalEvidenceRef;
    if (!reference)
      fail(
        "REVIEW_RETRIEVAL_REQUIRED",
        `${eventPath}/retrievalEvidenceRef`,
        event.reviewId,
      );
    const attempt = attempts.get(reference.attemptId);
    if (
      !attempt ||
      attempt.purpose !== "delayed-review" ||
      attempt.sessionId !== event.sessionId ||
      attempt.moduleId !== scheduled.moduleId ||
      attempt.promptId !== scheduled.promptId
    )
      fail(
        "REVIEW_RETRIEVAL_SCOPE",
        `${eventPath}/retrievalEvidenceRef`,
        reference.attemptId,
      );
    const attemptedAt = new Date(attempt.attemptedAt).getTime();
    if (attemptedAt < new Date(scheduled.recordedAt).getTime())
      fail(
        "REVIEW_RETRIEVAL_BEFORE_SCHEDULE",
        `${eventPath}/retrievalEvidenceRef`,
        reference.attemptId,
      );
    if (
      scheduled.atNextSession
        ? attempt.sessionId === scheduled.sessionId
        : attemptedAt < new Date(scheduled.notBefore).getTime()
    )
      fail(
        "REVIEW_RETRIEVAL_BEFORE_DUE",
        `${eventPath}/retrievalEvidenceRef`,
        reference.attemptId,
      );
    const evaluatedAt =
      reference.revisionId === null
        ? attempt.outcome === "accurate" && attempt.status === "evaluated"
          ? attempt.attemptedAt
          : undefined
        : (() => {
            const revision = revisions.get(reference.revisionId);
            return revision?.attemptId === attempt.attemptId &&
              revision.outcome === "accurate"
              ? revision.evaluatedAt
              : undefined;
          })();
    if (!evaluatedAt)
      fail(
        "REVIEW_RETRIEVAL_NOT_ACCURATE",
        `${eventPath}/retrievalEvidenceRef`,
        reference.attemptId,
      );
    if (new Date(evaluatedAt).getTime() > new Date(event.recordedAt).getTime())
      fail(
        "REVIEW_EVENT_BEFORE_EVALUATION",
        `${eventPath}/recordedAt`,
        event.eventId,
      );
  };
  let priorReviewTime = Number.NEGATIVE_INFINITY;
  state.reviewHistory.forEach((event, index) => {
    const eventPath = `/reviewHistory/${index}`;
    register(event.eventId, "review event", `${eventPath}/eventId`);
    requireSession(event.sessionId, `${eventPath}/sessionId`);
    requireChronology(
      event.sessionId,
      event.recordedAt,
      `${eventPath}/recordedAt`,
    );
    const eventTime = new Date(event.recordedAt).getTime();
    if (eventTime < priorReviewTime)
      fail("REVIEW_EVENT_ORDER", `${eventPath}/recordedAt`, event.eventId);
    priorReviewTime = eventTime;
    const module = modules.get(event.moduleId);
    if (!module || !module.delayedRetrievalPromptIds.includes(event.promptId))
      fail("REVIEW_PROMPT_UNKNOWN", `${eventPath}/promptId`, event.promptId);
    if (event.conceptIds.some((id) => !module.conceptIds.includes(id)))
      fail(
        "REVIEW_CONCEPT_MISMATCH",
        `${eventPath}/conceptIds`,
        event.reviewId,
      );
    if (event.eventType === "scheduled") {
      if (event.retrievalEvidenceRef !== null)
        fail(
          "REVIEW_SCHEDULE_HAS_RETRIEVAL",
          `${eventPath}/retrievalEvidenceRef`,
          event.reviewId,
        );
      if (
        !event.atNextSession &&
        new Date(event.notBefore).getTime() <= eventTime
      )
        fail(
          "REVIEW_NOT_BEFORE_ORDER",
          `${eventPath}/notBefore`,
          event.reviewId,
        );
      if (event.priorReviewId)
        fail(
          "REVIEW_SCHEDULE_PRIOR",
          `${eventPath}/priorReviewId`,
          event.reviewId,
        );
      if (createdReviewIds.has(event.reviewId))
        fail("REVIEW_ID_REUSED", `${eventPath}/reviewId`, event.reviewId);
      createdReviewIds.add(event.reviewId);
      activeReviews.set(event.reviewId, event);
      historyByReview.set(event.reviewId, event);
    } else if (event.eventType === "rescheduled") {
      const prior = event.priorReviewId
        ? activeReviews.get(event.priorReviewId)
        : undefined;
      if (!event.priorReviewId || !prior)
        fail(
          "REVIEW_RESCHEDULE_PRIOR_INACTIVE",
          `${eventPath}/priorReviewId`,
          event.priorReviewId ?? "missing",
        );
      if (
        event.reviewId === event.priorReviewId ||
        createdReviewIds.has(event.reviewId)
      )
        fail("REVIEW_ID_REUSED", `${eventPath}/reviewId`, event.reviewId);
      verifyReviewRetrieval(event, prior, eventPath);
      if (
        !event.atNextSession &&
        new Date(event.notBefore).getTime() <= eventTime
      )
        fail(
          "REVIEW_NOT_BEFORE_ORDER",
          `${eventPath}/notBefore`,
          event.reviewId,
        );
      activeReviews.delete(event.priorReviewId);
      createdReviewIds.add(event.reviewId);
      activeReviews.set(event.reviewId, event);
      historyByReview.set(event.reviewId, event);
    } else {
      const scheduled = activeReviews.get(event.reviewId);
      if (!scheduled)
        fail(
          "REVIEW_COMPLETION_ORPHAN",
          `${eventPath}/reviewId`,
          event.reviewId,
        );
      verifyReviewRetrieval(event, scheduled, eventPath);
      if (!jsonEqual(scheduleShape(scheduled), scheduleShape(event)))
        fail("REVIEW_COMPLETION_MISMATCH", eventPath, event.reviewId);
      activeReviews.delete(event.reviewId);
    }
  });

  const queuedPrompts = new Set<string>();
  state.reviewQueue.forEach((review, index) => {
    const reviewPath = `/reviewQueue/${index}`;
    requireSession(
      review.scheduledBySessionId,
      `${reviewPath}/scheduledBySessionId`,
    );
    const module = modules.get(review.moduleId);
    if (!module || !module.delayedRetrievalPromptIds.includes(review.promptId))
      fail("REVIEW_PROMPT_UNKNOWN", `${reviewPath}/promptId`, review.promptId);
    if (review.conceptIds.some((id) => !module.conceptIds.includes(id)))
      fail(
        "REVIEW_CONCEPT_MISMATCH",
        `${reviewPath}/conceptIds`,
        review.reviewId,
      );
    if (queuedPrompts.has(review.promptId))
      fail(
        "REVIEW_QUEUE_PROMPT_DUPLICATE",
        `${reviewPath}/promptId`,
        review.promptId,
      );
    queuedPrompts.add(review.promptId);
    const latest = activeReviews.get(review.reviewId);
    if (!latest) fail("REVIEW_HISTORY_MISSING", reviewPath, review.reviewId);
    if (
      latest.sessionId !== review.scheduledBySessionId ||
      !jsonEqual(scheduleShape(latest), scheduleShape(review))
    )
      fail("REVIEW_QUEUE_HISTORY_MISMATCH", reviewPath, review.reviewId);
    if (
      !review.atNextSession &&
      new Date(review.notBefore).getTime() <=
        new Date(latest.recordedAt).getTime()
    )
      fail(
        "REVIEW_NOT_BEFORE_ORDER",
        `${reviewPath}/notBefore`,
        review.reviewId,
      );
  });
  if (state.reviewQueue.length !== activeReviews.size)
    fail(
      "REVIEW_QUEUE_ACTIVE_SET",
      "/reviewQueue",
      "queue must equal the active review identities",
    );

  const dueReviews = state.reviewQueue.filter((review) =>
    isReviewDue(review, state.current.sessionId, new Date(state.lastSessionAt)),
  );
  const correctionBlockedThisSession = state.retrievalAttempts.some(
    (attempt) =>
      attempt.sessionId === state.current.sessionId &&
      attempt.purpose !== "diagnostic" &&
      attempt.outcome !== "accurate",
  );
  const recoveryBlockedThisSession = state.recoveryHistory.some(
    (event) =>
      event.sessionId === state.current.sessionId &&
      event.status !== "restored",
  );
  const unfinishedRecovery =
    state.current.recovery?.status === "pending" ||
    state.current.recovery?.status === "bytes_restored_recheck_pending";
  const deferDueReview =
    awaiting.length > 0 ||
    unfinishedRecovery ||
    correctionBlockedThisSession ||
    recoveryBlockedThisSession;
  if (dueReviews.length > 0 && !deferDueReview) {
    const due = dueReviews[0]!;
    if (
      state.current.status !== "review" ||
      state.current.moduleId !== due.moduleId ||
      state.current.activityId !== due.promptId
    )
      fail(
        "DUE_REVIEW_NOT_CURRENT",
        "/current",
        `${due.moduleId}/${due.promptId}`,
      );
  }

  const completedModuleIds = new Set<string>();
  const usedChecks = new Set<string>();
  const usedActivities = new Set<string>();
  const usedRetrievalEvidence = new Set<string>();
  state.completedModules.forEach((completion, index) => {
    const completionPath = `/completedModules/${index}`;
    register(
      completion.completionId,
      "completion",
      `${completionPath}/completionId`,
    );
    requireSession(completion.sessionId, `${completionPath}/sessionId`);
    requireChronology(
      completion.sessionId,
      completion.completedAt,
      `${completionPath}/completedAt`,
    );
    const module = modules.get(completion.moduleId);
    if (!module)
      fail(
        "COMPLETION_MODULE_UNAVAILABLE",
        `${completionPath}/moduleId`,
        completion.moduleId,
      );

    for (const checkRunId of completion.checkRunIds) {
      if (usedChecks.has(checkRunId))
        fail(
          "CHECK_EVIDENCE_REUSED",
          `${completionPath}/checkRunIds`,
          checkRunId,
        );
      usedChecks.add(checkRunId);
    }
    for (const activityRunId of completion.activityRunIds) {
      if (usedActivities.has(activityRunId))
        fail(
          "ACTIVITY_EVIDENCE_REUSED",
          `${completionPath}/activityRunIds`,
          activityRunId,
        );
      usedActivities.add(activityRunId);
    }
    for (const reference of completion.retrievalEvidenceRefs) {
      const key = `${reference.attemptId}/${reference.revisionId ?? "original"}`;
      if (usedRetrievalEvidence.has(key))
        fail(
          "RETRIEVAL_EVIDENCE_REUSED",
          `${completionPath}/retrievalEvidenceRefs`,
          key,
        );
      usedRetrievalEvidence.add(key);
    }
    if (completedModuleIds.has(completion.moduleId))
      fail(
        "COMPLETION_DUPLICATE",
        `${completionPath}/moduleId`,
        completion.moduleId,
      );
    completedModuleIds.add(completion.moduleId);
    if (completion.retrievalEvidenceRefs.length !== 1)
      fail(
        "COMPLETION_MASTERY_COUNT",
        `${completionPath}/retrievalEvidenceRefs`,
        "completion binds exactly one final mastery evaluation",
      );

    const rubricIds = completion.rubric.criteria.map(
      (criterion) => criterion.criterionId,
    );
    if (!sameIds(rubricIds, module.rubricCriterionIds))
      fail(
        "COMPLETION_RUBRIC_INCOMPLETE",
        `${completionPath}/rubric`,
        completion.moduleId,
      );
    if (completion.rubric.criteria.some((criterion) => criterion.score !== 2))
      fail(
        "COMPLETION_RUBRIC_GAP",
        `${completionPath}/rubric/criteria`,
        completion.moduleId,
      );
    completion.rubric.criteria.forEach((criterion, criterionIndex) =>
      requireSubstantiveEvidence(
        criterion.evidence,
        `${completionPath}/rubric/criteria/${criterionIndex}/evidence`,
      ),
    );
    if (!meaningfulTakeaway(completion.firstPersonTakeaway))
      fail(
        "TAKEAWAY_NOT_MEANINGFUL",
        `${completionPath}/firstPersonTakeaway`,
        completion.firstPersonTakeaway,
      );

    const activityRuns = completion.activityRunIds.map((id) =>
      activities.get(id),
    );
    if (activityRuns.some((activity) => !activity))
      fail(
        "COMPLETION_ACTIVITY_MISSING",
        `${completionPath}/activityRunIds`,
        completion.moduleId,
      );
    if (
      activityRuns.some(
        (activity) =>
          activity?.moduleId !== completion.moduleId ||
          activity.sessionId !== completion.sessionId ||
          new Date(activity.completedAt).getTime() >
            new Date(completion.completedAt).getTime(),
      ) ||
      !sameIds(
        activityRuns.map((activity) => activity?.activityId ?? ""),
        module.completionActivityIds,
      )
    )
      fail(
        "COMPLETION_ACTIVITY_SCOPE",
        `${completionPath}/activityRunIds`,
        completion.moduleId,
      );

    const checkRuns = completion.checkRunIds.map((id) => checks.get(id));
    if (checkRuns.some((check) => !check || check.outcome !== "passed"))
      fail(
        "COMPLETION_CHECK_NOT_PASSING",
        `${completionPath}/checkRunIds`,
        completion.moduleId,
      );
    if (
      !sameIds(
        checkRuns.map((check) => check?.checkId ?? ""),
        module.requiredChecks.map((check) => check.checkId),
      )
    )
      fail(
        "COMPLETION_CHECK_SET",
        `${completionPath}/checkRunIds`,
        completion.moduleId,
      );
    for (const check of checkRuns) {
      if (!check) continue;
      if (check.moduleId !== completion.moduleId)
        fail(
          "COMPLETION_CHECK_MODULE",
          `${completionPath}/checkRunIds`,
          check.checkRunId,
        );
      if (check.sessionId !== completion.sessionId)
        fail(
          "COMPLETION_CHECK_SESSION",
          `${completionPath}/checkRunIds`,
          check.checkRunId,
        );
      if (
        new Date(check.recordedAt).getTime() >
        new Date(completion.completedAt).getTime()
      )
        fail(
          "COMPLETION_CHECK_AFTER_COMPLETION",
          `${completionPath}/checkRunIds`,
          check.checkRunId,
        );
      if (
        check.repositoryRevision !== completion.repositoryRevision ||
        check.gateDigest !== completion.gateDigest
      )
        fail(
          "COMPLETION_CHECK_STALE",
          `${completionPath}/checkRunIds`,
          check.checkRunId,
        );
    }

    for (const reference of completion.retrievalEvidenceRefs) {
      const attempt = attempts.get(reference.attemptId);
      if (!attempt || attempt.moduleId !== completion.moduleId)
        fail(
          "COMPLETION_RETRIEVAL_MISSING",
          `${completionPath}/retrievalEvidenceRefs`,
          reference.attemptId,
        );
      if (attempt.sessionId !== completion.sessionId)
        fail(
          "COMPLETION_RETRIEVAL_SESSION",
          `${completionPath}/retrievalEvidenceRefs`,
          reference.attemptId,
        );
      if (attempt.purpose !== "mastery")
        fail(
          "COMPLETION_RETRIEVAL_NOT_MASTERY",
          `${completionPath}/retrievalEvidenceRefs`,
          reference.attemptId,
        );
      if (
        new Date(attempt.attemptedAt).getTime() >
        new Date(completion.completedAt).getTime()
      )
        fail(
          "COMPLETION_BEFORE_ATTEMPT",
          `${completionPath}/completedAt`,
          reference.attemptId,
        );
      if (reference.revisionId === null) {
        if (attempt.outcome !== "accurate" || attempt.status !== "evaluated")
          fail(
            "COMPLETION_ORIGINAL_NOT_ACCURATE",
            `${completionPath}/retrievalEvidenceRefs`,
            reference.attemptId,
          );
        if (
          !completion.checkRunIds.every((checkRunId) =>
            attempt.checkRunIds.includes(checkRunId),
          )
        )
          fail(
            "COMPLETION_RETRIEVAL_CHECK_BINDING",
            `${completionPath}/retrievalEvidenceRefs`,
            reference.attemptId,
          );
      } else {
        const revision = revisions.get(reference.revisionId);
        if (
          !revision ||
          revision.attemptId !== attempt.attemptId ||
          revision.outcome !== "accurate"
        )
          fail(
            "RETRIEVAL_REVISION_MISMATCH",
            `${completionPath}/retrievalEvidenceRefs`,
            reference.revisionId,
          );
        if (
          new Date(revision.evaluatedAt).getTime() >
          new Date(completion.completedAt).getTime()
        )
          fail(
            "COMPLETION_BEFORE_REVISION",
            `${completionPath}/completedAt`,
            revision.revisionId,
          );
        if (
          !completion.checkRunIds.every((checkRunId) =>
            revision.checkRunIds.includes(checkRunId),
          )
        )
          fail(
            "COMPLETION_REVISION_CHECK_BINDING",
            `${completionPath}/retrievalEvidenceRefs`,
            revision.revisionId,
          );
      }
    }

    for (const reviewId of completion.delayedReviewIds) {
      const event = historyByReview.get(reviewId);
      if (
        !event ||
        event.eventType === "completed" ||
        event.moduleId !== completion.moduleId
      )
        fail(
          "COMPLETION_REVIEW_HISTORY",
          `${completionPath}/delayedReviewIds`,
          reviewId,
        );
      if (event.sessionId !== completion.sessionId)
        fail(
          "COMPLETION_REVIEW_SESSION",
          `${completionPath}/delayedReviewIds`,
          reviewId,
        );
      if (
        new Date(event.recordedAt).getTime() >
        new Date(completion.completedAt).getTime()
      )
        fail(
          "COMPLETION_BEFORE_REVIEW_SCHEDULE",
          `${completionPath}/completedAt`,
          reviewId,
        );
    }
  });

  let previousDigest: string | null = null;
  let previousCheckpointTime = Number.NEGATIVE_INFINITY;
  let previousSnapshot: CheckpointSnapshot | undefined;
  state.checkpoints.forEach((checkpoint, index) => {
    const checkpointPath = `/checkpoints/${index}`;
    register(
      checkpoint.checkpointId,
      "checkpoint",
      `${checkpointPath}/checkpointId`,
    );
    requireSession(checkpoint.sessionId, `${checkpointPath}/sessionId`);
    requireChronology(
      checkpoint.sessionId,
      checkpoint.recordedAt,
      `${checkpointPath}/recordedAt`,
    );
    const checkpointTime = new Date(checkpoint.recordedAt).getTime();
    if (checkpointTime < previousCheckpointTime)
      fail(
        "CHECKPOINT_ORDER",
        `${checkpointPath}/recordedAt`,
        checkpoint.checkpointId,
      );
    if (checkpoint.previousDigest !== previousDigest)
      fail(
        "CHECKPOINT_CHAIN_BROKEN",
        `${checkpointPath}/previousDigest`,
        checkpoint.checkpointId,
      );
    const { stateDigest, ...unsigned } = checkpoint;
    if (stateDigest !== checkpointDigest(unsigned))
      fail(
        "CHECKPOINT_DIGEST_INVALID",
        `${checkpointPath}/stateDigest`,
        checkpoint.checkpointId,
      );
    if (previousSnapshot) {
      for (const key of [
        "completedModuleIds",
        "completedActivityRunIds",
        "checkRunIds",
        "retrievalAttemptIds",
        "revisionIds",
        "recoveryEventIds",
      ] as const) {
        const priorIds = previousSnapshot[key];
        const nextIds = checkpoint.snapshot[key];
        if (!priorIds.every((id, priorIndex) => nextIds[priorIndex] === id))
          fail(
            "CHECKPOINT_HISTORY_REWRITTEN",
            `${checkpointPath}/snapshot/${key}`,
            checkpoint.checkpointId,
          );
      }
    }
    previousDigest = checkpoint.stateDigest;
    previousCheckpointTime = checkpointTime;
    previousSnapshot = checkpoint.snapshot;
  });
  const latest = state.checkpoints.at(-1)!;
  if (!jsonEqual(latest.snapshot, checkpointSnapshot(state)))
    fail(
      "CHECKPOINT_LATEST_STALE",
      `/checkpoints/${state.checkpoints.length - 1}/snapshot`,
      latest.checkpointId,
    );
  if (latest.evidenceDigest !== authoritativeEvidenceDigest(state))
    fail(
      "CHECKPOINT_EVIDENCE_STALE",
      `/checkpoints/${state.checkpoints.length - 1}/evidenceDigest`,
      latest.checkpointId,
    );
  if (latest.recordedAt !== state.lastSessionAt)
    fail(
      "CHECKPOINT_LAST_SESSION_MISMATCH",
      `/checkpoints/${state.checkpoints.length - 1}/recordedAt`,
      state.lastSessionAt,
    );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function checkpointSnapshot(state: LearningState): CheckpointSnapshot {
  return structuredClone({
    current: state.current,
    calibration: state.calibration,
    conceptLevels: state.conceptLevels,
    reviewQueue: state.reviewQueue,
    completedModuleIds: state.completedModules.map((item) => item.moduleId),
    completedActivityRunIds: state.completedActivities.map(
      (item) => item.activityRunId,
    ),
    checkRunIds: state.checks.map((item) => item.checkRunId),
    retrievalAttemptIds: state.retrievalAttempts.map((item) => item.attemptId),
    revisionIds: state.revisions.map((item) => item.revisionId),
    recoveryEventIds: state.recoveryHistory.map((item) => item.eventId),
  });
}

export function authoritativeEvidenceDigest(state: LearningState): string {
  const { checkpoints, ...authoritativeEvidence } = state;
  void checkpoints;
  return fingerprint(authoritativeEvidence);
}

function checkpointDigest(checkpoint: Omit<Checkpoint, "stateDigest">): string {
  return fingerprint(checkpoint);
}

export function appendCheckpoint(
  state: LearningState,
  reason: string,
  now = new Date(),
  requestedId?: string,
): LearningState {
  const next = structuredClone(state);
  const checkpoint: Omit<Checkpoint, "stateDigest"> = {
    checkpointId:
      requestedId ??
      `checkpoint-${now.getTime()}-${randomUUID().toLowerCase()}`,
    sessionId: next.current.sessionId,
    recordedAt: now.toISOString(),
    reason,
    previousDigest: next.checkpoints.at(-1)?.stateDigest ?? null,
    evidenceDigest: authoritativeEvidenceDigest(next),
    snapshot: checkpointSnapshot(next),
  };
  next.checkpoints.push({
    ...checkpoint,
    stateDigest: checkpointDigest(checkpoint),
  });
  return next;
}

export function formatLearningLog(state: LearningState): string {
  const lines = [
    "# My PatchQuest learning log",
    "",
    "> Derived from `.patchquest/progress.json`; safe to delete and regenerate.",
    "",
    `State digest: \`${fingerprint(state)}\``,
    "",
    "## Current",
    "",
    `- Session: \`${state.current.sessionId}\``,
    `- Module/activity: \`${state.current.moduleId}\` / \`${state.current.activityId}\``,
    `- Loop: \`${state.current.loopPhase}\``,
    `- Pending: ${state.current.pendingAction.owner} — ${state.current.pendingAction.action}`,
    "",
    "## Checkpoints",
    "",
    ...state.checkpoints.map(
      (item) =>
        `- ${item.recordedAt} — \`${item.checkpointId}\` — ${item.reason} — \`${item.stateDigest}\``,
    ),
    "",
    "## Evidence counts",
    "",
    `- Activities: ${state.completedActivities.length}`,
    `- Checks: ${state.checks.length}`,
    `- Retrieval attempts: ${state.retrievalAttempts.length}`,
    `- Revisions: ${state.revisions.length}`,
    `- Completed modules: ${state.completedModules.length}`,
    `- Review events: ${state.reviewHistory.length}`,
    `- Recovery events: ${state.recoveryHistory.length}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function atomicWriteFile(
  file: string,
  content: string | Uint8Array,
): Promise<void> {
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    if (
      process.env["NODE_ENV"] === "test" &&
      process.env["PATCHQUEST_TEST_FAIL_ATOMIC_WRITE"] === "before-rename"
    )
      fail("ATOMIC_WRITE_INJECTED", file, "test failure before rename");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function syncLearningLog(
  state: LearningState,
  logFile: string,
): Promise<"created" | "updated" | "unchanged"> {
  const projection = formatLearningLog(state);
  const present = await exists(logFile);
  if (present && (await readFile(logFile, "utf8")) === projection)
    return "unchanged";
  await atomicWriteFile(logFile, projection);
  return present ? "updated" : "created";
}

async function repairLearningLogNonBlocking(
  state: LearningState,
  logFile: string,
): Promise<"created" | "updated" | "unchanged" | "deferred"> {
  try {
    return await syncLearningLog(state, logFile);
  } catch (error) {
    console.warn(
      `learning log projection deferred: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return "deferred";
  }
}

async function loadCatalogAndValidator(): Promise<{
  catalog: ModuleCatalog;
  validate: ValidateFunction;
}> {
  const catalog = asCatalog(await readJson(catalogFile));
  verifyCatalogSemantics(catalog);
  return { catalog, validate: await stateValidator() };
}

async function readValidatedState(stateFile: string): Promise<LearningState> {
  if (!(await exists(stateFile)))
    fail(
      "STATE_REQUIRED",
      stateFile,
      "authoritative progress state is missing",
    );
  const value = await readJson(stateFile);
  if (!isObject(value) || value["schemaVersion"] !== 1)
    fail(
      "STATE_VERSION_UNSUPPORTED",
      `${stateFile}/schemaVersion`,
      "back up progress and stop before migration",
    );
  const { catalog, validate } = await loadCatalogAndValidator();
  const state = validateState(validate, value, stateFile);
  verifyStateSemantics(state, catalog);
  return state;
}

export async function initializeLearningState(
  repositoryRoot: string,
  now = new Date(),
  requestedSessionId?: string,
): Promise<{ created: boolean; stateFile: string; logFile: string }> {
  const absoluteRoot = path.resolve(repositoryRoot);
  const target = path.join(absoluteRoot, ".patchquest");
  const stateFile = path.join(target, "progress.json");
  const logFile = path.join(target, "learning-log.md");
  if (await exists(stateFile)) {
    const state = await readValidatedState(stateFile);
    await repairLearningLogNonBlocking(state, logFile);
    return { created: false, stateFile, logFile };
  }

  const sessionId =
    requestedSessionId ??
    `session-${now.getTime()}-${randomUUID().toLowerCase()}`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sessionId))
    fail("INIT_SESSION_ID", "/sessionId", sessionId);
  const template = structuredClone(
    await readJson(stateTemplateFile),
  ) as LearningState;
  const timestamp = now.toISOString();
  template.sessions = [
    {
      sessionId,
      status: "open",
      startedAt: timestamp,
      endedAt: null,
    },
  ];
  template.current.sessionId = sessionId;
  template.lastSessionId = sessionId;
  template.lastSessionAt = timestamp;
  template.checkpoints = [];
  const initialized = appendCheckpoint(
    template,
    "Initialized authoritative PatchQuest learning state.",
    now,
    `checkpoint-init-${sessionId}`,
  );
  const { catalog, validate } = await loadCatalogAndValidator();
  const state = validateState(validate, initialized, "initialized state");
  verifyStateSemantics(state, catalog);

  if (await exists(target)) {
    await atomicWriteFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  } else {
    const temporary = path.join(
      absoluteRoot,
      `.patchquest-init-${now.getTime()}-${randomUUID().toLowerCase()}`,
    );
    try {
      await mkdir(temporary);
      await writeFile(
        path.join(temporary, "progress.json"),
        `${JSON.stringify(state, null, 2)}\n`,
        { flag: "wx" },
      );
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true, recursive: true });
      throw error;
    }
  }
  await repairLearningLogNonBlocking(state, logFile);
  return { created: true, stateFile, logFile };
}

export function rolloverLearningSession(
  state: LearningState,
  now = new Date(),
  requestedSessionId?: string,
): LearningState {
  if (
    state.current.recovery?.status === "pending" ||
    state.current.recovery?.status === "bytes_restored_recheck_pending"
  )
    fail(
      "SESSION_ROLLOVER_RECOVERY_PENDING",
      "/current/recovery",
      state.current.recovery.recoveryId,
    );
  const next = structuredClone(state);
  const open = next.sessions.find((session) => session.status === "open");
  if (!open) fail("SESSION_OPEN_COUNT", "/sessions", "no session is open");
  const timestamp = now.toISOString();
  if (new Date(timestamp).getTime() <= new Date(open.startedAt).getTime())
    fail("SESSION_ROLLOVER_TIME", "/sessions", "new session must start later");
  open.status = "closed";
  open.endedAt = timestamp;
  const sessionId =
    requestedSessionId ??
    `session-${now.getTime()}-${randomUUID().toLowerCase()}`;
  next.sessions.push({
    sessionId,
    status: "open",
    startedAt: timestamp,
    endedAt: null,
  });
  next.current.sessionId = sessionId;
  const due = next.reviewQueue.find((review) =>
    isReviewDue(review, sessionId, now),
  );
  if (due) {
    next.current.moduleId = due.moduleId;
    next.current.activityId = due.promptId;
    next.current.status = "review";
    next.current.loopPhase = "retrieve";
    next.current.supportLevel = "independent";
    next.current.pendingAction = {
      owner: "learner",
      action: `Answer due prompt ${due.promptId} from a closed source before new content.`,
    };
    next.current.recovery = null;
  }
  next.lastSessionId = sessionId;
  next.lastSessionAt = timestamp;
  return appendCheckpoint(
    next,
    `Closed the prior session and opened ${sessionId}.`,
    now,
  );
}

export async function backupLearningState(
  stateFile: string,
  now = new Date(),
): Promise<string[]> {
  const absoluteState = path.resolve(stateFile);
  await access(absoluteState);
  const backupDirectory = path.join(path.dirname(absoluteState), "backups");
  await mkdir(backupDirectory, { recursive: true });
  const timestamp = now.toISOString().replaceAll(/[:.]/g, "-");
  const sources = [absoluteState];
  const outputs: string[] = [];
  for (const source of sources) {
    await access(source);
    const destination = path.join(
      backupDirectory,
      `${timestamp}-${path.basename(source)}`,
    );
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      if (isObject(error) && error["code"] === "EEXIST")
        fail("BACKUP_EXISTS", destination, "backup destination already exists");
      throw error;
    }
    outputs.push(destination);
  }
  return outputs;
}

const revisionExcludedDirectories = new Set([
  ".git",
  ".patchquest",
  ".cache",
  ".nyc_output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

function revisionFileIgnored(relative: string): boolean {
  const name = path.basename(relative);
  return (
    name === ".DS_Store" ||
    name.endsWith(".tsbuildinfo") ||
    name === ".env" ||
    (name.startsWith(".env.") && name !== ".env.example")
  );
}

async function revisionFiles(
  directory: string,
  relative = "",
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!revisionExcludedDirectories.has(entry.name))
        files.push(...(await revisionFiles(child, childRelative)));
    } else if (entry.isFile() && !revisionFileIgnored(childRelative)) {
      files.push(childRelative);
    }
  }
  return files;
}

export async function canonicalSourceInventory(
  repositoryRoot = root,
): Promise<string[]> {
  return await revisionFiles(repositoryRoot);
}

export async function computeRepositoryRevision(
  repositoryRoot = root,
): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of await canonicalSourceInventory(repositoryRoot)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(repositoryRoot, relative)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function fileSha256(file: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(await readFile(file))
    .digest("hex")}`;
}

export async function guardedPrepareRecoveryTarget(
  target: string,
  backup: string,
): Promise<string> {
  const content = await readFile(target);
  await writeFile(backup, content, { flag: "wx" });
  return await fileSha256(target);
}

export async function guardedRestoreRecoveryTarget(
  target: string,
  backup: string,
  expectedFingerprint: string,
  allowAlreadyRestored = false,
): Promise<{
  mutatedFingerprint: string;
  restoredFingerprint: string;
  alreadyRestored: boolean;
}> {
  if ((await fileSha256(backup)) !== expectedFingerprint)
    fail(
      "RECOVERY_BACKUP_MISMATCH",
      backup,
      "the prepared recovery copy no longer matches its fingerprint",
    );
  const mutatedFingerprint = await fileSha256(target);
  const alreadyRestored = mutatedFingerprint === expectedFingerprint;
  if (alreadyRestored && !allowAlreadyRestored)
    fail(
      "RECOVERY_MUTATION_NOT_OBSERVED",
      target,
      "the target still matches its pre-exercise fingerprint",
    );
  if (!alreadyRestored) await atomicWriteFile(target, await readFile(backup));
  const restoredFingerprint = await fileSha256(target);
  if (restoredFingerprint !== expectedFingerprint)
    fail(
      "RECOVERY_RESTORE_MISMATCH",
      target,
      "the restored target does not match the pre-exercise fingerprint",
    );
  return { mutatedFingerprint, restoredFingerprint, alreadyRestored };
}

function repositoryRootForState(stateFile: string): string {
  if (
    process.env["NODE_ENV"] === "test" &&
    process.env["PATCHQUEST_TEST_REPOSITORY_ROOT"]
  )
    return path.resolve(process.env["PATCHQUEST_TEST_REPOSITORY_ROOT"]);
  const stateDirectory = path.dirname(path.resolve(stateFile));
  if (path.basename(stateDirectory) !== ".patchquest")
    fail(
      "STATE_LOCATION_INVALID",
      stateFile,
      "authoritative progress must live under <repository>/.patchquest",
    );
  return path.dirname(stateDirectory);
}

async function executeCataloguedCommand(
  command: string,
  repositoryRoot: string,
): Promise<number> {
  const match = command.match(/^cd node && npm run ([a-z][a-z0-9:]*)$/);
  if (!match) fail("CHECK_COMMAND_UNSAFE", "/command", command);
  return await new Promise<number>((resolve, reject) => {
    const child = spawn("npm", ["run", match[1]!], {
      cwd: path.join(repositoryRoot, "node"),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export async function runLearningCheck(
  stateFile: string,
  moduleId: string,
  checkId: string,
): Promise<Check> {
  const absoluteState = path.resolve(stateFile);
  const state = await readValidatedState(absoluteState);
  const { catalog, validate } = await loadCatalogAndValidator();
  const module = readyById(catalog).get(moduleId);
  if (!module)
    fail("CHECK_NOT_CATALOGUED", "/moduleId", `${moduleId}/${checkId}`);
  const required = module.requiredChecks.find(
    (item) => item.checkId === checkId,
  );
  if (!required)
    fail("CHECK_NOT_CATALOGUED", "/checkId", `${moduleId}/${checkId}`);
  const repositoryRoot = repositoryRootForState(absoluteState);
  const repositoryRevision = await computeRepositoryRevision(repositoryRoot);
  let exitCode: number;
  let outcome: Check["outcome"];
  let evidence: string;
  try {
    exitCode = await executeCataloguedCommand(required.command, repositoryRoot);
    outcome = exitCode === 0 ? "passed" : "failed";
    evidence = `The catalogued command exited with code ${exitCode} under learning:check.`;
  } catch (error) {
    exitCode = -1;
    outcome = "blocked";
    evidence = `The catalogued command could not start or complete because infrastructure reported ${
      error instanceof Error ? error.message : String(error)
    }.`;
  }
  const afterRevision = await computeRepositoryRevision(repositoryRoot);
  if (afterRevision !== repositoryRevision)
    fail(
      "CHECK_MUTATED_REPOSITORY",
      "/repositoryRevision",
      "catalogued checks must not alter tracked repository inputs",
    );
  const recordedAt = new Date().toISOString();
  const checkRunId = `check-${moduleId}-${checkId}-${Date.parse(recordedAt)}-${randomUUID().toLowerCase()}`;
  const unsigned: Omit<Check, "gateDigest" | "evidence" | "recordedAt"> = {
    checkRunId,
    checkId,
    sessionId: state.current.sessionId,
    moduleId,
    activityId: required.activityId,
    command: required.command,
    repositoryRevision,
    recordedBy: "learning:check",
    exitCode,
    outcome,
  };
  const check: Check = {
    ...unsigned,
    gateDigest: canonicalGateDigest(moduleId, module.requiredChecks),
    recordedAt,
    evidence,
  };
  const next = structuredClone(state);
  next.checks.push(check);
  next.lastSessionAt = recordedAt;
  const checkpointed = appendCheckpoint(
    next,
    `Recorded actual result for check ${moduleId}/${checkId}.`,
    new Date(recordedAt),
  );
  const validated = validateState(validate, checkpointed, absoluteState);
  verifyStateSemantics(validated, catalog);
  await backupLearningState(absoluteState);
  await atomicWriteFile(
    absoluteState,
    `${JSON.stringify(validated, null, 2)}\n`,
  );
  await repairLearningLogNonBlocking(
    validated,
    path.join(path.dirname(absoluteState), "learning-log.md"),
  );
  return check;
}

function expectIntegrityError(
  action: () => void,
  code: string,
  integrityPath: string,
): void {
  try {
    action();
  } catch (error) {
    if (
      error instanceof LearningIntegrityError &&
      error.code === code &&
      error.integrityPath === integrityPath
    )
      return;
    throw new Error(
      `negative probe expected ${code} ${integrityPath}, received ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  throw new Error(`negative probe did not reject ${code} ${integrityPath}`);
}

async function verifyProtocol(): Promise<void> {
  const catalog = asCatalog(await readJson(catalogFile));
  verifyCatalogSemantics(catalog);
  await verifyCatalogFiles(catalog);
  const validate = await stateValidator();

  const templateValue = await readJson(stateTemplateFile);
  const template = validateState(
    validate,
    templateValue,
    "learning state template",
  );
  verifyStateSemantics(template, catalog);
  if ((await readFile(logTemplateFile, "utf8")) !== formatLearningLog(template))
    fail(
      "LOG_PROJECTION_STALE",
      "assets/session-log.md",
      "regenerate the disposable projection from the template",
    );

  const evaluatedValue = await readJson(evaluatedStateFile);
  const evaluated = validateState(
    validate,
    evaluatedValue,
    "evaluated learning state example",
  );
  verifyStateSemantics(evaluated, catalog);
  const evaluatedLog = await readFile(evaluatedLogFile, "utf8");
  if (evaluatedLog !== formatLearningLog(evaluated))
    fail(
      "LOG_PROJECTION_STALE",
      "evaluated-learning-log.example.md",
      "regenerate the disposable projection from evaluated state",
    );

  let negativeProbes = 0;
  const probe = (
    action: () => void,
    code: string,
    integrityPath: string,
  ): void => {
    expectIntegrityError(action, code, integrityPath);
    negativeProbes += 1;
  };
  let checkpointProbeId = 0;
  const checkpointProbe = (
    state: LearningState,
    reason: string,
  ): LearningState => {
    checkpointProbeId += 1;
    return appendCheckpoint(
      state,
      reason,
      new Date(state.lastSessionAt),
      `checkpoint-probe-${checkpointProbeId}`,
    );
  };

  const interruptionPhases = [
    "acquire",
    "retrieve",
    "inspect",
    "act",
    "explain",
    "self-evaluate",
    "correct",
    "prove",
    "feedback",
    "record",
  ];
  for (const phase of interruptionPhases) {
    const interrupted = structuredClone(template) as LearningState;
    interrupted.current.status = "learning";
    interrupted.current.loopPhase = phase;
    interrupted.current.pendingAction = {
      owner: "learner",
      action: "Resume the saved learning-loop phase with one bounded action.",
    };
    const checkpointed = checkpointProbe(
      interrupted,
      `Persisted an interruption during ${phase}.`,
    );
    verifyStateSemantics(checkpointed, catalog);
  }

  const falselyEvaluated = structuredClone(evaluated) as LearningState;
  falselyEvaluated.completedModules = [];
  falselyEvaluated.revisions = [];
  probe(
    () => verifyStateSemantics(falselyEvaluated, catalog),
    "EVALUATED_RETRIEVAL_REVISION_COUNT",
    "/retrievalAttempts/1/status",
  );

  const awaitingAcrossSessions = structuredClone(evaluated) as LearningState;
  awaitingAcrossSessions.completedModules = [];
  awaitingAcrossSessions.retrievalAttempts[1]!.status = "awaiting_revision";
  awaitingAcrossSessions.revisions = [];
  awaitingAcrossSessions.current = {
    sessionId: "session-resume-example",
    moduleId: "00",
    activityId: "00-mastery-loop",
    status: "learning",
    loopPhase: "correct",
    supportLevel: "independent",
    pendingAction: {
      owner: "learner",
      action: "Revise the saved mastery answer before rolling the session.",
    },
    recovery: null,
  };
  probe(
    () => verifyStateSemantics(awaitingAcrossSessions, catalog),
    "AWAITING_REVISION_SESSION_MISMATCH",
    "/current/sessionId",
  );

  const stringCompletion = structuredClone(templateValue) as DataObject;
  stringCompletion["completedModules"] = ["04"];
  probe(
    () => validateState(validate, stringCompletion, "string completion"),
    "SCHEMA_INVALID",
    "/completedModules/0",
  );

  const whitespaceEvidence = structuredClone(evaluatedValue) as LearningState;
  whitespaceEvidence.completedActivities[0]!.evidence[0] = "   ";
  probe(
    () => validateState(validate, whitespaceEvidence, "whitespace evidence"),
    "SCHEMA_INVALID",
    "/completedActivities/0/evidence/0",
  );
  const whitespaceFeedback = structuredClone(evaluatedValue) as LearningState;
  whitespaceFeedback.retrievalAttempts[0]!.feedback.exactGap = " \t ";
  probe(
    () => validateState(validate, whitespaceFeedback, "whitespace feedback"),
    "SCHEMA_INVALID",
    "/retrievalAttempts/0/feedback/exactGap",
  );
  const whitespaceCommand = structuredClone(evaluatedValue) as LearningState;
  whitespaceCommand.checks[0]!.command = "   ";
  probe(
    () => validateState(validate, whitespaceCommand, "whitespace command"),
    "SCHEMA_INVALID",
    "/checks/0/command",
  );
  const whitespaceAnswer = structuredClone(evaluatedValue) as LearningState;
  whitespaceAnswer.retrievalAttempts[0]!.answer = "\n\t";
  probe(
    () => validateState(validate, whitespaceAnswer, "whitespace answer"),
    "SCHEMA_INVALID",
    "/retrievalAttempts/0/answer",
  );
  const paddedCommand = structuredClone(evaluatedValue) as LearningState;
  paddedCommand.checks[0]!.command = " cd node && npm run verify ";
  probe(
    () => validateState(validate, paddedCommand, "padded command"),
    "TEXT_NOT_TRIMMED",
    "/checks/0/command",
  );

  const rewrittenHistory = structuredClone(evaluatedValue) as LearningState;
  rewrittenHistory.reviewHistory[0]!.reason =
    "Replaced prior evidence with a different scheduling explanation.";
  probe(
    () => verifyDraftTransition(evaluated, rewrittenHistory),
    "DRAFT_HISTORY_REWRITE",
    "/reviewHistory",
  );
  const authoredCheck = structuredClone(evaluatedValue) as LearningState;
  authoredCheck.checks[0]!.evidence =
    "A draft attempted to replace the operational command evidence.";
  probe(
    () => verifyDraftTransition(evaluated, authoredCheck),
    "DRAFT_CHECK_MUTATION",
    "/checks",
  );

  const vagueTakeaway = structuredClone(evaluatedValue) as LearningState;
  vagueTakeaway.completedModules[0]!.firstPersonTakeaway =
    "I completed the module and all of its work.";
  probe(
    () => verifyStateSemantics(vagueTakeaway, catalog),
    "TAKEAWAY_NOT_MEANINGFUL",
    "/completedModules/0/firstPersonTakeaway",
  );
  const wrongCommand = structuredClone(evaluatedValue) as LearningState;
  wrongCommand.checks[0]!.command = "cd node && npm run unit";
  probe(
    () => verifyStateSemantics(wrongCommand, catalog),
    "CHECK_COMMAND_MISMATCH",
    "/checks/0/command",
  );
  const crossModuleCheck = structuredClone(evaluatedValue) as LearningState;
  crossModuleCheck.checks[0]!.moduleId = "03";
  probe(
    () => verifyStateSemantics(crossModuleCheck, catalog),
    "CHECK_CATALOG_MISMATCH",
    "/checks/0/checkId",
  );
  const crossSessionCheck = structuredClone(evaluatedValue) as LearningState;
  crossSessionCheck.checks[0]!.sessionId = "session-resume-example";
  probe(
    () => verifyStateSemantics(crossSessionCheck, catalog),
    "EVIDENCE_OUTSIDE_SESSION",
    "/checks/0/recordedAt",
  );
  const staleCheck = structuredClone(evaluatedValue) as LearningState;
  staleCheck.checks[0]!.gateDigest =
    "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  probe(
    () => verifyStateSemantics(staleCheck, catalog),
    "CHECK_DIGEST_INVALID",
    "/checks/0/gateDigest",
  );
  const wrongRevision = structuredClone(evaluatedValue) as LearningState;
  wrongRevision.completedModules[0]!.retrievalEvidenceRefs[0]!.revisionId =
    "revision-not-the-evaluated-one";
  probe(
    () => verifyStateSemantics(wrongRevision, catalog),
    "RETRIEVAL_REVISION_MISMATCH",
    "/completedModules/0/retrievalEvidenceRefs",
  );
  const reusedCheck = structuredClone(evaluatedValue) as LearningState;
  const copiedCompletion = structuredClone(reusedCheck.completedModules[0]!);
  copiedCompletion.completionId = "completion-reuse-example";
  reusedCheck.completedModules.push(copiedCompletion);
  probe(
    () => verifyStateSemantics(reusedCheck, catalog),
    "CHECK_EVIDENCE_REUSED",
    "/completedModules/1/checkRunIds",
  );

  const badPrior = structuredClone(evaluatedValue) as LearningState;
  badPrior.reviewHistory[0]!.eventType = "rescheduled";
  badPrior.reviewHistory[0]!.priorReviewId = "review-never-created";
  probe(
    () => verifyStateSemantics(badPrior, catalog),
    "REVIEW_RESCHEDULE_PRIOR_INACTIVE",
    "/reviewHistory/0/priorReviewId",
  );
  const staleQueue = structuredClone(evaluatedValue) as LearningState;
  staleQueue.reviewQueue[0]!.reason = "A stale replacement reason.";
  probe(
    () => verifyStateSemantics(staleQueue, catalog),
    "REVIEW_QUEUE_HISTORY_MISMATCH",
    "/reviewQueue/0",
  );
  const dueIgnored = structuredClone(evaluatedValue) as LearningState;
  dueIgnored.current.status = "learning";
  dueIgnored.current.moduleId = "01";
  dueIgnored.current.activityId = "01-boundaries";
  probe(
    () => verifyStateSemantics(dueIgnored, catalog),
    "DUE_REVIEW_NOT_CURRENT",
    "/current",
  );

  const orphanReview = structuredClone(evaluatedValue) as LearningState;
  orphanReview.reviewHistory.push({
    ...structuredClone(orphanReview.reviewHistory[0]!),
    eventId: "review-event-orphan",
    eventType: "completed",
    reviewId: "review-never-scheduled",
    sessionId: "session-resume-example",
    recordedAt: "2026-07-17T12:31:00.000Z",
  });
  probe(
    () => verifyStateSemantics(orphanReview, catalog),
    "REVIEW_COMPLETION_ORPHAN",
    "/reviewHistory/1/reviewId",
  );

  const sameIdReschedule = structuredClone(evaluatedValue) as LearningState;
  sameIdReschedule.reviewHistory.push({
    ...structuredClone(sameIdReschedule.reviewHistory[0]!),
    eventId: "review-event-same-id",
    eventType: "rescheduled",
    priorReviewId: "review-loop-example",
    sessionId: "session-resume-example",
    recordedAt: "2026-07-17T12:31:00.000Z",
  });
  probe(
    () => verifyStateSemantics(sameIdReschedule, catalog),
    "REVIEW_ID_REUSED",
    "/reviewHistory/1/reviewId",
  );

  const addDelayedAttempt = (
    target: LearningState,
    attemptId: string,
  ): RetrievalEvidenceRef => {
    const attempt = structuredClone(evaluated.retrievalAttempts[0]!);
    attempt.attemptId = attemptId;
    attempt.sessionId = "session-resume-example";
    attempt.moduleId = "00";
    attempt.activityId = "00-delayed-loop";
    attempt.promptId = "00-delayed-loop";
    attempt.purpose = "delayed-review";
    attempt.attemptedAt = "2026-07-17T12:31:00.000Z";
    attempt.answer =
      "The Runner produces, the verifier checks evidence, and the human separately decides completion.";
    attempt.outcome = "accurate";
    attempt.predictedOutcome = "accurate";
    attempt.status = "evaluated";
    attempt.misconception = null;
    attempt.correction = null;
    attempt.checkRunIds = [];
    target.retrievalAttempts.push(attempt);
    return { attemptId, revisionId: null };
  };

  const completedReview = structuredClone(evaluatedValue) as LearningState;
  const completedReviewEvidence = addDelayedAttempt(
    completedReview,
    "attempt-delayed-completed",
  );
  completedReview.reviewHistory.push({
    ...structuredClone(completedReview.reviewHistory[0]!),
    eventId: "review-event-completed",
    eventType: "completed",
    sessionId: "session-resume-example",
    recordedAt: "2026-07-17T12:31:00.000Z",
    retrievalEvidenceRef: completedReviewEvidence,
  });
  completedReview.reviewQueue = [];
  completedReview.current = {
    sessionId: "session-resume-example",
    moduleId: "01",
    activityId: "01-boundaries",
    status: "learning",
    loopPhase: "acquire",
    supportLevel: "worked-example",
    pendingAction: {
      owner: "learner",
      action: "Close the source and answer the module 01 boundary prompt.",
    },
    recovery: null,
  };
  verifyStateSemantics(
    checkpointProbe(completedReview, "Completed the active delayed review."),
    catalog,
  );

  const rescheduledReview = structuredClone(evaluatedValue) as LearningState;
  const rescheduledReviewEvidence = addDelayedAttempt(
    rescheduledReview,
    "attempt-delayed-rescheduled",
  );
  rescheduledReview.reviewHistory.push({
    ...structuredClone(rescheduledReview.reviewHistory[0]!),
    eventId: "review-event-rescheduled",
    eventType: "rescheduled",
    reviewId: "review-loop-rescheduled",
    priorReviewId: "review-loop-example",
    sessionId: "session-resume-example",
    recordedAt: "2026-07-17T12:31:00.000Z",
    retrievalEvidenceRef: rescheduledReviewEvidence,
  });
  rescheduledReview.reviewQueue = [
    {
      ...structuredClone(rescheduledReview.reviewQueue[0]!),
      reviewId: "review-loop-rescheduled",
      priorReviewId: "review-loop-example",
      scheduledBySessionId: "session-resume-example",
    },
  ];
  rescheduledReview.current = structuredClone(completedReview.current);
  verifyStateSemantics(
    checkpointProbe(
      rescheduledReview,
      "Rescheduled the completed review identity.",
    ),
    catalog,
  );

  const diagnosticAfterActiveWork = structuredClone(
    evaluatedValue,
  ) as LearningState;
  diagnosticAfterActiveWork.retrievalAttempts[0]!.attemptedAt =
    "2026-07-17T12:06:00Z";
  probe(
    () => verifyStateSemantics(diagnosticAfterActiveWork, catalog),
    "ACTIVE_WORK_DIAGNOSTIC_REQUIRED",
    "/completedActivities/0/completedAt",
  );

  const diagnosticAfterProof = structuredClone(evaluatedValue) as LearningState;
  diagnosticAfterProof.retrievalAttempts[0]!.attemptedAt =
    "2026-07-17T12:11:00Z";
  diagnosticAfterProof.completedActivities.forEach((activity, index) => {
    activity.completedAt = `2026-07-17T12:${12 + index}:00Z`;
  });
  probe(
    () => verifyStateSemantics(diagnosticAfterProof, catalog),
    "CHECK_DIAGNOSTIC_REQUIRED",
    "/checks/0/recordedAt",
  );

  const overlappingSessions = structuredClone(evaluatedValue) as LearningState;
  overlappingSessions.sessions[1]!.startedAt = "2026-07-17T12:29:00Z";
  probe(
    () => verifyStateSemantics(overlappingSessions, catalog),
    "SESSION_OVERLAP",
    "/sessions/1/startedAt",
  );

  const vagueEvidence = structuredClone(evaluatedValue) as LearningState;
  vagueEvidence.completedActivities[0]!.evidence[0] = "Evidence exists";
  probe(
    () => verifyStateSemantics(vagueEvidence, catalog),
    "EVIDENCE_TOO_VAGUE",
    "/completedActivities/0/evidence/0",
  );

  const brokenCheckpoint = structuredClone(evaluatedValue) as LearningState;
  brokenCheckpoint.checkpoints[0]!.stateDigest =
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  probe(
    () => verifyStateSemantics(brokenCheckpoint, catalog),
    "CHECKPOINT_DIGEST_INVALID",
    "/checkpoints/0/stateDigest",
  );

  const vagueRecovery = structuredClone(templateValue) as LearningState;
  vagueRecovery.current.moduleId = "04";
  vagueRecovery.current.activityId = "04-forbidden-import-mutation";
  vagueRecovery.current.loopPhase = "recover";
  vagueRecovery.current.recovery = {
    recoveryId: "recovery-vague-example",
    sessionId: "session-template",
    moduleId: "04",
    activityId: "04-forbidden-import-mutation",
    target: "file",
    preExerciseReference: "git diff target before exercise",
    preExerciseFingerprint:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    deliberateMutation: "Add one forbidden framework import.",
    expectedFailingCheckId: "architecture-gate",
    expectedFailingCommand: "cd node && npm run architecture",
    expectedFailureCheckRunId: null,
    restorationCheckRunId: null,
    restorationAction: "Remove only the deliberately added import.",
    restoredFingerprint: null,
    status: "pending",
    recordedAt: "2000-01-01T00:00:00.000Z",
    recoveredAt: null,
  };
  probe(
    () => verifyStateSemantics(vagueRecovery, catalog),
    "RECOVERY_TARGET_VAGUE",
    "/current/recovery/target",
  );
  const wrongRecoveryCheck = structuredClone(vagueRecovery);
  wrongRecoveryCheck.current.recovery!.target =
    "node/packages/domain/src/example.ts";
  wrongRecoveryCheck.current.recovery!.expectedFailingCommand =
    "cd node && npm run verify";
  probe(
    () => verifyStateSemantics(wrongRecoveryCheck, catalog),
    "RECOVERY_CHECK_MISMATCH",
    "/current/recovery/expectedFailingCommand",
  );

  const restoredRecovery = structuredClone(template) as LearningState;
  restoredRecovery.lastSessionAt = "2000-01-01T00:00:04.000Z";
  const recoveryDiagnostic = structuredClone(evaluated.retrievalAttempts[0]!);
  recoveryDiagnostic.attemptId = "attempt-recovery-diagnostic-example";
  recoveryDiagnostic.sessionId = "session-template";
  recoveryDiagnostic.moduleId = "04";
  recoveryDiagnostic.activityId = "04-boundary-prediction";
  recoveryDiagnostic.promptId = "04-boundary-prediction";
  recoveryDiagnostic.conceptIds = ["dependency-direction", "context-isolation"];
  recoveryDiagnostic.attemptedAt = "2000-01-01T00:00:00.000Z";
  recoveryDiagnostic.selfEvaluation.criteria = [
    {
      criterionId: "04-prediction",
      score: 1,
      evidence: "I identified the intended inward dependency direction.",
    },
    {
      criterionId: "04-mechanism",
      score: 1,
      evidence:
        "I predicted that architecture checks reject an outward import.",
    },
    {
      criterionId: "04-proof-and-recovery",
      score: 0,
      evidence: "I had not yet run the deliberate recovery exercise.",
    },
  ];
  restoredRecovery.retrievalAttempts = [recoveryDiagnostic];
  const recoveryBase: RecoveryRecord = {
    recoveryId: "recovery-restored-example",
    sessionId: "session-template",
    moduleId: "04",
    activityId: "04-forbidden-import-mutation",
    target: "node/packages/domain/src/example.ts",
    preExerciseReference:
      "Recorded exact pre-exercise diff for the target file.",
    preExerciseFingerprint:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    deliberateMutation: "Added one deliberate forbidden framework import.",
    expectedFailingCheckId: "architecture-gate",
    expectedFailingCommand: "cd node && npm run architecture",
    expectedFailureCheckRunId: "check-recovery-failed-example",
    restorationCheckRunId: "check-recovery-pass-example",
    restorationAction: "Removed only the deliberately added framework import.",
    restoredFingerprint:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    status: "restored",
    recordedAt: "2000-01-01T00:00:04.000Z",
    recoveredAt: "2000-01-01T00:00:04.000Z",
  };
  restoredRecovery.current = {
    sessionId: "session-template",
    moduleId: "04",
    activityId: "04-forbidden-import-mutation",
    status: "learning",
    loopPhase: "inspect",
    supportLevel: "independent",
    pendingAction: {
      owner: "guide",
      action:
        "Confirm the restored fingerprint before continuing the exercise.",
    },
    recovery: null,
  };
  const recoveryGateDigest = canonicalGateDigest(
    "04",
    readyModule(catalog.modules[4]!).requiredChecks,
  );
  restoredRecovery.checks = [
    {
      checkRunId: "check-recovery-failed-example",
      checkId: "architecture-gate",
      sessionId: "session-template",
      moduleId: "04",
      activityId: "04-architecture-check",
      command: "cd node && npm run architecture",
      repositoryRevision:
        "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      gateDigest: recoveryGateDigest,
      recordedBy: "learning:check",
      exitCode: 1,
      outcome: "failed",
      recordedAt: "2000-01-01T00:00:01.000Z",
      evidence: "The deliberate forbidden import made architecture exit one.",
    },
    {
      checkRunId: "check-recovery-pass-example",
      checkId: "architecture-gate",
      sessionId: "session-template",
      moduleId: "04",
      activityId: "04-architecture-check",
      command: "cd node && npm run architecture",
      repositoryRevision:
        "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      gateDigest: recoveryGateDigest,
      recordedBy: "learning:check",
      exitCode: 0,
      outcome: "passed",
      recordedAt: "2000-01-01T00:00:03.000Z",
      evidence: "The restored target made architecture exit zero again.",
    },
  ];
  restoredRecovery.recoveryHistory = [
    {
      ...structuredClone(recoveryBase),
      eventId: "recovery-event-pending-example",
      expectedFailureCheckRunId: null,
      restorationCheckRunId: null,
      restoredFingerprint: null,
      status: "pending",
      recordedAt: "2000-01-01T00:00:00.000Z",
      recoveredAt: null,
    },
    {
      ...structuredClone(recoveryBase),
      eventId: "recovery-event-bytes-restored-example",
      restorationCheckRunId: null,
      status: "bytes_restored_recheck_pending",
      recordedAt: "2000-01-01T00:00:02.000Z",
      recoveredAt: null,
    },
    {
      ...structuredClone(recoveryBase),
      eventId: "recovery-event-restored-example",
    },
  ];
  verifyStateSemantics(
    checkpointProbe(
      restoredRecovery,
      "Recorded complete recovery restoration evidence.",
    ),
    catalog,
  );

  const missingRecoveryTimestamp = structuredClone(restoredRecovery);
  missingRecoveryTimestamp.recoveryHistory[2]!.recoveredAt = null;
  probe(
    () =>
      validateState(
        validate,
        missingRecoveryTimestamp,
        "restored recovery timestamp",
      ),
    "SCHEMA_INVALID",
    "/recoveryHistory/2/recoveredAt",
  );

  const markdownOnly = structuredClone(catalog);
  markdownOnly.modules[0]!.implementationEvidence = ["README.md"];
  probe(
    () => verifyCatalogSemantics(markdownOnly),
    "IMPLEMENTATION_EVIDENCE_NONEXECUTABLE",
    "/modules/0/implementationEvidence",
  );
  const duplicateCheck = structuredClone(catalog);
  duplicateCheck.modules[0]!.requiredChecks!.push(
    structuredClone(duplicateCheck.modules[0]!.requiredChecks![0]!),
  );
  probe(
    () => verifyCatalogSemantics(duplicateCheck),
    "CATALOG_DUPLICATE_CHECK",
    "/modules/0/requiredChecks",
  );
  const leakedPlanned = structuredClone(catalog);
  leakedPlanned.modules[5]!.source = "modules/05-not-ready.md";
  probe(
    () => verifyCatalogSemantics(leakedPlanned),
    "PLANNED_MODULE_EXECUTABLE",
    "/modules/5/source",
  );

  const module00Source = await readFile(
    path.join(courseRoot, "en/modules/00-orient-myself.md"),
    "utf8",
  );
  probe(
    () =>
      verifyModuleMarkdown(
        readyModule(catalog.modules[0]!, 0),
        module00Source.replace(
          "## Bounded action",
          "## Bounded action\n\nUnexpected `00-not-catalogued` activity.",
        ),
      ),
    "MODULE_ID_UNEXPECTED",
    "modules/00-orient-myself.md",
  );

  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  for (const reference of [
    "references/learning-protocol.md",
    "references/evaluated-state.example.json",
    "references/state-migration.md",
    "course/learning-state.schema.json",
    "course/en/module-catalog.json",
    ".patchquest/progress.json",
  ])
    if (!skill.includes(reference))
      fail("SKILL_REFERENCE_MISSING", "SKILL.md", reference);
  const protocol = await readFile(
    path.join(skillRoot, "references/learning-protocol.md"),
    "utf8",
  );
  for (const requirement of [
    "learning:init",
    "learning:resume",
    "learning:log",
    "learning:checkpoint",
    "learning:check",
    "sole authority",
    "awaiting_revision",
    "Persist every turn",
    "Recover interrupted mutation exercises",
    "reviewHistory",
    "recoveryHistory",
  ])
    if (!protocol.includes(requirement))
      fail("PROTOCOL_REQUIREMENT_MISSING", "learning-protocol.md", requirement);
  const migration = await readFile(
    path.join(skillRoot, "references/state-migration.md"),
    "utf8",
  );
  for (const requirement of [
    "backups",
    "schemaVersion",
    "stop",
    "no backup",
    "sole learner authority",
    "progress.draft.json",
  ])
    if (!migration.includes(requirement))
      fail("MIGRATION_REQUIREMENT_MISSING", "state-migration.md", requirement);
  const ignore = await readFile(path.join(root, ".gitignore"), "utf8");
  if (!ignore.split("\n").includes(".patchquest/"))
    fail("PATCHQUEST_IGNORE_MISSING", ".gitignore", ".patchquest/");
  if (
    (await readFile(path.join(nodeRoot, ".nvmrc"), "utf8")).trim() !== "24.11.0"
  )
    fail("NODE_PIN_MISMATCH", "node/.nvmrc", "24.11.0");
  const manifest = await readJson(path.join(nodeRoot, "package.json"));
  if (!isObject(manifest) || manifest["packageManager"] !== "npm@11.6.1")
    fail("NPM_PIN_MISMATCH", "node/package.json", "npm@11.6.1");

  const readyCount = catalog.modules.filter(
    (module) => module.availability === "ready",
  ).length;
  console.log(
    `learning: ${readyCount} ready and ${catalog.modules.length - readyCount} planned modules, authoritative state, derived projections, and ${negativeProbes} stable negative probes verified`,
  );
}

async function verifyLocalState(stateArgument: string): Promise<void> {
  const stateFile = path.resolve(process.cwd(), stateArgument);
  const state = await readValidatedState(stateFile);
  const projection = await repairLearningLogNonBlocking(
    state,
    path.join(path.dirname(stateFile), "learning-log.md"),
  );
  console.log(
    `learning state: ${stateFile} is valid; log projection ${projection}`,
  );
}

async function updateLocalLog(
  stateArgument: string,
  logArgument?: string,
): Promise<void> {
  const stateFile = path.resolve(process.cwd(), stateArgument);
  const logFile = logArgument
    ? path.resolve(process.cwd(), logArgument)
    : path.join(path.dirname(stateFile), "learning-log.md");
  const state = await readValidatedState(stateFile);
  const result = await syncLearningLog(state, logFile);
  console.log(`learning log projection: ${result}`);
}

async function resumeLocalState(stateArgument: string): Promise<void> {
  const stateFile = path.resolve(process.cwd(), stateArgument);
  const logFile = path.join(path.dirname(stateFile), "learning-log.md");
  const state = await readValidatedState(stateFile);
  const awaiting = state.retrievalAttempts.find(
    (attempt) => attempt.status === "awaiting_revision",
  );
  if (awaiting) {
    await repairLearningLogNonBlocking(state, logFile);
    console.log(
      `learning session: resumed correction ${state.lastSessionId} ${awaiting.attemptId}`,
    );
    return;
  }
  const recovery = state.current.recovery;
  if (
    recovery?.status === "pending" ||
    recovery?.status === "bytes_restored_recheck_pending"
  ) {
    await repairLearningLogNonBlocking(state, logFile);
    console.log(
      `learning session: resumed recovery ${state.lastSessionId} ${recovery.recoveryId} ${recovery.status}`,
    );
    return;
  }
  await backupLearningState(stateFile);
  const next = rolloverLearningSession(state);
  const { catalog, validate } = await loadCatalogAndValidator();
  const validated = validateState(validate, next, stateFile);
  verifyStateSemantics(validated, catalog);
  await atomicWriteFile(stateFile, `${JSON.stringify(validated, null, 2)}\n`);
  await repairLearningLogNonBlocking(validated, logFile);
  console.log(`learning session: opened ${validated.lastSessionId}`);
}

function transitionTime(state: LearningState): Date {
  return new Date(
    Math.max(Date.now(), new Date(state.lastSessionAt).getTime() + 1),
  );
}

function recoveryTarget(
  repositoryRoot: string,
  targetArgument: string,
  allowPatchquest = false,
): { absolute: string; relative: string } {
  const absolute = path.resolve(repositoryRoot, targetArgument);
  const relative = path.relative(repositoryRoot, absolute);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    (!allowPatchquest && relative.split(path.sep).includes(".patchquest"))
  )
    fail(
      "RECOVERY_TARGET_OUTSIDE_REPOSITORY",
      targetArgument,
      "choose one existing repository source file outside .patchquest",
    );
  return { absolute, relative: relative.split(path.sep).join("/") };
}

async function prepareRecoveryLocalState(
  stateArgument: string,
  targetArgument: string,
  moduleId: string,
  activityId: string,
  checkId: string,
): Promise<void> {
  const stateFile = path.resolve(process.cwd(), stateArgument);
  const state = await readValidatedState(stateFile);
  if (state.current.recovery)
    fail(
      "RECOVERY_ALREADY_ACTIVE",
      "/current/recovery",
      state.current.recovery.recoveryId,
    );
  const { catalog, validate } = await loadCatalogAndValidator();
  const module = readyById(catalog).get(moduleId);
  const required = module?.requiredChecks.find(
    (check) => check.checkId === checkId,
  );
  if (!module || !module.activityIds.includes(activityId) || !required)
    fail(
      "RECOVERY_CATALOG_MISMATCH",
      "/argv",
      `${moduleId}/${activityId}/${checkId}`,
    );
  const repositoryRoot = repositoryRootForState(stateFile);
  const target = recoveryTarget(repositoryRoot, targetArgument);
  await access(target.absolute);
  const now = transitionTime(state);
  const recoveryId = `recovery-${now.getTime()}-${randomUUID().toLowerCase()}`;
  const reference = `.patchquest/recovery/${recoveryId}.original`;
  const backup = path.join(repositoryRoot, reference);
  await mkdir(path.dirname(backup), { recursive: true });
  const preExerciseFingerprint = await guardedPrepareRecoveryTarget(
    target.absolute,
    backup,
  );
  const recovery: RecoveryRecord = {
    recoveryId,
    sessionId: state.current.sessionId,
    moduleId,
    activityId,
    target: target.relative,
    preExerciseReference: reference,
    preExerciseFingerprint,
    deliberateMutation:
      "Add one bounded forbidden import and observe the catalogued gate fail.",
    expectedFailingCheckId: checkId,
    expectedFailingCommand: required.command,
    expectedFailureCheckRunId: null,
    restorationCheckRunId: null,
    restorationAction:
      "Restore only the prepared target copy and rerun the same catalogued gate.",
    restoredFingerprint: null,
    status: "pending",
    recordedAt: now.toISOString(),
    recoveredAt: null,
  };
  const next = structuredClone(state);
  next.current = {
    sessionId: state.current.sessionId,
    moduleId,
    activityId,
    status: "blocked",
    loopPhase: "recover",
    supportLevel: "faded",
    pendingAction: {
      owner: "learner",
      action: `Make only the bounded mutation in ${target.relative}, then run learning:check for ${checkId}.`,
    },
    recovery,
  };
  next.recoveryHistory.push({
    ...recovery,
    eventId: `recovery-event-pending-${now.getTime()}-${randomUUID().toLowerCase()}`,
  });
  next.lastSessionAt = now.toISOString();
  const checkpointed = appendCheckpoint(
    next,
    `Prepared guarded recovery for ${target.relative}.`,
    now,
  );
  const validated = validateState(validate, checkpointed, stateFile);
  verifyStateSemantics(validated, catalog);
  await backupLearningState(stateFile);
  await atomicWriteFile(stateFile, `${JSON.stringify(validated, null, 2)}\n`);
  await repairLearningLogNonBlocking(
    validated,
    path.join(path.dirname(stateFile), "learning-log.md"),
  );
  console.log(`learning recovery prepared: ${recoveryId} ${target.relative}`);
}

async function restoreRecoveryLocalState(stateArgument: string): Promise<void> {
  const stateFile = path.resolve(process.cwd(), stateArgument);
  let state = await readValidatedState(stateFile);
  let recovery = state.current.recovery;
  if (
    !recovery ||
    !["pending", "bytes_restored_recheck_pending"].includes(recovery.status)
  )
    fail(
      "RECOVERY_NOT_PENDING",
      "/current/recovery",
      "prepare a guarded recovery first",
    );
  const repositoryRoot = repositoryRootForState(stateFile);
  const target = recoveryTarget(repositoryRoot, recovery.target);
  const reference = recoveryTarget(
    repositoryRoot,
    recovery.preExerciseReference,
    true,
  );
  if (recovery.status === "pending") {
    const pendingRecovery = recovery;
    const failure = [...state.checks]
      .reverse()
      .find(
        (check) =>
          check.checkId === pendingRecovery.expectedFailingCheckId &&
          check.moduleId === pendingRecovery.moduleId &&
          check.outcome === "failed" &&
          new Date(check.recordedAt).getTime() >=
            new Date(pendingRecovery.recordedAt).getTime(),
      );
    if (!failure)
      fail(
        "RECOVERY_EXPECTED_FAILURE_MISSING",
        "/checks",
        recovery.expectedFailingCheckId,
      );
    const restored = await guardedRestoreRecoveryTarget(
      target.absolute,
      reference.absolute,
      recovery.preExerciseFingerprint,
      true,
    );
    if (
      process.env["NODE_ENV"] === "test" &&
      process.env["PATCHQUEST_TEST_FAIL_RECOVERY_AFTER_BYTES"] === "1"
    )
      fail(
        "RECOVERY_BYTES_PERSIST_INJECTED",
        "/recoveryHistory",
        "injected crash after exact byte restoration and before intermediate persistence",
      );
    const { catalog, validate } = await loadCatalogAndValidator();
    const now = transitionTime(state);
    const intermediate: RecoveryRecord = {
      ...recovery,
      sessionId: state.current.sessionId,
      expectedFailureCheckRunId: failure.checkRunId,
      restorationCheckRunId: null,
      restoredFingerprint: restored.restoredFingerprint,
      status: "bytes_restored_recheck_pending",
      recordedAt: now.toISOString(),
      recoveredAt: null,
    };
    const next = structuredClone(state);
    next.current = {
      ...next.current,
      status: "blocked",
      loopPhase: "recover",
      pendingAction: {
        owner: "learner",
        action: `Rerun ${recovery.expectedFailingCheckId}; the exact target bytes are already restored.`,
      },
      recovery: intermediate,
    };
    next.recoveryHistory.push({
      ...intermediate,
      eventId: `recovery-event-bytes-restored-${now.getTime()}-${randomUUID().toLowerCase()}`,
    });
    next.lastSessionAt = now.toISOString();
    const checkpointed = appendCheckpoint(
      next,
      `Persisted exact byte restoration for ${recovery.target} before recheck.`,
      now,
    );
    const validated = validateState(validate, checkpointed, stateFile);
    verifyStateSemantics(validated, catalog);
    await backupLearningState(stateFile);
    await atomicWriteFile(stateFile, `${JSON.stringify(validated, null, 2)}\n`);
    await repairLearningLogNonBlocking(
      validated,
      path.join(path.dirname(stateFile), "learning-log.md"),
    );
    state = validated;
    recovery = intermediate;
  } else {
    if (
      (await fileSha256(reference.absolute)) !== recovery.preExerciseFingerprint
    )
      fail(
        "RECOVERY_BACKUP_MISMATCH",
        reference.absolute,
        "the prepared recovery copy no longer matches its fingerprint",
      );
    if ((await fileSha256(target.absolute)) !== recovery.restoredFingerprint)
      fail(
        "RECOVERY_RESTORED_BYTES_CHANGED",
        target.absolute,
        "the restored target changed while its passing recheck was pending",
      );
  }

  let passing = [...state.checks]
    .reverse()
    .find(
      (check) =>
        check.checkId === recovery.expectedFailingCheckId &&
        check.moduleId === recovery.moduleId &&
        check.outcome === "passed" &&
        new Date(check.recordedAt).getTime() >=
          new Date(recovery.recordedAt).getTime(),
    );
  if (!passing)
    passing = await runLearningCheck(
      stateFile,
      recovery.moduleId,
      recovery.expectedFailingCheckId,
    );
  if (passing.outcome !== "passed")
    fail("RECOVERY_RECHECK_NOT_PASSING", "/checks", passing.checkRunId);
  if (
    process.env["NODE_ENV"] === "test" &&
    process.env["PATCHQUEST_TEST_FAIL_RECOVERY_AFTER_PASS"] === "1"
  )
    fail(
      "RECOVERY_FINALIZE_INJECTED",
      "/recoveryHistory",
      "injected crash after passing recheck and before final recovery commit",
    );
  state = await readValidatedState(stateFile);
  const { catalog, validate } = await loadCatalogAndValidator();
  const module = readyById(catalog).get(recovery.moduleId)!;
  const now = transitionTime(state);
  const next = structuredClone(state);
  next.recoveryHistory.push({
    ...recovery,
    eventId: `recovery-event-restored-${now.getTime()}-${randomUUID().toLowerCase()}`,
    sessionId: next.current.sessionId,
    restorationCheckRunId: passing.checkRunId,
    status: "restored",
    recordedAt: now.toISOString(),
    recoveredAt: now.toISOString(),
  });
  const remainingCheck = module.requiredChecks.find(
    (required) =>
      !next.checks.some(
        (check) =>
          check.checkId === required.checkId &&
          check.sessionId === next.current.sessionId &&
          check.outcome === "passed" &&
          check.recordedAt >= passing.recordedAt,
      ),
  );
  next.current = {
    sessionId: next.current.sessionId,
    moduleId: recovery.moduleId,
    activityId: remainingCheck?.activityId ?? module.masteryPromptIds[0]!,
    status: "learning",
    loopPhase: remainingCheck ? "prove" : "retrieve",
    supportLevel: "independent",
    pendingAction: {
      owner: "learner",
      action: remainingCheck
        ? `Run learning:check for ${remainingCheck.checkId}, then complete final mastery retrieval.`
        : `Complete source-closed mastery retrieval ${module.masteryPromptIds[0]}.`,
    },
    recovery: null,
  };
  next.lastSessionAt = now.toISOString();
  const checkpointed = appendCheckpoint(
    next,
    `Restored ${recovery.target} and linked failure/pass check evidence.`,
    now,
  );
  const validated = validateState(validate, checkpointed, stateFile);
  verifyStateSemantics(validated, catalog);
  await backupLearningState(stateFile);
  await atomicWriteFile(stateFile, `${JSON.stringify(validated, null, 2)}\n`);
  await repairLearningLogNonBlocking(
    validated,
    path.join(path.dirname(stateFile), "learning-log.md"),
  );
  console.log(
    `learning recovery restored: ${recovery.recoveryId} ${recovery.restoredFingerprint}`,
  );
}

function requireAppendOnlyPrefix<T>(
  prior: T[],
  proposed: T[],
  integrityPath: string,
): void {
  if (
    proposed.length < prior.length ||
    prior.some((item, index) => !jsonEqual(item, proposed[index]))
  )
    fail(
      "DRAFT_HISTORY_REWRITE",
      integrityPath,
      "existing evidence records must remain an exact prefix",
    );
}

function verifyDraftTransition(
  state: LearningState,
  draft: LearningState,
): void {
  if (!jsonEqual(draft.sessions, state.sessions))
    fail(
      "DRAFT_SESSION_MUTATION",
      "/sessions",
      "only learning:resume may change session history",
    );
  if (
    draft.lastSessionId !== state.lastSessionId ||
    draft.lastSessionAt !== state.lastSessionAt
  )
    fail(
      "DRAFT_CLOCK_MUTATION",
      "/lastSessionAt",
      "the checkpoint command owns session timestamps",
    );
  if (!jsonEqual(draft.checks, state.checks))
    fail(
      "DRAFT_CHECK_MUTATION",
      "/checks",
      "only learning:check may append check evidence",
    );
  if (!jsonEqual(draft.checkpoints, state.checkpoints))
    fail(
      "DRAFT_CHECKPOINT_MUTATION",
      "/checkpoints",
      "the checkpoint command owns the digest chain",
    );

  requireAppendOnlyPrefix(
    state.completedModules,
    draft.completedModules,
    "/completedModules",
  );
  requireAppendOnlyPrefix(
    state.completedActivities,
    draft.completedActivities,
    "/completedActivities",
  );
  requireAppendOnlyPrefix(state.revisions, draft.revisions, "/revisions");
  requireAppendOnlyPrefix(
    state.reviewHistory,
    draft.reviewHistory,
    "/reviewHistory",
  );
  requireAppendOnlyPrefix(
    state.recoveryHistory,
    draft.recoveryHistory,
    "/recoveryHistory",
  );

  if (draft.retrievalAttempts.length < state.retrievalAttempts.length)
    fail(
      "DRAFT_HISTORY_REWRITE",
      "/retrievalAttempts",
      "existing attempts cannot be removed",
    );
  state.retrievalAttempts.forEach((attempt, index) => {
    const proposed = draft.retrievalAttempts[index];
    if (jsonEqual(attempt, proposed)) return;
    if (
      attempt.status === "awaiting_revision" &&
      proposed?.status === "evaluated" &&
      jsonEqual({ ...attempt, status: "evaluated" }, proposed)
    )
      return;
    fail(
      "DRAFT_ATTEMPT_REWRITE",
      `/retrievalAttempts/${index}`,
      "only awaiting_revision may transition to evaluated",
    );
  });
}

async function checkpointLocalState(
  stateArgument: string,
  draftArgument: string,
  reason: string,
): Promise<void> {
  const stateFile = path.resolve(process.cwd(), stateArgument);
  const draftFile = path.resolve(process.cwd(), draftArgument);
  if (stateFile === draftFile)
    fail(
      "CHECKPOINT_DRAFT_REQUIRED",
      draftFile,
      "write proposed changes to a separate draft file",
    );
  const state = await readValidatedState(stateFile);
  const value = await readJson(draftFile);
  const { catalog, validate } = await loadCatalogAndValidator();
  const draft = validateState(validate, value, draftFile);
  verifyDraftTransition(state, draft);
  const now = transitionTime(state);
  draft.lastSessionAt = now.toISOString();
  const next = appendCheckpoint(draft, reason, now);
  verifyStateSemantics(next, catalog);
  await backupLearningState(stateFile);
  await atomicWriteFile(stateFile, `${JSON.stringify(next, null, 2)}\n`);
  await rm(draftFile, { force: true });
  await repairLearningLogNonBlocking(
    next,
    path.join(path.dirname(stateFile), "learning-log.md"),
  );
  console.log(`learning checkpoint: ${next.checkpoints.at(-1)!.checkpointId}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "protocol";
  if (mode === "protocol") await verifyProtocol();
  else if (mode === "state" && process.argv[3])
    await verifyLocalState(process.argv[3]);
  else if (mode === "backup" && process.argv[3]) {
    const outputs = await backupLearningState(process.argv[3]);
    console.log(`learning backup: ${outputs.join(", ")}`);
  } else if (mode === "init") {
    const result = await initializeLearningState(process.argv[3] ?? root);
    console.log(
      `learning init: ${result.created ? "created" : "already valid"} ${path.dirname(result.stateFile)}`,
    );
  } else if (mode === "log" && process.argv[3])
    await updateLocalLog(process.argv[3], process.argv[4]);
  else if (mode === "resume" && process.argv[3])
    await resumeLocalState(process.argv[3]);
  else if (
    mode === "checkpoint" &&
    process.argv[3] &&
    process.argv[4] &&
    process.argv[5]
  )
    await checkpointLocalState(
      process.argv[3],
      process.argv[4],
      process.argv.slice(5).join(" "),
    );
  else if (
    mode === "check" &&
    process.argv[3] &&
    process.argv[4] &&
    process.argv[5]
  ) {
    const check = await runLearningCheck(
      process.argv[3],
      process.argv[4],
      process.argv[5],
    );
    console.log(
      `learning check: ${check.checkRunId} ${check.outcome} ${check.repositoryRevision} ${check.gateDigest}`,
    );
    if (check.outcome !== "passed")
      fail("CHECK_FAILED", "/outcome", check.checkRunId);
  } else if (
    mode === "recovery-prepare" &&
    process.argv[3] &&
    process.argv[4] &&
    process.argv[5] &&
    process.argv[6] &&
    process.argv[7]
  ) {
    await prepareRecoveryLocalState(
      process.argv[3],
      process.argv[4],
      process.argv[5],
      process.argv[6],
      process.argv[7],
    );
  } else if (mode === "recovery-restore" && process.argv[3]) {
    await restoreRecoveryLocalState(process.argv[3]);
  } else
    fail(
      "CLI_USAGE",
      "/argv",
      "protocol | state <state> | backup <state> | init [repo] | log <state> [view] | resume <state> | checkpoint <state> <draft> <reason> | check <state> <module> <check> | recovery-prepare <state> <target> <module> <activity> <check> | recovery-restore <state>",
    );
}
