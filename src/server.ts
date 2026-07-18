import { mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { CourseCatalog } from "./course";
import { IntegrationError, IntegrationService, isIntegrationId } from "./integrations";
import { CourseStore } from "./store";

const PUBLIC = process.env.LEARNDECK_PUBLIC_DIR ?? `${import.meta.dir}/../public`;

export async function createApp(store = new CourseStore(), catalog?: CourseCatalog, integrations = new IntegrationService()) {
  let resolvedCatalog = catalog;
  const getCatalog = async () => {
    resolvedCatalog ??= await CourseCatalog.loadConfigured();
    return resolvedCatalog;
  };

  return async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/bootstrap" && request.method === "POST") {
        const courses = await getCatalog();
        return json({ ready: true, courses: courses.list(), integrations: await integrations.list(), catalogue: courses.catalogue });
      }
      if (url.pathname === "/api/integrations" && request.method === "GET") return json(await integrations.list());
      // DELETE /api/integrations/:id/connect forgets only LearnDeck's own entry.
      const integrationRoute = url.pathname.match(/^\/api\/integrations\/([^/]+)\/connect$/);
      if (integrationRoute && (request.method === "POST" || request.method === "DELETE") && isIntegrationId(integrationRoute[1])) {
        try {
          if (request.method === "DELETE") return json(await integrations.disconnect(integrationRoute[1]));
          return json(await integrations.connect(integrationRoute[1]));
        } catch (error) {
          if (error instanceof IntegrationError) {
            return json({ error: error.message, integrationId: error.integrationId, configPath: error.configPath, userAction: error.userAction }, 409);
          }
          throw error;
        }
      }
      if (url.pathname === "/api/courses" && request.method === "GET") return json((await getCatalog()).list());
      const courseRoute = url.pathname.match(/^\/api\/courses\/([^/]+)$/);
      if (courseRoute && request.method === "GET") return json((await getCatalog()).get(decodeURIComponent(courseRoute[1])));
      const coursePathsRoute = url.pathname.match(/^\/api\/courses\/([^/]+)\/paths$/);
      if (coursePathsRoute && request.method === "GET") {
        const courses = await getCatalog();
        const course = courses.get(decodeURIComponent(coursePathsRoute[1]));
        return json(store.listPaths(course.id));
      }
      if (coursePathsRoute && request.method === "POST") {
        const courses = await getCatalog();
        const course = courses.get(decodeURIComponent(coursePathsRoute[1]));
        const body = await request.json();
        const input = requireObject(body, ["coursePathId", "workspacePath"]) as { coursePathId: string; workspacePath: string; label?: string };
        if (input.label !== undefined && typeof input.label !== "string") throw new Error("label must be a string when provided.");
        if (!course.paths.some((path) => path.id === input.coursePathId)) throw new Error(`Unknown course path: ${input.coursePathId}`);
        const workspacePath = input.workspacePath.trim();
        const workspaceCreated = await prepareWorkspace(workspacePath);
        const path = store.createPath(course, { ...input, workspacePath });
        return json({ ...path, workspaceCreated }, 201);
      }
      const pathExportRoute = url.pathname.match(/^\/api\/paths\/([^/]+)\/export$/);
      if (pathExportRoute && request.method === "GET") {
        const courses = await getCatalog();
        const pathId = decodeURIComponent(pathExportRoute[1]);
        const document = store.exportPath(courseForPath(courses, store, pathId), pathId);
        return json(document, 200, { "content-disposition": `attachment; filename="learndeck-${fileNamePart(pathId)}.json"` });
      }
      const pathEvidenceRoute = url.pathname.match(/^\/api\/paths\/([^/]+)\/evidence$/);
      if (pathEvidenceRoute && request.method === "POST") {
        const pathId = decodeURIComponent(pathEvidenceRoute[1]);
        const courses = await getCatalog();
        let course;
        try {
          course = courseForPath(courses, store, pathId);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : `Unknown learning path: ${pathId}` }, 404);
        }
        const body = requireObject(await request.json(), ["sectionId", "note"]);
        if ("ref" in body && body.ref !== undefined && typeof body.ref !== "string") {
          throw new Error("ref must be a string when provided.");
        }
        return json(store.recordLearnerEvidence(course, {
          pathId,
          sectionId: body.sectionId as string,
          note: body.note as string,
          ref: body.ref as string | undefined,
        }), 201);
      }
      const pathResetRoute = url.pathname.match(/^\/api\/paths\/([^/]+)$/);
      if (pathResetRoute && request.method === "DELETE") {
        return json(store.resetPath(decodeURIComponent(pathResetRoute[1])));
      }
      const overview = url.pathname.match(/^\/api\/paths\/([^/]+)\/overview$/);
      if (overview && request.method === "GET") {
        const courses = await getCatalog();
        const pathId = decodeURIComponent(overview[1]);
        return json(store.overview(courseForPath(courses, store, pathId), pathId));
      }
      const next = url.pathname.match(/^\/api\/paths\/([^/]+)\/next$/);
      if (next && request.method === "GET") {
        const courses = await getCatalog();
        const pathId = decodeURIComponent(next[1]);
        return json(store.nextActivity(courseForPath(courses, store, pathId), pathId));
      }
      const selfReviewRoute = url.pathname.match(/^\/api\/attempts\/([^/]+)\/self-review$/);
      if (selfReviewRoute && request.method === "POST") {
        const attemptId = Number(decodeURIComponent(selfReviewRoute[1]));
        if (!Number.isSafeInteger(attemptId) || attemptId <= 0) return json({ error: "A valid attempt ID is required." }, 400);
        try {
          const courses = await getCatalog();
          return json(store.selfReviewAttempt(courseForAttempt(courses, store, attemptId), attemptId));
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Only submitted answers may be self-reviewed." }, 409);
        }
      }
      if (url.pathname === "/api/attempts" && request.method === "POST") {
        const courses = await getCatalog();
        const body = requireObject(await request.json(), ["pathId", "questionId", "answer"]);
        return json(store.submitAnswer(courseForPath(courses, store, body.pathId as string), body as { pathId: string; questionId: string; answer: string; confidence?: number }), 201);
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return asset("index.html", "text/html; charset=utf-8");
      if (url.pathname === "/theme.css") return asset("theme.css", "text/css; charset=utf-8");
      if (url.pathname === "/app.js") return asset("app.js", "text/javascript; charset=utf-8");
      if (url.pathname === "/app.css") return asset("app.css", "text/css; charset=utf-8");
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      return json({ error: message }, 400);
    }
  };
}

