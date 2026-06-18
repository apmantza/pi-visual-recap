---
name: visual-recap
description: >-
  Generate a visual recap of a commit, branch, PR, or Pi session. Use when the
  user asks for a review-ready summary of changes, "recap this", or
  "/visual-recap".
---

# Visual Recap

When the user asks for a visual recap (or uses `/visual-recap`), delegate to
the `visual_recap` tool instead of writing inline prose. The tool:

- Collects the git diff, commits, and file list for the requested target.
- Calls the active Pi model to produce a structured recap.
- Writes a `recap.md` + `recap.json` artifact under `.visual-recaps/`.

Supported target forms:

- empty → working tree
- `HEAD~1..HEAD` → range
- `commit <sha>` → single commit
- `main`, `feature/foo` → branch
- `pr 42` or a GitHub PR URL → pull request (Phase 3)
- `session current` → active Pi session (Phase 4)

After the tool returns, surface the artifact path in the chat and a 2-3 line
summary; do not paste the full recap into the response.
