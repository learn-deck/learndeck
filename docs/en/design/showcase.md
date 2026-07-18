# Showcase design guide

Status: non-normative presentation guidance. The domain docs and `contracts/`
remain the only normative sources. This guide captures what we learned building
the course showcase page (2026-07-12) so any agent evaluating a future
implementation inherits the decisions instead of rediscovering them. No
application path is reserved while the showcase remains a prototype.

Working prototype: [`showcase-prototype.html`](showcase-prototype.html) — a
single-file, dependency-free version of the page. Open it in a browser before
writing any showcase code. It is the reference for structure, copy, visuals,
and interaction. Published artifact (same content):
<https://claude.ai/code/artifact/7a903751-fc12-41a1-a374-53365189de9d>.
The original implementation brief for the full React app lives at
<https://claude.ai/code/artifact/a4655a05-ddb3-4ed9-beac-205260abf029>.

## The one-sentence mandate

Simple, visual, understandable at first sight — a visitor who has never heard
of DDD must understand within one screen what the course is, what they will
build, and what they will learn.

The primary conversion is not “watch a demo.” It is: **clone the repository,
open a local coding agent, say “Let's start,” and learn by building one guided
module at a time.** The showcase must make that three-step path visible before
the fold.

## Learnings (in the order we earned them)

1. **The course is the story; PatchQuest is the vehicle.** The first version
   led with the project (a cinematic dark "mission control" UI). It looked
   impressive and communicated nothing to the target audience. The page must
   lead with _what you learn_, then _what you build_. Say it outright:
   "PatchQuest is the vehicle, not the destination."
2. **Plain words first, jargon second.** Every technical concept gets an
   everyday sentence before its proper name. "It borrows the task for a
   limited time" before "lease". "Deciding what your system is about before
   coding it" before "domain-driven design". Section titles must survive a
   reader who knows no DDD ("One mission, six responsibilities" failed this
   test; "You write the task / An agent takes it on" passed).
3. **Map every project step to a skill.** Each step of the loop ends with an
   explicit italic line — _Teaches: leases, timeouts, and ownership_ — so the
   project sections double as curriculum.
4. **Keywords are a feature, not a compromise.** A "For your CV" section lists
   canonical recruiter-searchable terms (TypeScript, Node.js, DDD, hexagonal
   architecture, OpenAPI, AsyncAPI, distributed systems, idempotency…) plus
   honest "after the course you can say…" interview claims. Short canonical
   tags beat descriptive phrases; curation (not volume) signals seniority.
5. **One diagram carries the page.** The four-node loop (below) is the hero
   and the only animated element. One orchestrated animation beats scattered
   effects.
6. **Failures are curriculum.** The failure catalog is presented as
   first-class lessons ("You also build what happens when it goes wrong"),
   one plain-language line each, sourced from `acceptance/scenarios/`.
7. **The learner is the protagonist.** Use first-person outcome language:
   “What I build,” “My learning path,” and “I can explain…”. The agent is a
   local guide, not the author of the learner's work. Show exactly how I clone,
   start, progress, verify, and resume.
8. **The course lives in the clone.** The deployed page introduces and previews
   the experience; the repository skill teaches it. The primary CTA points to
   the public clone URL and the adjacent command is “Let's start.” Never require
   an account, hosted chat, or copied mega-prompt to begin.

## Visual system

Inherit kevinmamaqi.com's system (source of truth:
`website/src/styles.css` and `website/STYLEGUIDE.md` in the parent repo).
Tokens:

| Token  | Value     | Use                                   |
| ------ | --------- | ------------------------------------- |
| paper  | `#F7F3EC` | background                            |
| ink    | `#171717` | text, 1px borders                     |
| muted  | `#5F5B54` | secondary text                        |
| soft   | `#8B857A` | tertiary text, arrows                 |
| line   | `#D8D0C2` | dividers, offset shadows              |
| accent | `#23395B` | navy — machine actors (agent, system) |
| warm   | `#8F5B3E` | brown — human actors and decisions    |
| ok     | `#3E6B4F` | passing checks only                   |

- Display face: EB Garamond (Georgia fallback). Body: Inter (system fallback).
- Line–dot–line motif under every section head (warm in hero, navy in
  sections). Consistency matters: all sections or none.
- Print-style offset shadows (`8px 8px 0 var(--line)`, no blur) reserved for
  the loop figure and the demo panel only.
- Human/machine color coding is semantic and consistent everywhere: warm =
  human, navy = machine, green = verified evidence.

## The loop diagram

Four nodes, clockwise, from the learner's perspective: **1 · I define the coding
task → 2 · AI AGENT writes the code patch → 3 · VERIFIER runs every required
check → 4 · I approve or reject.** Edge labels: task → patch → evidence →
verdict. Center line: "the
agent never grades its own work." Below: "nothing ships without step 4."

Animation (see prototype JS): a token travels the edges; the edge draws itself
in the sender's color under the token; the arriving node tints and thickens;
an arrival ripple fires in the sender's color. Everything static under
`prefers-reduced-motion`.

Hard-won details:

- Keep node eyebrow text short enough for its box — "INDEPENDENT VERIFIER"
  overflowed; "VERIFIER" plus the center line carries independence.
- Give every SVG edge label a paper-colored halo
  (`paint-order: stroke; stroke: paper`) so labels never collide with lines.
- Provide a **vertical variant** of the diagram below 640px (stacked nodes,
  return edge up the right side, rotated label). Horizontal-only diagrams
  become unreadable on phones. Drive whichever variant is visible and re-pick
  on media-query change.

## The interactive demo

- Deterministic replay of `acceptance/scenarios/happy-completion.json` only —
  every step, ID, digest, and timestamp comes from the fixture.
- Label it honestly: "Interactive demo — fixture data, no live services."
- Playback **stops at "awaiting your decision"**. Approval requires an
  explicit visitor click; automation must never approve itself. Reject shows
  the human-rejection behavior (evidence preserved, bounded retry).
- Controls stay minimal: Run and Restart. Restart restores exact initial
  state. Respect `prefers-reduced-motion`.
- Gate names shown as "checks"; step labels in plain words ("Agent takes the
  task", "Waiting for you").

## The guided-learning path

- Add a prominent three-step visual: **1 · Clone → 2 · Open your agent → 3 · Say
  “Let's start.”**
- Show the module path from `course/en/README.md`, with ready and planned states.
- Each ready module uses first-person proof: “I can trace…”, “I can explain…”,
  “I verified…”.
- Explain that progress stays locally in `.patchquest/learning-progress.md` and
  can be resumed by saying “continue the course.”
- Show one small sample exchange with the guide. Do not render a fake autonomous
  agent transcript or imply that the website itself runs the course.
- On the deployed site, populate the clone command and GitHub link from one
  configured public repository URL. Until publication, label the URL as pending
  rather than inventing one.

## What to avoid (all tried and rejected)

- Dark cinematic "mission observatory" styling — wrong audience, wrong story.
- Jargon-first headings and DDD vocabulary without a plain-words runway.
- Long descriptive skill tags instead of canonical keywords.
- More than one animated element per page; decorative motion.
- Any claim of live agents, models, production services, adoption, or metrics.

## Page structure (as validated)

Header/nav → hero (headline "Build an agent platform you can actually
verify." + loop diagram + clone/start CTA) → How I start (three-step visual) →
My learning path → What I learn (7 plain-words rows) → For my CV →
pull quote ("Agents propose. Verification checks. You decide.") → What you
build (6 steps, each with _Teaches:_) → interactive demo → failure paths →
honest footer ("services in progress, fixtures are real").
