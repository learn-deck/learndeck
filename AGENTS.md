# Repository Instructions

PatchQuest is technology-neutral at the root. English documentation and root
contracts are normative. Keep provider SDKs, framework types, database models,
and implementation paths out of the root domain and contracts.

## Verification

Use Node 24 and npm 11. From `/node`, run `npm ci` after a fresh checkout and
`npm run verify` before handing off a change. This is the same complete gate CI
runs. Run an individual script only for diagnosis; it does not replace the
complete gate.

## Guided learning

When a learner says “let's start”, “continue the course”, “next module”, or asks
to learn PatchQuest, read and follow
`.agents/skills/learn-patchquest/SKILL.md`. Start immediately with one small
action. Read and validate `.patchquest/progress.json` when it exists, then use
its one saved action or one due review; do not answer with a course dump or a
menu of every module.

The learner owns the work. Guide them to inspect, change, explain, and verify it
in first person. Start each module with its diagnostic before active work; ask
the distinct source-closed mastery prompt only after all required checks pass.
Persist loop phase and pending action after every learner turn. Evaluate against
repository evidence, correct errors, separately evaluate revisions and delayed
reviews, and link completion to activity/check/mastery/rubric/review records.
If a retrieval is `awaiting_revision`, or recovery is `pending` or
`bytes_restored_recheck_pending`, `learning:resume` must retain the same open
logical session and saved context without changing progress. Defer any due
review for the rest of that session. Only after the correction or recovery is
finalized may a later normal rollover route the queued review.
Treat ignored `.patchquest/progress.json` as the sole authority, commit proposed
drafts through `learning:checkpoint`, run gates through `learning:check`, and
treat `learning-log.md` as a disposable generated projection. Store only local
progress/backups under `.patchquest/`. Never claim a planned module is
executable before its implementation and checks exist. Treat automated
validation as structural integrity, not semantic evaluation of prose answers.

## Working boundaries

- Make domain changes in `docs/en/` before translating them.
- Preserve identifiers, event names, schema keys, commands, and Mermaid source
  unchanged in translations.
- Treat `contracts/` as language-neutral and `/node` as one consumer.
- Do not claim MCP, A2A, or provider compliance unless an adapter implements and
  verifies it.
- Do not execute untrusted submitted code on the host.
- Add agent skills only after the workflow they invoke is executable.
- Keep the only package lock at `/node/package-lock.json`.

Read `/node/AGENTS.md` before changing the Node implementation.

## Showcase and UI work

Before proposing any PatchQuest-facing UI, read
`docs/en/design/showcase.md` and open
`docs/en/design/showcase-prototype.html` in a browser. The mandate is simple,
visual, understandable at first sight: learning-first framing, plain words
before jargon, one animated loop diagram, deterministic fixture-backed demo
that stops for an explicit human decision, and no claims of live services. No
application path is reserved until executable UI work exists.
