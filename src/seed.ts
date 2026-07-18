import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

const [requestedId, ...titleParts] = Bun.argv.slice(2);

if (!requestedId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedId)) {
  console.error("Usage: bun run seed -- <course-id> [course title]");
  console.error("Course IDs use lowercase letters, numbers, and hyphens.");
  process.exit(1);
}

const directory = resolve(process.env.LEARNDECK_COURSES_DIR ?? process.env.PATCHQUEST_COURSES_DIR ?? `${import.meta.dir}/../courses`);
const target = resolve(directory, requestedId);
if (basename(target) !== requestedId) throw new Error("Course IDs must resolve to a folder inside the courses directory.");
if (existsSync(target)) throw new Error(`A course seed already exists at ${target}. Choose another ID or edit that course pack.`);

const title = titleParts.join(" ").trim() || humanize(requestedId);
const template = await Bun.file(`${import.meta.dir}/../templates/course.md`).text();
const module = await Bun.file(`${import.meta.dir}/../templates/module.md`).text();

await mkdir(`${target}/modules`, { recursive: true });
await Bun.write(`${target}/course.md`, template.replaceAll("{{courseId}}", requestedId).replaceAll("{{courseTitle}}", title));
await Bun.write(`${target}/modules/00-orient.md`, module);
console.info(`Seeded ${target}`);
console.info("Edit course.md and modules/*.md, add Markdown sources, then restart the UI and MCP server so they load the new course.");

function humanize(value: string) {
  return value.split("-").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}
