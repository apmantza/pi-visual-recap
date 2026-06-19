# Changelog

All notable changes to `pi-visual-recap` are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-19

First installable release. Targets commits, branches/diffs, GitHub PRs, and Pi
sessions. All output is local; nothing is published remotely.

### Added

- `/visual-recap` slash command and `visual_recap` tool (with `promptSnippet` +
  `promptGuidelines` so the model knows when to invoke it).
- Target kinds:
  - Working tree, range (`HEAD~1..HEAD`), single commit, branch
  - `pr 42` / GitHub PR URL (prefers `gh` CLI, falls back to GitHub REST)
  - `session current` — current Pi session, with optional pre/post-resume
    split when a marker is present
  - `session tree` — full session tree, current branch + every other path
  - `session fork <entryId>` — recap up to a specific entry
  - `session <path>` — any session file by path
- Resume-split marker written on `session_start` with `reason === "resume"`
  (single `visual-recap:resume-from` custom entry, no auto-recap, no LLM
  roundtrip). Used by `/visual-recap session current` to separate pre-resume
  and post-resume halves.
- Output formats in `.visual-recaps/<slug>/`:
  - `recap.md` — canonical Markdown
  - `recap.json` — structured `RecapDocument`
  - `recap.mdx` — MDX with custom component references
  - `index.html` — self-contained browser preview
  - `evidence/{diff.patch, files.json, commits.json, pr.json, session.json}`
- `RecapDocument` schema covering outcome narrative, optional Mermaid diagram,
  file tree, key changes with annotations, review notes (risks), and follow-ups.
- `RecapEvidence` model normalising git / PR / session sources into a common
  shape before AI summarisation.
- `.pi/visual-recap.json` project config (only honoured in trusted projects):
  output dir, format, model override, max diff bytes, include-evidence.
- SKILL.md guiding the agent to use the `visual_recap` tool.
- `plan.md` documenting the full architecture and phase plan.
- vitest unit tests for the log path-sanitiser (19 cases covering Windows,
  Unix, home-relative, embedded quotes/brackets, and non-string inputs).

### Security

- Path-traversal guards in `openSessionFile` (session collector) reject paths
  with `..` segments and require the resolved file to exist.
- Path-traversal guards in `writeArtifact` use `safeJoinUnder` + per-segment
  `assertSafeSegment` to keep recap output inside the chosen base directory.
- Prompt-injection defence: evidence is wrapped in `<evidence>…</evidence>`
  fences with the closing tag defanged, and a `SECURITY` clause in the
  system prompt instructs the model to treat the evidence as untrusted data.
- All error logs that might include file paths are passed through
  `sanitizeErrorMessage` (`utils/log.ts`) which redacts Windows drive paths,
  Unix absolute paths, and home-relative (`~/foo`) paths.
- The `visual_recap:resume-from` marker uses pi's `appendEntry` (custom
  entries, ignored by LLM context) and is wrapped in a try/catch so a
  failure can never crash `session_start`.

### Known limitations

- No tests yet for: `parseTarget`, `coerceRecapDocument`, `extractJsonObject`,
  `walkToEvidence`, `countSubtree`, `resolveSessionPath` edge cases,
  `extractPathFromArgs`, `safeJoinUnder`, `evidenceFromSession` status
  promotion. These are tracked for v0.2.
- The `visual_recap:resume-from` marker is only written on
  `session_start { reason: "resume" }` in the current process. Sessions
  resumed before this extension was installed will not have the marker and
  will recap without the pre/post split.
- PR collector prefers `gh`; private-repo PRs without `gh` auth fall back to
  GitHub REST which requires a token in the environment for non-public PRs.
- HTML preview renders the recap JSON into a self-contained page that
  embeds data via `<script type="application/json">` and renders via an
  inline script. Load only recaps you trust.

[0.1.0]: https://github.com/apmantza/pi-visual-recap/releases/tag/v0.1.0
