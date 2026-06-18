# Pi Visual Recap

A Pi-native visual recap extension inspired by
[BuilderIO/visual-recap](https://github.com/BuilderIO/skills/tree/main/skills/visual-recap).
Generates a review-ready summary for commits, branches/diffs, PRs, and Pi sessions.

## Install

```sh
pi install ./pi-visual-recap
```

Or symlink it into your global extensions:

```sh
ln -s "$(pwd)/extensions/visual-recap" ~/.pi/agent/extensions/visual-recap
```

## Usage

```text
/visual-recap                  # working tree
/visual-recap HEAD~1..HEAD     # range
/visual-recap commit abc123    # single commit
/visual-recap main             # branch
```

Recaps are written to `.visual-recaps/<slug>/`:

- `recap.md` — Markdown rendering
- `recap.json` — structured `RecapDocument`
- `evidence/diff.patch` — full git diff
- `evidence/files.json`, `evidence/commits.json`

## Configuration

Create `.pi/visual-recap.json` (project-local, only honored in trusted projects):

```json
{
  "outputDir": ".visual-recaps",
  "format": "all",
  "model": { "provider": "google", "id": "gemini-2.5-flash" },
  "maxDiffBytes": 750000
}
```

## Status

- [x] Phase 1: MVP for git targets (working tree, range, commit, branch)
- [ ] Phase 2: PR support (gh + GitHub REST fallback)
- [ ] Phase 3: Pi session support
- [ ] Phase 4: MDX + interactive HTML renderer

See `plan.md` for the full architecture.
