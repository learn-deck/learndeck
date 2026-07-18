# Course versioning (design proposal)

Status: proposal — not yet implemented. This document designs how course packs
gain versions, changelogs learners can act on, and per-course pinning, grounded
in the current `src/course.ts`, `src/store.ts`, and the GitHub sync described in
[public course distribution](public-course-distribution.md).

## 1. Versioning scheme

### Current code constraints

`src/course.ts` currently treats `schemaVersion` as the parser/schema version:
`loadCoursePack()` reads it from `course.md`, and `validateCourse()` only
accepts `schemaVersion: 1`. It is not a content version and should not be
repurposed.

A course is currently loaded from:

- `course.md`
- all sorted `modules/*.md` files
- local Markdown files referenced by module `sources` or question `reference` fields

Module filenames determine learning order, while module frontmatter `id`
becomes `CourseSection.id`. The authoring guide already requires stable module
and question IDs.

### Proposed release version

Add a required author-facing field named `contentVersion` to `course.md`:

```yaml
schemaVersion: 1
contentVersion: 1.2.0
id: testing-fundamentals
```

Use Semantic Versioning:

- `PATCH`: typo fixes, clarifications, corrected links, or non-semantic prose changes.
- `MINOR`: new modules, new examples, new review questions, or additive material that preserves existing module/question meaning.
- `MAJOR`: changed learning outcomes, changed exit criteria, removed material, module splits/merges, or other incompatible restructuring.

`contentVersion` describes one coherent release of the entire learning pack,
not an individual Markdown file. It covers `course.md`, all modules, their
questions/rubrics, and local Markdown references that affect the course. A
shared file under `references/` may affect multiple courses; authors must bump
and document every affected course.

The existing `schemaVersion` remains a separate parser-format number. A parser
change may require `schemaVersion: 2` without representing a new learning
release.

For backwards compatibility, an initial implementation may treat missing
`contentVersion` as a legacy `0.0.0` release and expose a warning. New or
published packs should require the field. `templates/course.md` should generate
`contentVersion: 1.0.0`.

### Git ref and content identity

The configured source remains a moving ref such as:

```sh
LEARNDECK_COURSE_REPOSITORY=github:learn-deck/courses@main
```

That ref is appropriate for following updates but is not sufficient for
pinning. `CourseCatalog.loadConfigured()` currently caches by owner,
repository, and branch, and records only `syncedAt` in its metadata.

Add two machine identities:

1. Resolve the configured GitHub branch/tag to an immutable commit SHA.
2. Compute a deterministic SHA-256 content hash over the course's relevant Markdown files.

The learner-facing identity is `contentVersion`; the commit SHA and content
hash provide reproducibility and detect an author changing content without
bumping the version.

Git tags may be supported as friendly aliases, but the stored pin must be the
resolved commit SHA. A branch name such as `main` must never be stored as the
immutable pin.

External `https` references remain outside the guarantee of a Markdown release
because their contents can change independently. The authoring guide already
recommends local source snapshots for material likely to change.

## 2. Changelog

### Author format

Add `courses/<course-id>/CHANGELOG.md`. This remains compatible with the public
repository contract because `src/course.ts` already syncs every `.md` file
under `courses/` and `references/`.

Use Markdown with machine-readable YAML frontmatter:

```md
---
formatVersion: 1
entries:
  - version: 1.2.0
    released: 2026-07-18
    severity: new-material
    summary: Added a practical boundary-mapping exercise.
    moduleIds:
      - model-boundary
    questionIds: []
    learnerAction: reread
  - version: 1.1.1
    released: 2026-06-30
    severity: content-fix
    summary: Corrected the example transaction boundary.
    moduleIds:
      - transactions
    questionIds: []
    learnerAction: skim
---

# Changelog

Human-readable release notes may follow.
```

Proposed fields:

- `version`: must match a `contentVersion` release.
- `released`: ISO date.
- `severity`: one of `content-fix`, `new-material`, `rubric-change`, `breaking-restructure`.
- `summary`: concise learner-facing explanation.
- `moduleIds`: values matching module frontmatter `id`, which becomes `CourseSection.id`.
- `questionIds`: values matching question frontmatter IDs.
- `learnerAction`: `none`, `skim`, `reread`, or `redo`.

The loader should validate that affected IDs exist in the new release, except
for IDs explicitly listed in a restructuring migration.

### Severity semantics

| Severity | Typical version impact | Default learner interpretation |
| --- | --- | --- |
| `content-fix` | Patch | Usually skim; existing completion remains valid. |
| `new-material` | Minor | Read the affected module if it is relevant or not yet studied. |
| `rubric-change` | Minor or major | Revisit the affected question or module; completion may need review. |
| `breaking-restructure` | Major | Treat as a migration; do not silently carry completion forward. |

