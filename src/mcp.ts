import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CourseCatalog } from "./course";
import { CourseStore } from "./store";

const catalog = await CourseCatalog.load();
const store = new CourseStore();
const server = new McpServer({
  name: "patchquest",
  version: "0.3.0",
  instructions:
    "Use PatchQuest to guide a learner through a visible local course. List courses first, read progress before teaching, ask one question at a time, and only evaluate an answer after the learner submitted it in the UI. Never run learner code or start a server through this MCP.",
});

server.registerTool(
  "patchquest_list_courses",
  {
    title: "List PatchQuest courses",
    description: "List every locally seeded course available to the UI and MCP.",
    inputSchema: {},
  },
  async () => result(catalog.list()),
);

server.registerTool(
  "patchquest_get_course",
  {
    title: "Get a PatchQuest course",
    description: "Read one course's paths, ordered sections, actions, questions, and source references.",
    inputSchema: { courseId: z.string() },
  },
  async ({ courseId }) => call(() => catalog.get(courseId)),
);

server.registerTool(
  "patchquest_list_paths",
  {
    title: "List learning paths",
    description: "List the learner's local paths for one course.",
    inputSchema: { courseId: z.string() },
  },
  async ({ courseId }) => call(() => store.listPaths(catalog.get(courseId).id)),
);

server.registerTool(
  "patchquest_create_path",
  {
    title: "Create a learning path",
    description: "Create a local path after the learner has explicitly chosen its course path and workspace or learning context.",
    inputSchema: {
      courseId: z.string().describe("The selected course ID."),
      coursePathId: z.string().describe("One of the selected course's path IDs."),
      workspacePath: z.string().describe("The learner-confirmed absolute or relative workspace folder."),
      label: z.string().optional().describe("Optional human-readable path label."),
    },
  },
  async ({ courseId, ...input }) => call(() => store.createPath(catalog.get(courseId), input)),
);

server.registerTool(
  "patchquest_get_progress",
  {
    title: "Get learning progress",
    description: "Read all section states, answer submissions, feedback, and progress counts for one local path.",
    inputSchema: { pathId: z.string() },
  },
  async ({ pathId }) => call(() => store.overview(courseForPath(pathId), pathId)),
);

server.registerTool(
  "patchquest_get_next_activity",
  {
    title: "Get the next activity",
    description: "Return the one section and question that should be discussed next for a learning path.",
    inputSchema: { pathId: z.string() },
  },
  async ({ pathId }) => call(() => store.nextActivity(courseForPath(pathId), pathId)),
);

server.registerTool(
  "patchquest_record_evidence",
  {
    title: "Record learner evidence",
    description: "Record a learner-reported code path, command result, or other evidence for one section. Use only after the learner provides it.",
    inputSchema: {
      pathId: z.string(),
      sectionId: z.string(),
      evidence: z.string(),
      reviewQuestion: z.string().optional(),
    },
  },
  async (input) => call(() => store.recordEvidence(courseForPath(input.pathId), input)),
);

server.registerTool(
  "patchquest_evaluate_answer",
  {
    title: "Evaluate a submitted answer",
    description: "Evaluate exactly one learner-submitted UI answer. Feedback must name the target, observed answer, exact gap or confirmation, and a course reference.",
    inputSchema: {
      attemptId: z.number().int().positive(),
      result: z.enum(["correct", "partial", "incorrect"]),
      feedback: z.string().min(20).describe("Source-linked, actionable feedback for the learner."),
      evidence: z.string().optional().describe("Optional learner evidence that supports the section progress."),
      reviewQuestion: z.string().optional().describe("One related question to ask on a later session."),
    },
  },
  async (input) => call(() => store.evaluateAttempt(courseForAttempt(input.attemptId), input)),
);

function courseForPath(pathId: string) {
  return catalog.get(store.getPath(pathId).courseId);
}

function courseForAttempt(attemptId: number) {
  return courseForPath(store.getAttempt(attemptId).pathId);
}

function result(value: unknown) {
  const structuredContent = Array.isArray(value) ? { items: value } : value as Record<string, unknown>;
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent };
}

function call<T>(operation: () => T) {
  try {
    return result(operation());
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : "PatchQuest could not complete that operation." }],
      isError: true,
    };
  }
}

await server.connect(new StdioServerTransport());
