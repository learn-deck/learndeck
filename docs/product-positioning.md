# LearnDeck v0.1 product position

## The promise

**Your app for learning with AI—without outsourcing your thinking.**

LearnDeck gives learners structured courses, an owned workspace, and a Socratic
AI guide. Understanding is the goal; a working project, written answer, or
other learner-produced work is the evidence. Local-first progress and
vendor-independent MCP connections make that promise credible, but they are
proof points—not the headline.

## Audience

The v0.1 learner is a developer with roughly two to five years of experience.
They can build features, already use an AI coding tool, and want to grow into a
person who can design systems. They learn independently, often alongside a
job, and need a focused 45–60-minute session to end in a real checkpoint.

The v0.1 catalogue speaks explicitly to developers. LearnDeck's Markdown
format and product identity are broader: future curated courses can serve other
serious learners when there is evidence of demand and a clear project-based
experience.

## Product principles

1. **Build, then explain.** Default-catalogue courses are project-based. A
   learner makes an observable change in a repository and explains a decision.
2. **Ask before answering.** The agent is a calm Socratic tutor. It narrows the
   next problem, evaluates against a published rubric, and does not write the
   learner's solution.
3. **The learner owns the work.** Progress lives locally and an AI host may be
   connected or changed without losing it. Learner code is never executed by
   LearnDeck.
4. **One deliberate next step.** The interface explains time, outcome, and
   prerequisites before commitment; it asks for a workspace only after a course
   is chosen.
5. **Quality over catalogue size.** The default library is curated. Forks stay
   open, but inclusion requires the public quality rubric.
6. **Calm, confident utility.** Editorial reading clarity meets a daily-use
   developer tool. Warm gold denotes interaction, never decoration. Focus Mode
   removes chrome so writing can take over.

## v0.1 release and sequence

Ship the self-hosted Bun app publicly before native packaging. The intended
sequence is:

1. Publish `learndeck/app` and `learndeck/courses` after the GitHub account is
   authenticated.
2. Invite use and contributions through the curated Markdown course standard.
3. Add a project-based Testing Fundamentals course to prove the format beyond
   architecture.
4. Package a native macOS app only after learning retention justifies it.

The app, course format, and self-hosting remain free. A later paid hosted layer
may sell convenience—such as a hosted catalogue, team dashboards, or author
analytics—but never access to learning itself.

## Success signals

v0.1 is local-first and does not send product analytics. When measuring is
introduced, it must be opt-in and understandable. Prioritise these signals over
vanity metrics:

| Signal | Why it matters | Initial target |
| --- | --- | --- |
| App open → first course started | Does the specific promise activate the right learner? | More than 40% |
| Module two return | Did one satisfying project session earn a return? | Track at day 7 |
| Course completion | Does the focused 6–8 hour format sustain commitment? | More than 30% |
| Voluntary answer revision | Does rubric feedback improve thinking rather than merely score it? | Track rate and depth |
| Connected vs. unconnected completion | Does optional AI guidance materially help? | Compare cohorts only with consent |
| Clone → first course started | Does open-source distribution lead to learning? | Product Hunt launch signal |

## Product Hunt sentence

> Structured courses you build in your own repo—with AI that asks questions
> instead of writing your code.

The strongest launch visual is Focus Mode: one real question, a learner's own
answer, and quiet rubric feedback—rather than a generic landing page.
