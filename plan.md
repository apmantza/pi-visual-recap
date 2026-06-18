# Pi Visual Recap Extension — Architecture + Implementation Plan

## Goal

Build a Pi package/extension inspired by BuilderIO's `visual-recap` skill, but native to Pi:

- Targets **commits**, **branches/diffs**, **GitHub PRs**, and **Pi sessions**.
- Uses Pi's own SDK/runtime capabilities instead of outsourcing orchestration to an external agent workflow.
- Produces a human-reviewable **visual recap artifact**: MDX/Markdown + JSON model + optional local HTML preview.
- Exposes both a slash command for humans and a tool for the agent.

Primary command:

```text
/visual-recap [target]
```

Examples:

```text
/visual-recap HEAD~3..HEAD
/visual-recap commit abc123
/visual-recap pr 42
/visual-recap session current
/visual-recap session /path/to/session.jsonl
/visual-recap --mode local --out recaps/auth-flow HEAD~1..HEAD
```

## Design Principles

1. **Pi-native first**
   - Implement as a Pi package with an extension entrypoint.
   - Use `ExtensionAPI`, `ctx.sessionManager`, `ctx.modelRegistry`, and Pi UI methods.
   - Use `@earendil-works/pi-ai` (`complete`, `getModel`, `StringEnum`) for internal model calls.
   - Optionally use `@earendil-works/pi-coding-agent` SDK sessions for isolated read-only analysis passes where useful.

2. **No mandatory hosted dependency**
   - Default output is local files in the repo or temp dir.
   - Hosted publishing can be added later as a pluggable publisher.

3. **Structured recap model before rendering**
   - First generate a typed `RecapDocument` JSON object.
   - Render that object to MDX, Markdown, and/or HTML.
   - Keep renderers replaceable.

4. **Diff-grounded**
   - Every recap section should be traceable to collected git/session evidence.
   - Avoid generic prose; prefer file maps, key diffs, API/schema notes, UI state summaries, and risks.

5. **Works for Pi sessions**
   - Pi session recaps summarize conversation intent, tool calls, edited files, generated artifacts, decisions, and unresolved follow-ups.

## Package Layout

```text
pi-visual-recap/
  package.json
  README.md
  plan.md
  extensions/
    visual-recap/
      index.ts                 # Pi extension entrypoint
      commands.ts              # /visual-recap command registration
      tool.ts                  # visual_recap custom tool registration
      schemas.ts               # TypeBox params + TS recap model types
      config.ts                # defaults + .pi/visual-recap.json loading
      collectors/
        git.ts                 # commit/range/working-tree diff collection
        github.ts              # PR metadata + diff via gh or GitHub API
        pi-session.ts          # SessionManager/session jsonl collection
      analysis/
        chunk.ts               # budget/chunk changed files/session data
        prompts.ts             # system/user prompts for recap generation
        pi-ai.ts               # complete() wrapper using ctx.modelRegistry
        reducer.ts             # merge chunk summaries into final recap model
      renderers/
        mdx.ts                 # Agent-Native-inspired MDX components
        markdown.ts            # plain Markdown fallback
        html.ts                # self-contained local preview
      output/
        writer.ts              # writes recap dir atomically
        opener.ts              # optional browser open
      utils/
        exec.ts
        paths.ts
        truncate.ts
        slug.ts
  prompts/
    visual-recap.md            # optional prompt template wrapper
  skills/
    visual-recap/SKILL.md      # optional instructions so the agent knows when to call the tool
```

## Pi Package Manifest

`package.json` should declare the extension as a Pi package:

```json
{
  "name": "pi-visual-recap",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package", "visual-recap", "review"],
  "pi": {
    "extensions": ["./extensions/visual-recap/index.ts"],
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

## Extension Surface

### Slash command

Register `/visual-recap` for direct use:

```ts
pi.registerCommand("visual-recap", {
  description: "Create a visual recap for a commit, PR, branch diff, working tree, or Pi session",
  handler: async (args, ctx) => { ... }
});
```

Responsibilities:

1. Parse target and options.
2. Prompt user for missing target in TUI mode.
3. Collect evidence.
4. Run Pi-AI analysis.
5. Render/write artifact.
6. Show path/URL in `ctx.ui.notify()` and optionally a widget summary.

### Agent-callable tool

Register `visual_recap` so the model can invoke recap generation:

```ts
pi.registerTool({
  name: "visual_recap",
  label: "Visual Recap",
  description: "Generate a visual recap for a git target, GitHub PR, or Pi session",
  parameters: VisualRecapParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... }
});
```

Use `StringEnum` from `@earendil-works/pi-ai` for enum params to stay provider-compatible.

## Target Model

Supported target kinds:

```ts
type RecapTarget =
  | { kind: "working-tree"; base?: string }
  | { kind: "commit"; ref: string }
  | { kind: "range"; range: string }
  | { kind: "branch"; base: string; head?: string }
  | { kind: "pr"; idOrUrl: string }
  | { kind: "session"; session?: "current" | string };