Authors should use `rubric-change` when a prompt, reference, or rubric changes
the evidence expected from the learner. This matters because
`question_attempts` stores the question ID, answer, result, feedback, and
reference, but does not currently store a content version.

### Learner presentation

Add a course-update summary to the course and path views:

- "Updated from v1.0.0 to v1.2.0."
- Number of changes by severity.
- Short summaries grouped by affected module.
- Explicit actions such as "skim," "reread," or "redo."
- Prominent warnings for `rubric-change` and `breaking-restructure`.
- A separate "new module" indicator for modules with no prior `section_progress` row.

The current `section_progress.updated_at` timestamp is not sufficient to answer
"which content version did this learner study?" because it is updated by
answers and evidence writes.

Add a proposed nullable column:

```sql
ALTER TABLE section_progress
ADD COLUMN last_studied_version TEXT;
```

For the first useful implementation, update it when the learner submits an
answer or records evidence for that section. Those operations already exist in
`CourseStore.submitAnswer()`, `recordEvidence()`, and
`recordLearnerEvidence()`. A later version can add an explicit "mark as
reviewed" event.

The app compares each section's `last_studied_version` with the current
`contentVersion` and displays only changelog entries after that version. A
changelog entry without affected IDs applies to the whole course.

If the content hash changes but `contentVersion` does not, show an "unreleased
content change" warning rather than silently claiming that nothing changed.

## 3. Pinning

### Storage model

Add a new SQLite table in `CourseStore.migrate()`:

```sql
CREATE TABLE IF NOT EXISTS course_pins (
  course_id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  requested_ref TEXT NOT NULL,
  resolved_commit TEXT NOT NULL,
  content_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

This is a new table; the existing database currently contains
`learning_paths`, `section_progress`, `question_attempts`, `activity_log`, and
`evidence`.

The pin is course-level rather than path-level. That matches the current
`CourseCatalog` shape: it holds one `CourseDefinition` per course ID in a `Map`
and resolves paths with `catalog.get(courseId)`. All learning paths for a
course therefore see the same selected release.

The stored `resolved_commit`, not `requested_ref`, is authoritative. For
example:

```text
requested_ref: main
resolved_commit: 6c8f...a91
content_version: 1.2.0
```

### Sync behavior

`CourseCatalog.loadConfigured()` should accept the active pins when
constructing the catalog. The current MCP startup creates the catalog before
the store, so startup order must change to open the store first, read pins,
and then load the catalog.

For an unpinned course:

- Sync the configured repository ref, normally `main`.
- Use the existing `.next` staging directory.
- Replace the cache only after the complete download succeeds.
- On failure, use the last complete branch cache, as currently documented and implemented.

For a pinned course:

- Download or load the exact `resolved_commit`.
- Cache it under a ref-specific directory, not the current branch-only cache directory.
- If the network fails, use the last complete cache for that exact commit.
- Never fall back from a pinned commit to `main`; that would violate the pin.

The cache metadata should be extended from the existing `{ syncedAt }` shape to
include the resolved commit, content version, and content hash.

### Learner workflow

Add new store operations, clearly distinct from existing methods:

- `pinCourse(courseId, currentOrSelectedRelease)`
- `getCoursePin(courseId)`
- `unpinCourse(courseId)`
- `listCourseChanges(courseId, pathId)`

The UI should support:

1. **Pin this version** — stores the currently loaded commit and version.
2. **Stay pinned** — leaves the existing row unchanged.
3. **Upgrade and keep pinned** — resolves the latest configured ref, shows its changelog, then replaces the pin with the new commit.
4. **Unpin and follow latest** — deletes the row; the next catalog load follows the configured branch.

Unpinning or upgrading must never delete answers, evidence, or section
progress. The existing `resetPath()` is explicitly destructive and deletes the
learning path and its dependent records; unpinning must not call it.

## 4. Impact on progress data

### Existing progress model

`createPath()` creates one `section_progress` row for every section in the
course at path creation time. Progress is keyed by `(path_id, section_id)`.

Attempts and evidence also retain `section_id` and question IDs, but are not
foreign-keyed to the current Markdown definition. `nextActivity()` matches
current sections to stored progress by section ID, while
`hasEvaluatedAttempt()` considers any correct attempt with the same question
ID.

This means an update cannot simply replace the Markdown directory. New
sections need progress rows, removed sections need historical treatment, and
changed question semantics must not accidentally inherit an old correct
answer.

### Compatibility rule

Authors must follow this rule:

> A module ID and question ID are permanent compatibility identifiers. Rename
> files, titles, or prose without changing IDs when the learning contract
> remains the same. Never reuse an old ID for different learning content.

The filename may change, but because filenames determine order, reordering
modules should be declared in the changelog. A module with the same
frontmatter `id` retains its progress even if its filename or title changes.

### Module changes

#### Rename or reorder

If the module ID remains stable:

- Keep the existing `section_progress` row.
- Keep all attempts and evidence attached to that ID.
- Reconcile the row into the new filename order.
- Show a changelog entry if the learner-facing sequence or material changed.

If the ID changes without an explicit migration, treat it as removal plus
addition rather than guessing that the records correspond.

#### Split or merge

A split or merge is a `breaking-restructure` and requires an explicit
changelog migration:

```yaml
migrations:
  - fromModuleId: domain-model
    toModuleIds:
      - entities
      - invariants
    policy: review
