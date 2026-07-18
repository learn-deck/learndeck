import { CourseCatalog } from "./course";
import { CourseStore } from "./store";

const PUBLIC = `${import.meta.dir}/../public`;

export async function createApp(store = new CourseStore(), catalog?: CourseCatalog) {
  const courses = catalog ?? await CourseCatalog.load();

  return async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/courses" && request.method === "GET") return json(courses.list());
      const courseRoute = url.pathname.match(/^\/api\/courses\/([^/]+)$/);
      if (courseRoute && request.method === "GET") return json(courses.get(decodeURIComponent(courseRoute[1])));
      const coursePathsRoute = url.pathname.match(/^\/api\/courses\/([^/]+)\/paths$/);
      if (coursePathsRoute && request.method === "GET") {
        const course = courses.get(decodeURIComponent(coursePathsRoute[1]));
        return json(store.listPaths(course.id));
      }
      if (coursePathsRoute && request.method === "POST") {
        const course = courses.get(decodeURIComponent(coursePathsRoute[1]));
        const body = await request.json();
        return json(store.createPath(course, requireObject(body, ["coursePathId", "workspacePath"]) as { coursePathId: string; workspacePath: string; label?: string }), 201);
      }
      const overview = url.pathname.match(/^\/api\/paths\/([^/]+)\/overview$/);
      if (overview && request.method === "GET") {
        const pathId = decodeURIComponent(overview[1]);
        return json(store.overview(courseForPath(courses, store, pathId), pathId));
      }
      const next = url.pathname.match(/^\/api\/paths\/([^/]+)\/next$/);
      if (next && request.method === "GET") {
        const pathId = decodeURIComponent(next[1]);
        return json(store.nextActivity(courseForPath(courses, store, pathId), pathId));
      }
      if (url.pathname === "/api/attempts" && request.method === "POST") {
        const body = requireObject(await request.json(), ["pathId", "questionId", "answer"]);
        return json(store.submitAnswer(courseForPath(courses, store, body.pathId as string), body as { pathId: string; questionId: string; answer: string; confidence?: number }), 201);
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return asset("index.html", "text/html; charset=utf-8");
      if (url.pathname === "/app.js") return asset("app.js", "text/javascript; charset=utf-8");
      if (url.pathname === "/app.css") return asset("app.css", "text/css; charset=utf-8");
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      return json({ error: message }, 400);
    }
  };
}

function courseForPath(catalog: CourseCatalog, store: CourseStore, pathId: string) {
  return catalog.get(store.getPath(pathId).courseId);
}

function requireObject(value: unknown, required: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  const body = value as Record<string, unknown>;
  for (const key of required) {
    if (typeof body[key] !== "string" || !body[key].trim()) throw new Error(`A non-empty ${key} is required.`);
  }
  return body;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function asset(name: string, type: string) {
  return new Response(Bun.file(`${PUBLIC}/${name}`), { headers: { "content-type": type } });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3030);
  const store = new CourseStore();
  const fetch = await createApp(store);
  Bun.serve({ hostname: "127.0.0.1", port, fetch });
  console.info(`PatchQuest is ready at http://127.0.0.1:${port}`);
}