```

Command parsing examples:

- no args → working tree against merge-base or `HEAD`
- `HEAD~1..HEAD` → range
- `commit abc123` → commit
- `pr 42` / GitHub URL → PR
- `session current` → active Pi session

## Evidence Collectors

### Git collector

Use local git commands:

- `git rev-parse --show-toplevel`
- `git status --porcelain=v1`
- `git diff --stat`
- `git diff --name-status`
- `git diff --find-renames --find-copies --unified=80 <target>`
- `git show --stat --find-renames --unified=80 <commit>`
- `git log --oneline --decorate --max-count=50 <range>`

Output:

```ts
interface GitEvidence {
  repoRoot: string;
  targetLabel: string;
  baseRef?: string;
  headRef?: string;
  commits: CommitSummary[];
  files: ChangedFile[];
  diffText: string;
}
```

### GitHub PR collector

Preferred path:

1. Use `gh pr view --json ...` if `gh` exists and repo auth works.
2. Fallback to public GitHub REST endpoints for public PRs.
3. Fallback to local branch comparison if PR branch is checked out.

Collect:

- title/body/author
- labels/review status if available
- changed files
- patch/diff
- linked issue references

### Pi session collector

Use current session from `ctx.sessionManager` or open another session file via `SessionManager.open()`.

Collect:

- user goals/prompts
- assistant summaries
- tool calls/results
- file write/edit operations
- bash commands relevant to implementation/testing
- compaction/tree labels
- current branch path only by default, with option for full tree

Output:

```ts
interface SessionEvidence {
  sessionFile?: string;
  sessionId?: string;
  entries: SessionEntrySummary[];
  toolTimeline: ToolTimelineItem[];
  touchedFiles: string[];
  inferredWorkUnits: WorkUnit[];
}
```

## Analysis Pipeline

### Stage 1: Normalize evidence

Convert any target into a common `RecapEvidence` shape:

```ts
interface RecapEvidence {
  target: RecapTarget;
  titleHint: string;
  sourceKind: "git" | "github-pr" | "pi-session" | "mixed";
  files: ChangedFile[];
  diffs: FileDiff[];
  commits?: CommitSummary[];
  session?: SessionEvidence;
  metadata: Record<string, unknown>;
}
```

### Stage 2: Chunking

Large PRs/sessions need multiple model calls.

Chunk by:

- file type/domain (`api`, `schema`, `ui`, `tests`, `docs`, `infra`)
- diff size
- session timeline boundaries
- commit boundaries

Each chunk receives a focused prompt and returns a small structured summary.

### Stage 3: Pi-AI model calls

Create a wrapper around `complete()`:

```ts
async function runPiAi<T>({
  ctx,
  modelPreference,
  messages,
  signal,
  maxTokens
}: RunPiAiOptions): Promise<string> {
  const model = modelPreference
    ? ctx.modelRegistry.find(modelPreference.provider, modelPreference.id)
    : ctx.model;

  if (!model) throw new Error("No model available for visual recap analysis");

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  if (!auth.apiKey) throw new Error(`No API key for ${model.provider}`);

  const response = await complete(
    model,
    { messages },
    { apiKey: auth.apiKey, headers: auth.headers, maxTokens, signal }
  );

  return response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map(part => part.text)
    .join("\n");
}
```

Use the active Pi model by default so recap generation respects the user's current Pi setup. Allow config override for cheaper recap model.

### Stage 4: Structured recap generation

Final model output should be JSON matching:

```ts
interface RecapDocument {
  version: 1;
  kind: "visual-recap";
  title: string;
  brief: string;
  target: string;
  generatedAt: string;
  sections: RecapSection[];
  fileMap: FileMapEntry[];
  keyChanges: KeyChange[];
  risks: ReviewRisk[];
  followUps: string[];
}
```

Section types:

```ts
type RecapSection =
  | { type: "outcome"; markdown: string }
  | { type: "diagram"; title: string; mermaid: string; summary?: string }
  | { type: "file-tree"; entries: FileMapEntry[] }
  | { type: "api-summary"; endpoints: ApiChange[] }
  | { type: "schema-summary"; models: SchemaChange[] }
  | { type: "ui-states"; states: UiStateChange[] }
  | { type: "session-timeline"; items: SessionTimelineItem[] }
  | { type: "review-notes"; risks: ReviewRisk[] };
```

Do not rely on perfect provider JSON mode initially. Ask for fenced JSON, extract/repair conservatively, validate, then retry once with validation errors.

## Rendering

### MDX renderer

Generate local MDX inspired by BuilderIO/Agent-Native blocks, but without requiring hosted Plan infrastructure.

Suggested components:

```mdx
<Recap title="..." target="..." />
<FileTree files={...} />
<Diagram type="mermaid" chart={`...`} />
<ApiSummary endpoints={...} />
<SchemaMap models={...} />
<UiStates states={...} />
<KeyChanges>
  <DiffTab file="src/auth.ts" summary="..." annotations={...}>
    {`diff...`}
  </DiffTab>
