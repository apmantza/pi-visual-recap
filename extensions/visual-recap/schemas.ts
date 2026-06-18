// Core types for the visual recap extension.

export type RecapTargetKind =
  | "working-tree"
  | "commit"
  | "range"
  | "branch"
  | "pr"
  | "session";

export type RecapTarget =
  | { kind: "working-tree"; base?: string }
  | { kind: "commit"; ref: string }
  | { kind: "range"; range: string }
  | { kind: "branch"; base: string; head?: string }
  | { kind: "pr"; idOrUrl: string }
  | { kind: "session"; session: "current" | string };

export interface CommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date?: string;
}

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitEvidence {
  repoRoot: string;
  targetLabel: string;
  baseRef?: string;
  headRef?: string;
  commits: CommitSummary[];
  files: ChangedFile[];
  diffText: string;
}

export interface SessionTurn {
  index: number;
  role: "user" | "assistant" | "tool";
  text: string;
  toolCalls?: Array<{ name: string; args: string }>;
  toolResults?: Array<{ name: string; isError: boolean; preview: string }>;
  timestamp?: string;
}

export interface SessionDecision {
  index: number;
  decision: string;
  rationale: string;
}

export interface SessionEvidence {
  sourceKind: "current" | "file";
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  targetLabel: string;
  startedAt?: string;
  endedAt?: string;
  branchLength: number;
  totalMessages: number;
  userPrompts: string[];
  assistantSummaries: string[];
  turns: SessionTurn[];
  toolCalls: Array<{ name: string; count: number }>;
  touchedFiles: Array<{ path: string; action: "read" | "write" | "edit" | "bash" }>;
  decisions: SessionDecision[];
  followUps: string[];
  compactionSummaries: string[];
}

export interface PrEvidence {
  sourceKind: "github-pr";
  repoSlug?: string;
  prNumber?: number;
  url?: string;
  title: string;
  body: string;
  author: string;
  baseRef: string;
  headRef: string;
  state: "open" | "closed" | "merged" | "unknown";
  targetLabel: string;
  commits: CommitSummary[];
  files: ChangedFile[];
  diffText: string;
  labels: string[];
}

export interface RecapEvidence {
  source: "git" | "github-pr" | "pi-session";
  targetLabel: string;
  titleHint: string;
  fileMap: FileMapEntry[];
  diffText: string;
  commits: CommitSummary[];
  files: ChangedFile[];
  session?: SessionEvidence;
  pr?: PrEvidence;
  metadata: Record<string, unknown>;
}

export interface VisualRecapOptions {
  outputDir?: string;
  format?: "md" | "json" | "mdx" | "html" | "all";
  model?: { provider: string; id: string };
  maxDiffBytes?: number;
  maxContextChars?: number;
  openAfterGenerate?: boolean;
  includeEvidence?: boolean;
  fullTree?: boolean;
}

export interface RecapDocument {
  version: 1;
  kind: "visual-recap";
  source: "git" | "github-pr" | "pi-session";
  title: string;
  brief: string;
  target: string;
  generatedAt: string;
  model?: { provider: string; id: string };
  sections: RecapSection[];
  fileMap: FileMapEntry[];
  keyChanges: KeyChange[];
  risks: ReviewRisk[];
  followUps: string[];
  evidence?: {
    git?: GitEvidence;
    pr?: PrEvidence;
    session?: SessionEvidence;
  };
}

export interface FileMapEntry {
  path: string;
  status: ChangedFile["status"] | "touched" | "read";
  additions: number;
  deletions: number;
  note?: string;
}

export interface KeyChange {
  path: string;
  summary: string;
  rationale?: string;
  annotations?: DiffAnnotation[];
}

export interface DiffAnnotation {
  lineRange?: string;
  note: string;
}

export interface ReviewRisk {
  title: string;
  severity: "info" | "low" | "medium" | "high";
  description: string;
}

export interface SessionTimelineItem {
  index: number;
  role: "user" | "assistant" | "tool" | "compaction" | "branch";
  title: string;
  detail?: string;
}

export type RecapSection =
  | { type: "outcome"; markdown: string }
  | { type: "diagram"; title: string; mermaid: string; summary?: string }
  | { type: "file-tree"; title?: string; entries: FileMapEntry[] }
  | { type: "session-timeline"; items: SessionTimelineItem[] }
  | { type: "review-notes"; risks: ReviewRisk[] };