```

For a split, the safe default is:

- Preserve the old section, attempts, and evidence as historical.
- Create new `section_progress` rows for each target.
- Set targets to `revision`, even if the old module was `complete`.
- Do not duplicate old evidence into every target.

A learner may already understand the new material, but the app cannot infer
that safely from a previous module's completion.

For a merge, preserve the source records and create one target row with
`revision` unless an author supplies an explicit, reviewable migration rule.

#### Removal and fallback

Add proposed nullable archival columns:

```sql
ALTER TABLE section_progress ADD COLUMN orphaned_at TEXT;
ALTER TABLE section_progress ADD COLUMN orphaned_in_version TEXT;
```

When a section ID disappears:

- Do not delete its `section_progress` row.
- Mark it orphaned.
- Keep its attempts and evidence unchanged.
- Exclude it from current completion counts and `nextActivity()`.
- Expose it under "Retired modules" and include it in path exports.

`PathOverview.totalSections` currently uses the current course's section
count, while completed sections are counted from progress; filtering orphaned
rows prevents removed modules from inflating completion.

When a new section ID appears, insert a `not_started` row. If no migration map
exists, do not carry completion forward. This is the fallback for unsafe
renames, splits, merges, and removals.

For changed question semantics, add a proposed `content_version` column to
`question_attempts`:

```sql
ALTER TABLE question_attempts ADD COLUMN content_version TEXT;
```

New attempts record the active version. A `rubric-change` entry causes the
containing section to enter `revision` or display an explicit review
requirement; old answers remain historical rather than being overwritten.

## 5. Minimal implementation path

### V1 — smallest useful slice

| Rank | Deliverable | Rough effort | Existing files |
| --- | --- | ---: | --- |
| 1 | Add `contentVersion`, legacy fallback, and structured `CHANGELOG.md` parsing. | 1–2 days | `src/course.ts`, `src/types.ts`, `templates/course.md`, `src/seed.ts`, `docs/course-authoring.md` |
| 2 | Store `last_studied_version`, expose changed entries, and show severity/action summaries. | 2–3 days | `src/store.ts`, `src/server.ts`, `src/mcp.ts`, `public/app.js`, `public/index.html`, `public/app.css` |
| 3 | Resolve branch refs to commit SHAs and cache exact snapshots while preserving current cache fallback. | 2–4 days | `src/course.ts`, `src/types.ts`, `docs/public-course-distribution.md` |
| 4 | Add course-level pin/unpin/upgrade state in SQLite and make catalog loading honor it. | 2–3 days | `src/store.ts`, `src/server.ts`, `src/mcp.ts`, `public/app.js` |
| 5 | Reconcile current section IDs, add rows for new modules, and archive removed IDs without deleting history. | 1–2 days | `src/store.ts`, `src/types.ts` |

V1 should support pinning the current resolved commit and upgrading after
reviewing the changelog. It does not need GitHub tag browsing, rich diffs, or
automatic split/merge migration.

Tests should extend the existing focused suites:

- `test/course-pack.test.ts` for version and changelog validation.
- `test/provenance.test.ts` for commit-aware cache and fallback behavior.
- `test/store.test.ts` for pins, last-studied versions, and reconciliation.
- `test/server.test.ts` and `test/mcp.test.ts` for new operations.
- `test/seed.test.ts` for the generated `contentVersion`.

### V2 — explicit migrations and release selection

Add:

- Changelog migration maps for module splits, merges, and removals.
- Automatic conversion of mapped progress into `revision`.
- Version-scoped attempt evaluation.
- Per-module "reviewed" acknowledgements instead of relying only on answer/evidence writes.
- Selection of historical releases by semver or Git tag.
- "Upgrade and keep pinned" against a selected release.
- Version and pin information in `exportPath()` output, which currently exports course identity, path, progress, attempts, and evidence.

Primary files remain `src/course.ts`, `src/store.ts`, `src/types.ts`,
`src/server.ts`, `src/mcp.ts`, the public UI, and their tests.

### Later

Consider:

- Markdown diffs between two commits.
- Per-file and per-reference impact analysis.
- Shared-reference dependency tracking across courses.
- Content hashes for external HTTPS references.
- Multiple simultaneous pinned releases for separate learning paths.
- Authoring-time verification that every content version has a matching changelog entry and migration data.
- A release browser that lists available course tags without requiring learners to know Git terminology.
