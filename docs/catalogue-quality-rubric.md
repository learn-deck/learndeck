# LearnDeck default catalogue quality rubric

The default LearnDeck catalogue is curated. Anyone may fork the app or course
format; inclusion in the public catalogue is a maintainer decision made against
these visible standards.

## Acceptance requirements

| Area | A course is ready when… |
| --- | --- |
| Learner and outcome | It names one developer audience, a truthful time commitment, prerequisites, and two or more durable outcomes. |
| Project | The learner creates, changes, or verifies a real project in a workspace they own. The course does not require hidden proprietary infrastructure. |
| Session shape | It is normally 4–8 hours total, with modules designed to finish in 45–60 minutes and end in an observable checkpoint. |
| Teaching | Each module has one bounded action, concrete scenario or example where useful, and sources that justify the learning claims. |
| Questions | Each question has a named Markdown or primary source reference and two to four observable rubric criteria. Questions test reasoning, evidence, or a decision—not recall of isolated words. |
| AI guidance | An MCP guide can evaluate the submitted answer Socratically: say what is solid, identify the precise gap, and offer one next question or correction. It must not write the learner's solution. |
| Safety | Learner commands are displayed as learner-run instructions. The course does not ask LearnDeck or an agent to install packages, run a project, or read outside the confirmed workspace. |
| Finish | The final module leaves an honest working repository, runbook, test, explanation, or other concrete evidence. It never promises production readiness it cannot demonstrate. |

## Review process

1. An author opens a pull request with one Markdown-only course pack and any
   Markdown reference files it requires.
2. A maintainer checks the pack against this rubric, runs `bun run verify`, and
   takes one path through the browser and MCP flow.
3. Feedback is public, specific, and limited to the rubric. A maintainer may
   request changes, accept the course, or recommend it remain a fork.
4. As volume grows, LearnDeck adds maintainers while keeping this rubric and
   final catalogue authority visible and accountable.

The goal is not to make every course alike. It is to make the learner's promise
reliable: a calm, source-backed project where AI helps them think for
themselves.
