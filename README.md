# Pi Visual Recap

A Pi-native visual recap extension inspired by
[BuilderIO/visual-recap](https://github.com/BuilderIO/skills/tree/main/skills/visual-recap).
Generates review-ready summaries for commits, branches/diffs, GitHub PRs, and Pi sessions.

## Install

```sh
pi install git:github.com/apmantza/pi-visual-recap
```

## Usage

```text
/visual-recap                  # working tree
/visual-recap HEAD~1..HEAD     # range
/visual-recap commit abc123    # single commit
/visual-recap main             # branch
/visual-recap pr 42            # GitHub PR (uses `gh` if authed, falls back to REST)
/visual-recap session current  # current Pi session
```

Recaps are written to `.visual-recaps/<slug>/`:

- `recap.md` — Markdown rendering
- `recap.json` — structured `RecapDocument`
- `recap.mdx` — MDX with custom component references
- `index.html` — self-contained local preview (open in a browser)
- `evidence/diff.patch` — full git diff
- `evidence/files.json`, `evidence/commits.json`
- `evidence/pr.json` (PRs)
- `evidence/session.json` (Pi sessions)

## Tool surface

The agent can also call the `visual_recap` tool directly. The tool is registered
with `promptSnippet` + `promptGuidelines` so the model knows when to use it
(review summaries, "recap this", etc.).

## Configuration

Create `.pi/visual-recap.json` (project-local, only honored in trusted projects):

```json
{
  "outputDir": ".visual-recaps",
  "format": "all",
  "model": { "provider": "google", "id": "gemini-2.5-flash" },
  "maxDiffBytes": 750000,
  "includeEvidence": true
}
```

## Status

See `plan.md` for the full architecture and phase plan.

- [x] Phase 1: Git targets (working tree, range, commit, branch)
- [x] Phase 2: PR support (gh CLI + REST fallback)
- [x] Phase 3: Pi session support
- [x] Phase 4: MDX + self-contained HTML renderer
- [x] Phase 5: Common evidence model + `visual_recap` tool

## License

MIT
