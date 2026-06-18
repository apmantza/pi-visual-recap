// Build the prompts used for visual recap generation.
import type { GitEvidence, RecapDocument } from "../schemas.ts";

export function buildSystemPrompt(): string {
	return [
		"You are a senior code reviewer writing a visual recap of a code change for a human reviewer.",
		"",
		"Goals:",
		"- Give a reviewer the SHAPE of the change at high altitude before they read raw diffs.",
		"- Be specific. Cite file paths, function names, contract changes, and risks grounded in the diff.",
		"- Avoid filler. No 'this is a recap' or 'please review carefully' prose.",
		"- Use the same structured JSON shape described in the user message.",
		"- If the diff is small, keep sections tight. If it is large, still keep the recap reviewable.",
		"",
		"Tone: terse, technical, evidence-based.",
	].join("\n");
}

export function buildUserPrompt(
	evidence: GitEvidence,
	targetLabel: string,
): string {
	return [
		`Target: ${targetLabel}`,
		`Repository: ${evidence.repoRoot}`,
		`Base ref: ${evidence.baseRef ?? "(none)"}`,
		`Head ref: ${evidence.headRef ?? "(working tree)"}`,
		`Commits in scope: ${evidence.commits.length}`,
		`Changed files: ${evidence.files.length}`,
		"",
		"Changed file list (path, status, +additions/-deletions):",
		evidence.files.length > 0
			? evidence.files
					.map(
						(f) => `- ${f.path}  [${f.status}] +${f.additions}/-${f.deletions}`,
					)
					.join("\n")
			: "(no changed files detected)",
		"",
		"Commits:",
		evidence.commits.length > 0
			? evidence.commits
					.map((c) => `- ${c.shortSha} ${c.subject} (${c.author})`)
					.join("\n")
			: "(no commit log available)",
		"",
		"Diff (truncated to context budget; full diff saved alongside recap):",
		"```diff",
		evidence.diffText || "(no diff content)",
		"```",
		"",
		"Return ONLY a JSON object matching this TypeScript shape (no commentary, no markdown fences):",
		"",
		"```ts",
		"interface Output {",
		"  title: string;          // <= 70 chars",
		"  brief: string;          // 1-3 sentences",
		"  outcome: string;        // 1-3 paragraphs of what changed and why",
		"  fileMap: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown'; additions: number; deletions: number; note?: string }>;",
		"  keyChanges: Array<{ path: string; summary: string; rationale?: string; annotations?: Array<{ lineRange?: string; note: string }> }>;",
		"  risks: Array<{ title: string; severity: 'info' | 'low' | 'medium' | 'high'; description: string }>;",
		"  followUps: string[];",
		"  diagram?: { title: string; mermaid: string; summary?: string };",
		"}",
		"```",
		"",
		"Constraints:",
		"- Use 3-8 keyChanges (more only if the change is genuinely multi-area).",
		"- Do not invent files. Only reference paths from the changed file list or the diff.",
		"- Skip diagram if you cannot draw a meaningful one.",
		"- Output JSON object directly, no prose around it.",
	].join("\n");
}

export function coerceRecapDocument(
	raw: string,
	fallback: { title: string; brief: string; target: string },
	model: { provider: string; id: string } | undefined,
	evidence: GitEvidence,
): RecapDocument {
	const parsed = extractJsonObject(raw);
	if (!parsed) {
		return buildFallbackDocument(raw, fallback, model, evidence);
	}
	const fileMap = Array.isArray(parsed.fileMap)
		? parsed.fileMap.map((entry: any) => ({
				path: String(entry.path ?? ""),
				status: (entry.status as any) ?? "modified",
				additions: Number(entry.additions ?? 0),
				deletions: Number(entry.deletions ?? 0),
				note: entry.note ? String(entry.note) : undefined,
			}))
		: evidence.files.map((f) => ({
				path: f.path,
				status: f.status,
				additions: f.additions,
				deletions: f.deletions,
			}));
	const keyChanges = Array.isArray(parsed.keyChanges)
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
	const risks = Array.isArray(parsed.risks)
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

	return {
		version: 1,
		kind: "visual-recap",
		title: String(parsed.title ?? fallback.title).slice(0, 100),
		brief: String(parsed.brief ?? fallback.brief),
		target: fallback.target,
		generatedAt: new Date().toISOString(),
		model,
		sections: [
			{
				type: "outcome",
				markdown:
					String(parsed.outcome ?? "").trim() || "_(no outcome narrative)_",
			},
			...(parsed.diagram
				? [
						{
							type: "diagram" as const,
							title: String(parsed.diagram.title ?? "Architecture"),
							mermaid: String(parsed.diagram.mermaid ?? ""),
							summary: parsed.diagram.summary
								? String(parsed.diagram.summary)
								: undefined,
						},
					]
				: []),
			{ type: "file-tree", title: "Changed files", entries: fileMap },
			{ type: "review-notes", risks },
		],
		fileMap,
		keyChanges,
		risks,
		followUps,
		evidence: { git: evidence },
	};
}

function buildFallbackDocument(
	raw: string,
	fallback: { title: string; brief: string; target: string },
	model: { provider: string; id: string } | undefined,
	evidence: GitEvidence,
): RecapDocument {
	return {
		version: 1,
		kind: "visual-recap",
		title: fallback.title,
		brief: fallback.brief,
		target: fallback.target,
		generatedAt: new Date().toISOString(),
		model,
		sections: [
			{
				type: "outcome",
				markdown: raw.trim() || "_(model returned no output)_",
			},
			{
				type: "file-tree",
				title: "Changed files",
				entries: evidence.files.map((f) => ({
					path: f.path,
					status: f.status,
					additions: f.additions,
					deletions: f.deletions,
				})),
			},
		],
		fileMap: evidence.files.map((f) => ({
			path: f.path,
			status: f.status,
			additions: f.additions,
			deletions: f.deletions,
		})),
		keyChanges: [],
		risks: [],
		followUps: [],
		evidence: { git: evidence },
	};
}

function extractJsonObject(text: string): any | null {
	// Strip code fences if present.
	let trimmed = text.trim();
	const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	if (fenceMatch) {
		trimmed = fenceMatch[1]?.trim() ?? trimmed;
	}
	// Find the first { ... } top-level JSON object.
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
	// Very light repair: remove trailing commas before ] or } and try again.
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
