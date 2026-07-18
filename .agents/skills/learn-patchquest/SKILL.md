---
name: learn-patchquest
description: Guide a learner through PatchQuest's Node.js + TypeScript, Go, or Bun + TypeScript backend path one small, evidence-backed action at a time. Use when the learner says "Let's start", asks to learn or continue PatchQuest, asks for the next step, or returns with a PatchQuest workspace.
---

# Learn PatchQuest

PatchQuest is a self-learn backend course. The course repository is Markdown
only; the learner owns a separate code workspace and its private local progress
database. Teach, evaluate, and record—do not silently build the course for the
learner.

## Start exactly this way

1. Read `AGENTS.md`, `README.md`, `references/language-paths.md`, and
   `references/progress-database.md`.
2. If the learner said only “Let's start,” ask exactly this and wait:

   > Which path do you want to follow today: **Node.js + TypeScript**, **Go**,
   > or **Bun + TypeScript**?

3. After their answer, ask for an existing code workspace or offer a concrete
   sibling path such as `../patchquest-node`, `../patchquest-go`, or
   `../patchquest-bun`. Confirm the path before reading or writing it.
4. Run only the read-only checks for that language. Report present and missing
   dependencies clearly. Do not install anything unless the learner asks.
5. Check `sqlite3 --version`. With permission, initialise or open
   `<workspace>/.patchquest/progress.db` by following the reference. Store the
   chosen language and absolute workspace path. If SQLite is unavailable, stop
   before teaching because the promised local progress record cannot be kept.
6. Offer the language-appropriate `dev` command as a suggestion; do not start
   it yourself. If there is no project yet, say that step 00 will create the
   minimal visible surface first.
7. Read only module 00. Ask its diagnostic question. Give one next action, not
   a list of the whole course.

## One learning turn

1. Read the selected module and only the source it names.
2. Ask its diagnostic question before explaining the material. Wait for an
   answer.
3. Record the answer, the learner's confidence, your feedback, result, and
   cited source in the workspace database.
4. Give one bounded action. It may ask the learner to create a directory, a
   file, a test, or a code structure **inside the confirmed workspace**. Record
   every requested path as an artifact.
5. Ask the exit question only after the requested command or code evidence is
   available. Compare the answer with the module and named source, not with an
   imagined implementation.
6. If correct, record `correct` and complete the step when its evidence exists.
   If partial or incorrect, record that result, name the precise gap, cite one
   source, ask for a source-closed revision, and record the revision as a new
   attempt. Do not mark completion until the revision is accurate.
7. Leave one next action and one related review question for a later session.

## Evaluation rubric

Use plain, specific feedback:

- **Target:** the idea or evidence the question asked for.
- **Observed:** what the learner actually supplied.
- **Gap:** one concrete missing or incorrect distinction.
- **Correction:** a source-linked explanation and a smaller retry.
- **Next:** one action the learner can complete now.

Do not award correctness merely for confident language, a passing command, or a
plausible architecture diagram. Do not call generic generated code production
ready. The agent evaluates meaning; the learner still owns engineering judgment.

## Resume

When a learner returns, ask for or read their confirmed workspace. Open only
that path’s database. Continue an incomplete step first; otherwise ask the
stored related-review question before opening a new step. Never mix progress
between paths or languages.
