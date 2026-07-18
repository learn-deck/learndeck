import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CourseCatalog } from "../src/course";

test("seeds standalone Markdown course packs that the catalog can load together", async () => {
  const directory = mkdtempSync(join(tmpdir(), "patchquest-seed-"));
  try {
    await seed(directory, "testing-fundamentals", "Testing Fundamentals");
    await seed(directory, "systems-thinking", "Systems Thinking");
    expect((await CourseCatalog.load(directory)).list().map((course) => course.id)).toEqual(["systems-thinking", "testing-fundamentals"]);
    const course = (await CourseCatalog.load(directory)).get("testing-fundamentals");
    expect(course.title).toBe("Testing Fundamentals");
    expect(course.sections).toHaveLength(1);
    expect(course.sections[0].sources).toEqual(["./00-orient.md"]);
    expect(course.sections[0].content).toContain("Orient the learner");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects course modules that point local sources at non-Markdown files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "learndeck-invalid-pack-"));
  try {
    const pack = join(directory, "invalid");
    mkdirSync(join(pack, "modules"), { recursive: true });
    writeFileSync(join(pack, "course.md"), `---\nschemaVersion: 1\nid: invalid\ntitle: Invalid\ndescription: Invalid source test.\noverview:\n  duration: 10 minutes\n  sessionLength: 10 minutes\n  level: Beginner\n  outcomes:\n    - Test validation\n  prerequisites:\n    - A workspace\npaths:\n  - id: default\n    label: Default\n---\n# Invalid\n`);
    writeFileSync(join(pack, "modules", "00-invalid.md"), `---\nid: invalid\ntitle: Invalid\ngoal: Demonstrate validation.\naction: Do nothing.\nsources:\n  - ./notes.txt\nquestions:\n  - id: invalid-question\n    kind: diagnostic\n    prompt: Why is this invalid?\n    reference: ./notes.txt\n    rubric:\n      - Names the invalid source.\n---\n# Invalid\n`);
    writeFileSync(join(pack, "modules", "notes.txt"), "Not Markdown\n");
    expect(CourseCatalog.load(directory)).rejects.toThrow("local course sources must be Markdown files");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("requires an author-written rubric for every course question", async () => {
  const directory = mkdtempSync(join(tmpdir(), "learndeck-missing-rubric-"));
  try {
    const pack = join(directory, "missing-rubric");
    mkdirSync(join(pack, "modules"), { recursive: true });
    writeFileSync(join(pack, "course.md"), `---\nschemaVersion: 1\nid: missing-rubric\ntitle: Missing rubric\ndescription: Question validation test.\noverview:\n  duration: 10 minutes\n  sessionLength: 10 minutes\n  level: Beginner\n  outcomes:\n    - Test validation\n  prerequisites:\n    - A workspace\npaths:\n  - id: default\n    label: Default\n---\n# Missing rubric\n`);
    writeFileSync(join(pack, "modules", "00-orient.md"), `---\nid: orient\ntitle: Orient\ngoal: Demonstrate question validation.\naction: Read this Markdown.\nsources:\n  - ./00-orient.md\nquestions:\n  - id: orient-question\n    kind: diagnostic\n    prompt: What is missing?\n    reference: ./00-orient.md\n---\n# Orient\n`);
    expect(CourseCatalog.load(directory)).rejects.toThrow("needs a non-empty rubric list");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loads a public GitHub Markdown course repository and falls back to its complete local cache", async () => {
  const directory = mkdtempSync(join(tmpdir(), "learndeck-public-courses-"));
  const previousRepository = process.env.LEARNDECK_COURSE_REPOSITORY;
  const previousCache = process.env.LEARNDECK_COURSE_CACHE_DIR;
  const fetchBeforeTest = globalThis.fetch;
  const files: Record<string, string> = {
    "courses/remote-foundations/course.md": "---\nschemaVersion: 1\nid: remote-foundations\ntitle: Remote Foundations\ndescription: A public Markdown course.\ncategory: Engineering\ntags: []\noverview:\n  duration: 20 minutes\n  sessionLength: 20 minutes\n  level: Beginner\n  outcomes:\n    - Load a public course.\n  prerequisites:\n    - Curiosity.\npaths:\n  - id: default\n    label: Node.js\n---\n# Remote Foundations\n",
    "courses/remote-foundations/modules/00-orient.md": "---\nid: orient\ntitle: Orient\ngoal: See one public module.\naction: Read this Markdown.\nsources:\n  - ./00-orient.md\nquestions:\n  - id: orient-question\n    kind: diagnostic\n    prompt: What did you load?\n    reference: ./00-orient.md\n    rubric:\n      - Names the loaded course module.\n---\n# Orient\n",
    "references/remote-note.md": "# Remote note\n",
  };
  try {
    process.env.LEARNDECK_COURSE_REPOSITORY = "github:learndeck/courses@main";
    process.env.LEARNDECK_COURSE_CACHE_DIR = directory;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        return Response.json({ tree: [
          ...Object.keys(files).map((path) => ({ path, type: "blob" })),
          { path: "package.json", type: "blob" },
        ] });
      }
      const path = Object.keys(files).find((candidate) => url.endsWith(`/${candidate}`));
      return path ? new Response(files[path]) : new Response("not found", { status: 404 });
    };
    const publicCatalog = await CourseCatalog.loadConfigured();
    expect(publicCatalog.get("remote-foundations").category).toBe("Engineering");
    expect(existsSync(join(directory, "learndeck-courses-main", "courses", "remote-foundations", "course.md"))).toBe(true);

    globalThis.fetch = async () => new Response("offline", { status: 503 });
    expect((await CourseCatalog.loadConfigured()).get("remote-foundations").title).toBe("Remote Foundations");
  } finally {
    globalThis.fetch = fetchBeforeTest;
    if (previousRepository === undefined) delete process.env.LEARNDECK_COURSE_REPOSITORY;
    else process.env.LEARNDECK_COURSE_REPOSITORY = previousRepository;
    if (previousCache === undefined) delete process.env.LEARNDECK_COURSE_CACHE_DIR;
    else process.env.LEARNDECK_COURSE_CACHE_DIR = previousCache;
    rmSync(directory, { recursive: true, force: true });
  }
});

async function seed(directory: string, id: string, title: string) {
  const runner = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/seed.ts"), id, title], {
    cwd: resolve(import.meta.dir, ".."),
    env: { ...process.env, LEARNDECK_COURSES_DIR: directory },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await runner.exited).toBe(0);
}
