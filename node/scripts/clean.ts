import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const nodeRoot = path.resolve(import.meta.dirname, "..");

for (const area of ["apps", "packages"]) {
  const entries = await readdir(path.join(nodeRoot, area), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await rm(path.join(nodeRoot, area, entry.name, "dist"), {
      force: true,
      recursive: true,
    });
  }
}

await rm(path.join(nodeRoot, ".tsbuildinfo"), { force: true });
await rm(path.join(nodeRoot, "coverage"), { force: true, recursive: true });
