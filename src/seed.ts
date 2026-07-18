import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { CourseDefinition } from "./types";

const [requestedId, ...titleParts] = Bun.argv.slice(2);

if (!requestedId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedId)) {
  console.error("Usage: bun run seed -- <course-id> [course title]");
  console.error("Course IDs use lowercase letters, numbers, and hyphens.");
  process.exit(1);
}

const directory = resolve(process.env.PATCHQUEST_COURSES_DIR ?? `${import.meta.dir}/../courses`);
const target = resolve(directory, `${requestedId}.json`);
if (basename(target) !== `${requestedId}.json`) throw new Error("Course IDs must resolve to a file inside the courses directory.");
if (existsSync(target)) throw new Error(`A course seed already exists at ${target}. Choose another ID or edit that manifest.`);

const seed = (await Bun.file(`${import.meta.dir}/../templates/course.json`).json()) as CourseDefinition;
seed.id = requestedId;
seed.title = titleParts.join(" ").trim() || humanize(requestedId);
seed.description = `A PatchQuest course seeded from ${requestedId}. Replace this description before sharing it.`;

await mkdir(directory, { recursive: true });
await Bun.write(target, `${JSON.stringify(seed, null, 2)}\n`);
console.info(`Seeded ${target}`);
console.info("Edit the manifest, add its evidence sources, then restart the UI and MCP server so they load the new course.");

function humanize(value: string) {
  return value.split("-").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}
