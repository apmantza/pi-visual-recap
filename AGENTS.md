# AGENTS.md

Guidance for AI agents and human contributors working on `pi-visual-recap`.
Read this before making non-trivial changes.

## What this repo is

A Pi extension that generates a review-ready **visual recap** for any of:

- A git target — working tree, range, commit, or branch
- A GitHub pull request — via `gh` CLI or the public REST API
- A Pi session — current branch, full tree, or a session file on disk

Output is a `.visual-recaps/<slug>/` directory with `recap.md`, `recap.json`,
`recap.mdx`, a self-contained `index.html`, and an `evidence/` subdirectory.
The recap is always written locally; nothing is published remotely.

The shape is inspired by BuilderIO's `visual-recap` skill, but the
implementation uses Pi's own SDK — `@earendil-works/pi-ai` for model calls,
`@earendil-works/pi-coding-agent` for `SessionManager` and `ExtensionAPI`.

## Repository layout

```
package.json                # Pi package manifest (pi.extensions, pi.skills)
plan.md                     # Full architecture + phase plan
CHANGELOG.md                # Keep-a-Changelog
AGENTS.md                   # This file
extensions/visual-recap/
  entrypoint.ts             # Default export: register command + tool + resume marker
  index.ts                  # generateRecap() — orchestrator (used by both command and tool)
  schemas.ts                # RecapTarget, RecapDocument, RecapEvidence, SessionEvidence, etc.
  config.ts                 # Defaults + mergeConfig() for project config
  config-file.ts            # Loader for .pi/visual-recap.json
  resume-marker.ts          # Writes the visual-recap:resume-from custom entry on /resume
  collectors/
    git.ts                  # git range/commit/branch collector
    github.ts               # PR collector (gh + REST)
    pi-session.ts           # Session collector (current, tree, file, fork)
    target.ts               # Slash-command argument parser
    tool-summary.ts         # Tool-call arg + result summarisation helpers
  analysis/
    normalize.ts            # Git / PR / session → common RecapEvidence
    prompts.ts              # System + user prompt builders, JSON coercion
    pi-ai.ts                # complete() wrapper using ctx.modelRegistry
  renderers/
    markdown.ts             # recap.md
    json.ts                 # recap.json
    mdx.ts                  # recap.mdx
    html.ts                 # index.html (self-contained)
  output/
    writer.ts               # Atomic directory writer with path-traversal guards
  utils/
    exec.ts                 # spawn-based exec / tryExec with buffer limits
    log.ts                  # LOG_PREFIX, sanitizeErrorMessage (path redactor)
    paths.ts                # slugify, timestampSlug, safeJoin
skills/visual-recap/SKILL.md # Agent-facing instructions for when to use the tool
tests/                       # vitest unit tests (run with `npm test`)
  utils/log.test.ts         # 19 cases for sanitizeErrorMessage
```

## Non-obvious design decisions

These are easy to get wrong on a re-read. Verify before changing.

1. **Entry point is `entrypoint.ts`, not `index.ts`.** Pi's loader imports the
   file specified in `pi.extensions` and calls its default export. `index.ts`
   is the orchestrator module and has no default export. If you point the
   manifest at `index.ts`, you get "Extension does not export a valid
   factory function".

2. **The resume marker is `pi.appendEntry(...)` with `customType: "visual-recap:resume-from"`.**
   Custom entries do not participate in LLM context (see Pi session-format
   docs). The `RESUME_MARKER_TYPE` constant is exported from
   `collectors/pi-session.ts` and used by both `resume-marker.ts` (writer)
   and `findResumeMarker` (reader). Do not hardcode the string.

3. **The marker is the first entry of the post-resume slice.** In
   `collectSession`, the pre-resume slice is `branch.slice(0, markerIdx)`
   and the post-resume slice is `branch.slice(markerIdx)` (inclusive).
   Earlier versions accidentally walked the whole branch for post-resume.

4. **Branch length in tree mode is the recursive subtree size**, not
   `children.length`. See `countSubtree` in `collectors/pi-session.ts`.

5. **Path safety is non-negotiable.** `safeJoinUnder` in `output/writer.ts`
   refuses to write outside the resolved base dir. `assertSafeSegment`
   rejects anything that isn't `[A-Za-z0-9._-]`. `resolveSessionPath` in
   `pi-session.ts` rejects `..` segments and requires `existsSync`. Do not
   bypass these for "convenience" — they guard arbitrary-file-read
   exploits from a malicious recap arg.