async function prepareWorkspace(workspacePath: string): Promise<boolean> {
  if (!isAbsolute(workspacePath)) throw new Error(`workspacePath must be absolute: ${workspacePath}`);

  const parent = dirname(workspacePath);
  let parentExists = false;
  try {
    parentExists = (await stat(parent)).isDirectory();
  } catch {
    parentExists = false;
  }
  if (!parentExists) throw new Error(`workspacePath parent does not exist for ${workspacePath}: ${parent}`);

  try {
    await mkdir(workspacePath);
    return true;
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) {
      const detail = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Could not create workspacePath ${workspacePath}: ${detail}`);
    }
  }

  try {
    if ((await stat(workspacePath)).isDirectory()) return false;
  } catch {
    // Report the original workspace path below when the target disappeared or is inaccessible.
  }
  throw new Error(`workspacePath already exists but is not a directory: ${workspacePath}`);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error) && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

function courseForPath(catalog: CourseCatalog, store: CourseStore, pathId: string) {
  return catalog.get(store.getPath(pathId).courseId);
}

function courseForAttempt(catalog: CourseCatalog, store: CourseStore, attemptId: number) {
  return courseForPath(catalog, store, store.getAttempt(attemptId).pathId);
}

function requireObject(value: unknown, required: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  const body = value as Record<string, unknown>;
  for (const key of required) {
    if (typeof body[key] !== "string" || !body[key].trim()) throw new Error(`A non-empty ${key} is required.`);
  }
  return body;
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

function fileNamePart(pathId: string) {
  return pathId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function asset(name: string, type: string) {
  return new Response(Bun.file(`${PUBLIC}/${name}`), { headers: { "content-type": type, "cache-control": "no-store" } });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3030);
  const store = new CourseStore();
  const fetch = await createApp(store);
  Bun.serve({ hostname: "127.0.0.1", port, fetch });
  console.info(`LearnDeck is ready at http://127.0.0.1:${port}`);
}
