// Normalize git/pr/session evidence into a common shape before AI summarization.
import type {
	ChangedFile,
	FileMapEntry,
	GitEvidence,
	PrEvidence,
	RecapEvidence,
	SessionEvidence,
} from "../schemas.ts";

export function evidenceFromGit(evidence: GitEvidence): RecapEvidence {
	return {
		source: "git",
		targetLabel: evidence.targetLabel,
		titleHint: `Recap: ${evidence.targetLabel}`,
		fileMap: evidence.files.map(toFileMapEntry),
		diffText: evidence.diffText,
		commits: evidence.commits,
		files: evidence.files,
		metadata: {
			repoRoot: evidence.repoRoot,
			baseRef: evidence.baseRef,
			headRef: evidence.headRef,
		},
	};
}

export function evidenceFromPr(evidence: PrEvidence): RecapEvidence {
	return {
		source: "github-pr",
		targetLabel: evidence.targetLabel,
		titleHint: `Recap: ${evidence.title}`,
		fileMap: evidence.files.map(toFileMapEntry),
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
		const existing = touched.get(t.path);
		const additions = t.action === "write" || t.action === "edit" ? 1 : 0;
		const deletions = t.action === "edit" ? 1 : 0;
		if (existing) {
			existing.additions += additions;
			existing.deletions += deletions;
			// Promote the status: write > edit > read.
			if (t.action === "write") {
				existing.status = "modified";
				existing.note = t.action;
			} else if (t.action === "edit" && existing.status === "read") {
				existing.status = "touched";
				existing.note = t.action;
			}
		} else {
			touched.set(t.path, {
				path: t.path,
				status: t.action === "read" ? "read" : "touched",
				additions,
				deletions,
				note: t.action,
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

function toFileMapEntry(file: ChangedFile): FileMapEntry {
	return {
		path: file.path,
		status: file.status,
		additions: file.additions,
		deletions: file.deletions,
	};
}
