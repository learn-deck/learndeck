# Seeded courses

PatchQuest loads every `*.json` manifest in this directory. Each manifest is an
independent course that shares the same local UI, SQLite progress store, and
MCP server.

`ddd-backend-foundations.json` is an example seed. Create another with:

```sh
bun run seed -- <course-id> "Course title"
```

Then add the course's own source material and point its section `sources` and
question `reference` fields at that material. Restart the UI and MCP server
after adding a manifest.
