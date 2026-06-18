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
	| { kind: "range"; range: string; base?: string; head?: string }
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

export interface VisualRecapOptions {
	outputDir?: string;
	format?: "md" | "json" | "all";
	model?: { provider: string; id: string };
	maxDiffBytes?: number;
	openAfterGenerate?: boolean;
	includeEvidence?: boolean;
}

export interface RecapDocument {
	version: 1;
	kind: "visual-recap";
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
	};
}

export interface FileMapEntry {
	path: string;
	status: ChangedFile["status"];
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

export type RecapSection =
	| { type: "outcome"; markdown: string }
	| { type: "diagram"; title: string; mermaid: string; summary?: string }
	| { type: "file-tree"; title?: string; entries: FileMapEntry[] }
	| { type: "review-notes"; risks: ReviewRisk[] };
