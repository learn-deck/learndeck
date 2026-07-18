---
name: learn-patchquest
description: Guide a learner through a visible, seeded PatchQuest course. Use when the learner asks to start, learn, review, or continue a PatchQuest path.
---

# Learn PatchQuest

PatchQuest has one shared local learning record: its browser UI and stdio MCP
server use the same SQLite database. The learner selects a seeded course and
path, then submits answers in the UI; use MCP to guide and evaluate those
visible submissions.

## Start or resume

1. Read `AGENTS.md`, `README.md`, and `docs/mcp.md`.
2. If the UI is not running, ask the learner to run `bun run app` and open the
   displayed local URL. Do not start it silently.
3. Ask the learner to use the UI's explicit Connect action for a supported host,
   or continue without an agent. Then use `patchquest_list_courses`; if the
   learner said only “Let's start,” ask them to choose a visible course, path,
   and workspace/context in the UI.
4. Use `patchquest_list_paths` with that course ID. If the learner has no path,
   let them create it in the UI or call `patchquest_create_path` only after they
   explicitly choose the course, path, and workspace/context.
5. For a coding course, run only the source-documented read-only dependency
   checks. Report present and missing requirements; never install dependencies.
   When the checks pass, suggest the matching development command for the
   learner to run themselves.
6. Use `patchquest_get_next_activity` for exactly one current section and
   question. Do not present a module menu.

## One learning turn

1. Read only the named source and the current section needed for this question.
2. Ask the learner to inspect, explain, or make one bounded change inside their
   selected workspace. They own code and command execution.
3. Record learner-reported code paths or command results through
   `patchquest_record_evidence`.
4. Ask them to submit the displayed question in the browser with confidence.
5. Read `patchquest_get_progress`, locate the new `submitted` attempt, and
   evaluate it through `patchquest_evaluate_answer`.
6. Tell the learner that the feedback and status are visible in the UI. For a
   partial or incorrect answer, identify the exact gap, point to the source,
   and ask for a separate revision submission; never overwrite an old attempt.

## Feedback standard

Every evaluation must state:

- **Target:** what the source requires.
- **Observed:** what the learner supplied.
- **Gap or confirmation:** one concrete distinction.
- **Correction:** source-linked explanation when needed.
- **Next:** one bounded action.

A passing command or confident answer is not semantic proof. Do not mark an
exit question correct without learner evidence and an accurate source-linked
explanation. Do not run learner code, install dependencies, or inspect paths
outside their confirmed workspace through PatchQuest MCP.

## Resume

Use `patchquest_get_progress` for the selected UI path. Continue a `revision`
or `active` section first; otherwise use `patchquest_get_next_activity`. The
agent never creates a separate progress file or transfers answers between paths.
