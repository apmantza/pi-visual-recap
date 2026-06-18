// Build prompts for any evidence type, plus RecapDocument coercion.
import type {
  KeyChange,
  RecapDocument,
  RecapEvidence,
  RecapSection,
  ReviewRisk,
  SessionEvidence,
  SessionTimelineItem,
} from "../schemas.ts";

const SYSTEM_PROMPT = [
  "You are a senior code reviewer writing a concise visual recap of a code change for a human reviewer.",
  "",
  "Goals:",
  "- Give a reviewer the SHAPE of the change at high altitude before they read raw diffs or full transcripts.",
  "- Be specific. Cite file paths, function names, contract changes, and risks grounded in the evidence.",
  "- Avoid filler. No 'this is a recap' or 'please review carefully' prose.",
  "- Use the structured JSON shape described in the user message.",
  "- Lean is not thin. 3-8 key changes for code/PR; 3-6 timeline beats + concrete decisions for sessions.",
  "",
  "Tone: terse, technical, evidence-based.",
].join("\n");

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildUserPrompt(evidence: RecapEvidence, targetLabel: string): string {
  switch (evidence.source) {
    case "git":
      return buildGitPrompt(evidence, targetLabel);
    case "github-pr":
      return buildPrPrompt(evidence, targetLabel);
    case "pi-session":
      return buildSessionPrompt(evidence, targetLabel);
  }
}

function buildGitPrompt(evidence: RecapEvidence, targetLabel: string): string {
  const e = evidence;
  return [
    `Target: ${targetLabel}`,
    `Source: git range/diff`,
    `Commits in scope: ${e.commits.length}`,
    `Changed files: ${e.fileMap.length}`,
    "",
    "Changed file list (path, status, +additions/-deletions):",
    e.fileMap.length > 0
      ? e.fileMap.map((f) => `- ${f.path}  [${f.status}] +${f.additions}/-${f.deletions}`).join("\n")
      : "(no changed files detected)",
    "",
    "Commits:",
    e.commits.length > 0
      ? e.commits.map((c) => `- ${c.shortSha} ${c.subject} (${c.author})`).join("\n")
      : "(no commit log available)",
    "",
    "Diff (truncated to context budget; full diff saved alongside recap):",
    "```diff",
    e.diffText || "(no diff content)",
    "```",
    "",
    "Return ONLY a JSON object matching this TypeScript shape (no commentary, no markdown fences):",
    "```ts",
    "interface Output {",
    "  title: string;          // <= 70 chars",
    "  brief: string;          // 1-3 sentences",
    "  outcome: string;        // 1-3 paragraphs of what changed and why",
    "  fileMap: Array<{ path: string; status: string; additions: number; deletions: number; note?: string }>;",
    "  keyChanges: Array<{ path: string; summary: string; rationale?: string; annotations?: Array<{ lineRange?: string; note: string }> }>;",
    "  risks: Array<{ title: string; severity: 'info' | 'low' | 'medium' | 'high'; description: string }>;",
    "  followUps: string[];",
    "  diagram?: { title: string; mermaid: string; summary?: string };",
    "}",
    "```",
    "Use 3-8 keyChanges. Do not invent files. Output JSON only.",
  ].join("\n");
}

