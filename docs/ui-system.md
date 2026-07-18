# LearnDeck learning UI system

LearnDeck optimizes for **deliberate fluency**, not dashboard density. It is a
developer tool for learning software architecture by building in an owned
repository, with AI that asks before it answers. Content is the
highest-contrast object; navigation and application chrome stay quiet. Use this
document when changing `public/` so visual decisions remain predictable.

## Source of truth

`public/theme.css` owns reusable tokens. `public/app.css` composes those tokens
into components and blocks. Do not introduce raw colour values or one-off
spacing values in component styles unless a token is genuinely missing.

| Layer | Examples | Rule |
| --- | --- | --- |
| Primitive | semantic colours, spacing, font families, radius | Defined only in `theme.css`. |
| Component | buttons, inputs, progress track, callout, code block | One visual responsibility and accessible state. |
| Block | course briefing, workspace setup, lesson, answer form | Composes components; does not invent tokens. |

## Tokens

Spacing follows an 4/8px-compatible scale: `xs` 4, `sm` 8, `md` 16, `lg` 24,
`xl` 40, and `xxl` 64. Main content uses `xl` or greater whitespace so a
learner never has to visually separate application controls from material.

Colour names are semantic:

- `--color-surface-*` for canvas, raised cards, quiet surfaces, and code;
- `--color-content-*` for reading hierarchy;
- `--color-interactive*` only for actions and links;
- `--color-feedback-success`, `warning`, and `error` for evaluated work; and
- `--color-callout-*` for intentional learning annotations.

Dark is the default theme. The theme toggle persists locally and uses the same
semantic roles, so no learning-state meaning changes between themes.

## Reading rules

- Body text is 16px at 1.6+ line height; lesson measure is capped at 70ch.
- Headings follow a major-third-like progression and use `1.16–1.35` line
  height.
- Correctness never uses colour alone: attempts carry a word and a symbol such
  as `✓ Understood` or `↗ Revise`.
- The current section uses `Section n of total`, not an unexplained percentage.
  Its horizontal progress indicator is supplementary and fills as the learner
  reaches lesson blocks.

## Interaction rules

- Start at the app home, not inside a course. Lead with the durable product
  promise—learning with AI without outsourcing thinking—then name the concrete
  first course and audience. Show its duration, level, and outcome before
  asking for a workspace or an AI connection. Do not make a broad “learn
  anything” claim until the catalogue earns it.
- Categories support exploration, not optimisation. Keep filters small,
  descriptive, and reversible; course cards make the commitment cost visible.
- The course briefing makes the outcome, pace, and prerequisites clear before
  any form appears. The only setup decision is the learner's project workspace.
- The primary action is the next deliberate learning action: confirm a
  workspace, make the small change, or reflect and submit.
- Focus Mode removes the header and sidebar. It preserves a readable measure,
  section marker, and answer state; it must not add motivational chrome or
  interrupt writing. Focusing the answer field also hides the sticky header
  until focus leaves the field.
- Markdown supports source-linked headings, lists, code blocks with a local
  Copy/Copied affordance, and four source-authorable callouts:
  `NOTE`, `TIP`, `WARNING`, and `DEEP DIVE`. A `SCENARIO` callout is available
  for concrete real-world context.
- `learndeck` Markdown fences can render one local checklist, input, textarea,
  or switch. Keep them small and use stable IDs; their browser-local values are
  not submitted to an agent.
- A correct answer never auto-advances the learner. They choose when to move on.
- The start button and its nearby status must describe the same state. During
  startup both describe preparation; on success the learner moves directly to
  the library rather than seeing a stale loading label beside a ready message.

## Accessibility checks before shipping

1. Test both `data-theme="dark"` and `data-theme="light"`.
2. Check keyboard focus for theme, course overview, workspace setup, Focus Mode, copy, and submit
   actions.
3. Keep main text at WCAG AA contrast or higher; feedback includes text/symbol
   as well as colour.
4. Test the narrow layout at 320px and the full lesson at desktop width.
5. Run `bun run verify`; add a focused browser/UI check when altering an
   interaction state.