6. **Prompt-injection defence:** evidence is wrapped in `<evidence>…</evidence>`
   fences, the closing tag is defanged (`<\/evidence>`), and the system
   prompt includes a `SECURITY` clause. Keep these in sync.

7. **No auto-generated recaps.** The marker is written on `/resume`, but no
   recap is ever auto-generated. The user always types `/visual-recap` or
   the model calls the `visual_recap` tool explicitly. This is a
   non-negotiable design choice; do not add `session_before_switch` or
   `session_before_fork` hooks that produce output.

## Local development

The repo is intentionally not vendored — `node_modules/` is not committed
and the `pi` packages are peer dependencies resolved at install time.

To work on it:

```sh
cd /path/to/pi-visual-recap
npm install               # installs vitest + typescript only
# Then either:
pi -e ./extensions/visual-recap/entrypoint.ts   # load directly
# or:
ln -s "$PWD/extensions/visual-recap" ~/.pi/agent/extensions/visual-recap
# or:
pi install .             # install as a package
```

Run tests:

```sh
npm test                 # vitest run
npm run test:watch       # interactive
npm run typecheck        # tsc --noEmit
```

## How to add a new target kind

1. Add the variant to `RecapTarget` in `schemas.ts` and the parser branch
   in `collectors/target.ts`.
2. Add a collector under `collectors/` that returns a typed `*Evidence`
   object.
3. Add a `evidenceFrom*` normaliser in `analysis/normalize.ts` that maps
   the typed evidence into a `RecapEvidence`.
4. Wire it into the `collectEvidence` switch in `index.ts` and
   `targetLabelFor`.
5. Add a prompt builder in `analysis/prompts.ts` and a new `case` in
   `buildUserPrompt`. The exhaustive `_exhaustive: never` default will
   catch missing cases at compile time.
6. If the new target can produce a fileMap entry with a status outside
   `ChangedFile["status"] | "touched" | "read"`, extend
   `FileMapEntry["status"]` and update `badgeFor` in
   `renderers/markdown.ts`.

## How to add a new output format

1. Add a `renderXxx(doc: RecapDocument): string` to a file under
   `renderers/`.
2. Extend the `VisualRecapOptions["format"]` union in `schemas.ts` and
   `DEFAULTS.format` in `config.ts`.
3. Wire the format string into the `files` map inside `generateRecap` in
   `index.ts`.

## How to extend the recap model

`RecapDocument` is the on-disk contract. Adding a section type means:

1. Add the variant to the `RecapSection` discriminated union in
   `schemas.ts`.
2. Render it in every renderer that should support it (`markdown.ts`,
   `mdx.ts`, `html.ts`). The exhaustive switches in each renderer will
   catch missing cases.
3. If the AI should produce the new section, add it to the `Output`
   interface in `outputInterface("code" | "session")` in `prompts.ts` and
   to the JSON coercion in `coerceRecapDocument`.

## Testing policy

- Run `npm test` before pushing. Add tests for any non-trivial change.
- The sanitizer (`utils/log.ts`) has 19 cases. They caught a regex
  regression in v0.1.0 development; keep them.
- The DRYKISS autoreview tends to flag every new untested function as a
  P1. Treat the structural findings (real bugs, security issues) as
  blocking; treat the "untested" findings as backlog. Use the
  `drykiss_autoreview` tool with an explicit `base` parameter — without
  one, the tool has been observed to re-report findings from an older
  commit and pretend they apply to HEAD.

## Commit and release

- One commit per logical change, with a short subject line.
- Push with `git push origin main --follow-tags`.
- Bump `package.json` version and add a `CHANGELOG.md` entry before
  tagging. Annotated tags only (`git tag -a vX.Y.Z`).
- Use `gh release create` to publish the release notes.

## Where things live (quick reference)

| Question | Look here |
| --- | --- |
| "What does `/visual-recap` parse?" | `collectors/target.ts` |
| "How does the AI call work?" | `analysis/pi-ai.ts` + `index.ts#runAi` |
| "Where does the pre-resume split come from?" | `collectors/pi-session.ts#collectSession` + `#findResumeMarker` |
| "How is evidence normalised?" | `analysis/normalize.ts` |
| "What does the rendered recap look like?" | `renderers/{markdown,mdx,html}.ts` |
| "Where are the path-traversal guards?" | `output/writer.ts#safeJoinUnder` + `collectors/pi-session.ts#resolveSessionPath` |
| "How does prompt-injection defence work?" | `analysis/prompts.ts#wrapEvidence` + `SYSTEM_PROMPT` SECURITY clause |
| "What does the resume marker do?" | `resume-marker.ts` + `entrypoint.ts#session_start` |