function buildPrPrompt(evidence: RecapEvidence, targetLabel: string): string {
  const e = evidence;
  const pr = e.pr!;
  return [
    `Target: ${targetLabel}`,
    `Source: GitHub pull request`,
    `Title: ${pr.title}`,
    `Author: ${pr.author}`,
    `Base: ${pr.baseRef}  •  Head: ${pr.headRef}  •  State: ${pr.state}`,
    pr.url ? `URL: ${pr.url}` : "",
    pr.labels.length > 0 ? `Labels: ${pr.labels.join(", ")}` : "",
    "",
    "PR body:",
    pr.body || "(no body)",
    "",
    "Changed file list:",
    e.fileMap.length > 0
      ? e.fileMap.map((f) => `- ${f.path}  [${f.status}] +${f.additions}/-${f.deletions}`).join("\n")
      : "(no changed files detected)",
    "",
    "Diff:",
    "```diff",
    e.diffText || "(no diff content)",
    "```",
    "",
    "Return ONLY a JSON object matching:",
    "```ts",
    "interface Output {",
    "  title: string;          // <= 70 chars",
    "  brief: string;          // 1-3 sentences",
    "  outcome: string;        // 1-3 paragraphs",
    "  fileMap: Array<{ path: string; status: string; additions: number; deletions: number; note?: string }>;",
    "  keyChanges: Array<{ path: string; summary: string; rationale?: string; annotations?: Array<{ lineRange?: string; note: string }> }>;",
    "  risks: Array<{ title: string; severity: 'info' | 'low' | 'medium' | 'high'; description: string }>;",
    "  followUps: string[];",
    "  diagram?: { title: string; mermaid: string; summary?: string };",
    "}",
    "```",
    "Use 3-8 keyChanges. Output JSON only.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function buildSessionPrompt(evidence: RecapEvidence, targetLabel: string): string {
  const s = evidence.session!;
  const summary = summarizeSessionForPrompt(s);
  return [
    `Target: ${targetLabel}`,
    `Source: Pi session`,
    s.sessionName ? `Session name: ${s.sessionName}` : "",
    s.sessionFile ? `Session file: ${s.sessionFile}` : "",
    `Branch length: ${s.branchLength} entries  •  Messages: ${s.totalMessages}`,
    s.startedAt ? `Started: ${s.startedAt}` : "",
    s.endedAt ? `Ended: ${s.endedAt}` : "",
    "",
    "Tool call counts:",
    s.toolCalls.length > 0
      ? s.toolCalls.map((t) => `- ${t.name}: ${t.count}`).join("\n")
      : "(none)",
    "",
    "Files touched:",
    s.touchedFiles.length > 0
      ? s.touchedFiles.slice(0, 40).map((f) => `- [${f.action}] ${f.path}`).join("\n")
      : "(no files touched via write/edit)",
    "",
    "Timeline (truncated):",
    s.turns.length > 0
      ? s.turns
          .slice(0, 40)
          .map((t) => {
            const head = t.text.replace(/\s+/g, " ").slice(0, 140);
            const tools = t.toolCalls?.length ? ` [tools: ${t.toolCalls.map((c) => c.name).join(", ")}]` : "";
            return `- [${t.role}] ${head}${tools}`;
          })
          .join("\n")
      : "(no turns captured)",
    "",
    "Compaction summaries:",
    s.compactionSummaries.length > 0
      ? s.compactionSummaries.map((c) => `- ${c.slice(0, 240)}…`).join("\n")
      : "(none)",
    "",
    summary,
    "",
    "Return ONLY a JSON object matching:",
    "```ts",
    "interface Output {",
    "  title: string;          // <= 70 chars",
    "  brief: string;          // 1-3 sentences",
    "  outcome: string;        // 1-3 paragraphs of what the session accomplished",
    "  timeline: Array<{ index: number; role: 'user' | 'assistant' | 'tool' | 'compaction' | 'branch'; title: string; detail?: string }>;",
    "  keyChanges: Array<{ path: string; summary: string; rationale?: string; annotations?: Array<{ lineRange?: string; note: string }> }>;",
    "  risks: Array<{ title: string; severity: 'info' | 'low' | 'medium' | 'high'; description: string }>;",
    "  followUps: string[];",
    "  diagram?: { title: string; mermaid: string; summary?: string };",
    "}",
    "```",
    "3-6 timeline beats. 3-8 keyChanges. Output JSON only.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function summarizeSessionForPrompt(s: SessionEvidence): string {
  const userPrompts = s.userPrompts
    .slice(0, 6)
    .map((p) => `- ${p.replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n");
  const assistant = s.assistantSummaries
    .slice(-3)
    .map((a) => `- ${a.replace(/\s+/g, " ").slice(0, 200)}`)
    .join("\n");
  const decisions = s.decisions
    .slice(0, 12)
    .map((d) => `- ${d.decision} — ${d.rationale.slice(0, 120)}`)
    .join("\n");

  return [
    "User prompts:",
    userPrompts || "(none captured)",
    "",
    "Recent assistant outputs:",
    assistant || "(none captured)",
    "",
    "Decisions / file operations:",
    decisions || "(no write/edit calls captured)",
  ].join("\n");
}

export function coerceRecapDocument(
  raw: string,
  fallback: { title: string; brief: string; target: string },
  model: { provider: string; id: string } | undefined,
  evidence: RecapEvidence,
): RecapDocument {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return buildFallbackDocument(raw, fallback, model, evidence);
  }
  const fileMap = Array.isArray(parsed.fileMap)
    ? parsed.fileMap.map((entry: any) => ({
        path: String(entry.path ?? ""),
        status: String(entry.status ?? "modified") as any,
        additions: Number(entry.additions ?? 0),
        deletions: Number(entry.deletions ?? 0),
        note: entry.note ? String(entry.note) : undefined,
      }))
    : evidence.fileMap;
  const keyChanges: KeyChange[] = Array.isArray(parsed.keyChanges)
    ? parsed.keyChanges.map((entry: any) => ({
        path: String(entry.path ?? ""),
        summary: String(entry.summary ?? ""),
        rationale: entry.rationale ? String(entry.rationale) : undefined,
        annotations: Array.isArray(entry.annotations)
          ? entry.annotations.map((a: any) => ({
              lineRange: a.lineRange ? String(a.lineRange) : undefined,
              note: String(a.note ?? ""),
            }))
          : undefined,
      }))
    : [];
  const risks: ReviewRisk[] = Array.isArray(parsed.risks)
    ? parsed.risks.map((entry: any) => ({
        title: String(entry.title ?? "Risk"),
        severity: (["info", "low", "medium", "high"].includes(entry.severity)
          ? entry.severity
          : "info") as "info" | "low" | "medium" | "high",
        description: String(entry.description ?? ""),
      }))
    : [];
  const followUps = Array.isArray(parsed.followUps)
    ? parsed.followUps.map((x: any) => String(x))
    : [];
  const timeline: SessionTimelineItem[] | undefined = Array.isArray(parsed.timeline)
    ? parsed.timeline.map((entry: any) => ({
        index: Number(entry.index ?? 0),
        role: String(entry.role ?? "assistant") as SessionTimelineItem["role"],
        title: String(entry.title ?? ""),
        detail: entry.detail ? String(entry.detail) : undefined,
      }))
    : undefined;

  const sections: RecapSection[] = [
    {
      type: "outcome",
      markdown: String(parsed.outcome ?? "").trim() || "_(no outcome narrative)_",
    },
  ];
  if (parsed.diagram) {
    sections.push({
      type: "diagram",
      title: String(parsed.diagram.title ?? "Architecture"),
      mermaid: String(parsed.diagram.mermaid ?? ""),
      summary: parsed.diagram.summary ? String(parsed.diagram.summary) : undefined,
    });
  }
  if (timeline && timeline.length > 0) {
    sections.push({ type: "session-timeline", items: timeline });
  }
  sections.push({ type: "file-tree", title: "Changed files", entries: fileMap });
  if (risks.length > 0) {
    sections.push({ type: "review-notes", risks });
  }

  return {
    version: 1,
    kind: "visual-recap",
    source: evidence.source,
    title: String(parsed.title ?? fallback.title).slice(0, 100),
    brief: String(parsed.brief ?? fallback.brief),
    target: fallback.target,
    generatedAt: new Date().toISOString(),
    model,
    sections,
    fileMap,
    keyChanges,
    risks,
    followUps,
    evidence: {
      ...(evidence.source === "git" ? { git: undefined as any } : {}),
      ...(evidence.pr ? { pr: evidence.pr } : {}),
      ...(evidence.session ? { session: evidence.session } : {}),
    },
  };
}

function buildFallbackDocument(
  raw: string,
  fallback: { title: string; brief: string; target: string },
  model: { provider: string; id: string } | undefined,
  evidence: RecapEvidence,
): RecapDocument {
  const sections: RecapSection[] = [
    { type: "outcome", markdown: raw.trim() || "_(model returned no output)_" },
  ];
  if (evidence.fileMap.length > 0) {
    sections.push({ type: "file-tree", title: "Changed files", entries: evidence.fileMap });
  }
  if (evidence.session) {
    const items: SessionTimelineItem[] = evidence.session.turns.slice(0, 12).map((t) => ({
      index: t.index,
      role: t.role as SessionTimelineItem["role"],
      title: t.text.replace(/\s+/g, " ").slice(0, 120),
    }));
    if (items.length > 0) {
      sections.push({ type: "session-timeline", items });
    }
  }
  return {
    version: 1,
    kind: "visual-recap",
    source: evidence.source,
    title: fallback.title,
    brief: fallback.brief,
    target: fallback.target,
    generatedAt: new Date().toISOString(),
    model,
    sections,
    fileMap: evidence.fileMap,
    keyChanges: [],
    risks: [],
    followUps: [],
    evidence: {
      ...(evidence.session ? { session: evidence.session } : {}),
      ...(evidence.pr ? { pr: evidence.pr } : {}),
    },
  };
}

function extractJsonObject(text: string): any | null {
  let trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) trimmed = (fenceMatch[1] ?? "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return tryRepairJson(candidate);
  }
}

function tryRepairJson(input: string): any | null {
  const cleaned = input
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
