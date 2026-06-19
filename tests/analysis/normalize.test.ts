import { describe, expect, it } from "vitest";
import {
	evidenceFromGit,
	evidenceFromSession,
} from "../../extensions/visual-recap/analysis/normalize.ts";
import type {
	GitEvidence,
	SessionEvidence,
} from "../../extensions/visual-recap/schemas.ts";

describe("evidence normalization", () => {
	it("keeps only changed session files and preserves edit-style diffs", () => {
		const session: SessionEvidence = {
			sourceKind: "current",
			targetLabel: "current Pi session",
			branchLength: 3,
			totalMessages: 2,
			userPrompts: [],
			assistantSummaries: [],
			turns: [],
			toolCalls: [],
			touchedFiles: [
				{ path: "README.md", action: "read" },
				{ path: "ls -la", action: "bash" },
				{
					path: "src/example.ts",
					action: "edit",
					diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@\n-old\n+new",
				},
			],
			decisions: [],
			compactionSummaries: [],
		};

		const evidence = evidenceFromSession(session);

		expect(evidence.fileMap).toEqual([
			expect.objectContaining({
				path: "src/example.ts",
				status: "touched",
				diff: expect.stringContaining("+new"),
			}),
		]);
	});

	it("attaches per-file unified diffs to git file map entries", () => {
		const git: GitEvidence = {
			targetLabel: "HEAD~1..HEAD",
			repoRoot: "/repo",
			diffText:
				"diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new\n" +
				"diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@\n-x\n+y",
			files: [
				{
					path: "src/a.ts",
					status: "modified",
					additions: 1,
					deletions: 1,
					binary: false,
				},
				{
					path: "src/b.ts",
					status: "modified",
					additions: 1,
					deletions: 1,
					binary: false,
				},
			],
			commits: [],
		};

		const evidence = evidenceFromGit(git);

		expect(evidence.fileMap[0].diff).toContain("src/a.ts");
		expect(evidence.fileMap[0].diff).not.toContain("src/b.ts");
		expect(evidence.fileMap[1].diff).toContain("src/b.ts");
	});
});
