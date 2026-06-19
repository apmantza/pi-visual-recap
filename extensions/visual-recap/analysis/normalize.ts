// Normalize git/pr/session evidence into a common shape before AI summarization.
import type {
	ChangedFile,
	FileMapEntry,
	GitEvidence,
	PrEvidence,
	RecapEvidence,
	SessionEvidence,
} from "../schemas.ts";
import { redactSecrets } from "../utils/secret-redactor.ts";

export function evidenceFromGit(evidence: GitEvidence): RecapEvidence {
	const fileDiffs = splitUnifiedDiffByFile(evidence.diffText);
	return {
		source: "git",
		targetLabel: evidence.targetLabel,
		titleHint: `Recap: ${evidence.targetLabel}`,
		fileMap: evidence.files.map((file) => ({
			...toFileMapEntry(file),
			...(fileDiffs.get(file.path) ? { diff: fileDiffs.get(file.path) } : {}),
		})),
		diffText: evidence.diffText,
		commits: evidence.commits,
		files: evidence.files,
		git: evidence,
		metadata: {
			repoRoot: evidence.repoRoot,
			baseRef: evidence.baseRef,
			headRef: evidence.headRef,
		},
	};
}

export function evidenceFromPr(evidence: PrEvidence): RecapEvidence {
	const fileDiffs = splitUnifiedDiffByFile(evidence.diffText);
	return {
		source: "github-pr",
		targetLabel: evidence.targetLabel,
		titleHint: `Recap: ${evidence.title}`,
		fileMap: evidence.files.map((file) => ({
			...toFileMapEntry(file),
			...(fileDiffs.get(file.path) ? { diff: fileDiffs.get(file.path) } : {}),
		})),
		diffText: evidence.diffText,
		commits: evidence.commits,
		files: evidence.files,
		pr: evidence,
		metadata: {
			prNumber: evidence.prNumber,
			url: evidence.url,
			repo: evidence.repoSlug,
			state: evidence.state,
			labels: evidence.labels,
		},
	};
}

export function evidenceFromSession(evidence: SessionEvidence): RecapEvidence {
	const touched = new Map<string, FileMapEntry>();
	for (const t of evidence.touchedFiles) {
		if (t.action !== "write" && t.action !== "edit") continue;
		const existing = touched.get(t.path);
		const additions = t.action === "write" || t.action === "edit" ? 1 : 0;
		const deletions = t.action === "edit" ? 1 : 0;
		if (existing) {
			existing.additions += additions;
			existing.deletions += deletions;
			if (t.diff) existing.diff = joinDiffs(existing.diff, t.diff);
			if (t.action === "write") {
				existing.status = "modified";
				existing.note = t.action;
			}
		} else {
			touched.set(t.path, {
				path: t.path,
				status: t.action === "write" ? "modified" : "touched",
				additions,
				deletions,
				note: t.action,
				...(t.diff ? { diff: t.diff } : {}),
			});
		}
	}
	return {
		source: "pi-session",
		targetLabel: evidence.targetLabel,
		titleHint: evidence.sessionName
			? `Recap: session "${evidence.sessionName}"`
			: "Recap: current Pi session",
		fileMap: Array.from(touched.values()),
		diffText: "",
		commits: [],
		files: [],
		session: evidence,
		metadata: {
			branchLength: evidence.branchLength,
			totalMessages: evidence.totalMessages,
			startedAt: evidence.startedAt,
			endedAt: evidence.endedAt,
		},
	};
}

function splitUnifiedDiffByFile(diffText: string): Map<string, string> {
	const out = new Map<string, string>();
	if (typeof diffText !== "string" || diffText.length === 0) return out;
	let currentPath: string | undefined;
	let current: string[] = [];
	for (const line of diffText.split(/\r?\n/)) {
		const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
		if (header) {
			if (currentPath && current.length > 0)
				out.set(currentPath, redactSecrets(current.join("\n")));
			currentPath = header[2];
			current = [line];
			continue;
		}
		if (currentPath) current.push(line);
	}
	if (currentPath && current.length > 0)
		out.set(currentPath, redactSecrets(current.join("\n")));
	return out;
}

function joinDiffs(existing: string | undefined, next: string): string {
	return existing ? `${existing}\n\n${next}` : next;
}

function toFileMapEntry(file: ChangedFile): FileMapEntry {
	return {
		path: file.path,
		status: file.status,
		additions: file.additions,
		deletions: file.deletions,
	};
}