</KeyChanges>
```

### Markdown fallback

Always write a plain `recap.md` so the artifact is useful in GitHub and terminals.

### HTML preview

Generate a zero-build `index.html` that:

- loads `recap.json`
- renders file tree/key changes/timeline
- supports collapsible diff sections
- optionally renders Mermaid via CDN if allowed, with text fallback

This gives an interactive local recap without a server.

## Output Directory

Default:

```text
.visual-recaps/<slug>/
  recap.json
  recap.md
  recap.mdx
  index.html
  evidence/
    diff.patch
    files.json
    session.json
```

Options:

- `--out <dir>` custom output
- `--commit` write under `recaps/<slug>/` for source-controlled artifacts
- `--open` open `index.html`
- `--format md|mdx|html|json|all`

## Configuration

Read trusted project config from `.pi/visual-recap.json` only if `ctx.isProjectTrusted()`.

Example:

```json
{
  "outputDir": ".visual-recaps",
  "defaultFormat": "all",
  "openAfterGenerate": false,
  "model": {
    "provider": "google",
    "id": "gemini-2.5-flash"
  },
  "maxDiffBytes": 750000,
  "maxKeyChanges": 8,
  "includeEvidence": true
}
```

## Implementation Phases

### Phase 1 — Minimal Pi-native MVP

- Create package manifest.
- Register `/visual-recap` command.
- Implement working-tree/range/commit git collector.
- Use `complete()` via `ctx.modelRegistry` to produce a Markdown recap.
- Write `.visual-recaps/<slug>/recap.md` and `recap.json`.
- Notify user with file path.

Acceptance:

```text
/visual-recap HEAD~1..HEAD
```

creates a recap with title, brief, file map, key changes, risks, and follow-ups.

### Phase 2 — Structured model + renderers

- Add TypeScript recap model and validation.
- Add MDX renderer.
- Add self-contained HTML preview.
- Add key diff excerpt selection and annotations.
- Add config file support.

### Phase 3 — PR support

- Add `pr` target parser.
- Add `gh` collector.
- Add GitHub REST fallback.
- Include PR metadata in recap.

### Phase 4 — Pi session support

- Implement `session current` using `ctx.sessionManager.getBranch()`.
- Implement session-file target using `SessionManager.open()`.
- Detect edited files/tool timeline/work units.
- Render `session-timeline` and decisions/follow-ups.

### Phase 5 — Agent tool + skill guidance

- Register `visual_recap` tool.
- Add skill instructions telling the agent when to use it.
- Add `promptSnippet` and `promptGuidelines` so the tool appears correctly in Pi's system prompt.

### Phase 6 — Polish

- Add progress updates through `onUpdate` and `ctx.ui.setStatus()`.
- Add `/visual-recap-config` or interactive options picker.
- Add tests for target parsing, JSON extraction, renderers, and collectors.
- Add README examples and install instructions.

## Testing Strategy

Unit tests:

- target parser
- git diff command construction
- session entry summarization
- JSON extraction/validation retry
- MDX escaping
- HTML generation

Fixture tests:

```text
test/fixtures/simple-diff.patch
test/fixtures/ui-diff.patch
test/fixtures/api-schema-diff.patch
test/fixtures/pi-session.jsonl
```

Manual smoke tests:

```sh
pi -e ./extensions/visual-recap/index.ts
# then inside Pi:
/visual-recap HEAD~1..HEAD
/visual-recap session current
```

## Risks / Decisions

- **Large diffs:** must chunk before model calls and cap raw patch inclusion.
- **JSON reliability:** validate, retry once, then fall back to Markdown recap.
- **Sensitive data:** default local output; never publish remotely without explicit future publisher config.
- **PR auth:** prefer `gh` for private PRs; REST fallback only for public or token-provided access.
- **Session ambiguity:** `session current` should recap the active branch path, not every abandoned branch, unless `--full-tree` is passed.

## Initial Build Order

1. `package.json`
2. `extensions/visual-recap/schemas.ts`
3. `extensions/visual-recap/utils/exec.ts`
4. `extensions/visual-recap/collectors/git.ts`
5. `extensions/visual-recap/analysis/pi-ai.ts`
6. `extensions/visual-recap/analysis/prompts.ts`
7. `extensions/visual-recap/renderers/markdown.ts`
8. `extensions/visual-recap/output/writer.ts`
9. `extensions/visual-recap/commands.ts`
10. `extensions/visual-recap/index.ts`

This gets a working `/visual-recap` command quickly while leaving room for PR/session support and richer visual renderers.
