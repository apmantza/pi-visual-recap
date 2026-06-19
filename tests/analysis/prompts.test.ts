import { describe, expect, it } from "vitest";
import { coerceRecapDocument } from "../../extensions/visual-recap/analysis/prompts.ts";
import type {
	GitEvidence,
	RecapEvidence,
} from "../../extensions/visual-recap/schemas.ts";

function gitEvidence(): RecapEvidence {
	const git: GitEvidence = {
		targetLabel: "HEAD~1..HEAD",
		repoRoot: "/home/user/repo",
		baseRef: "HEAD~1",
		headRef: "HEAD",
		commits: [],
		files: [
			{
				path: "src/a.ts",
				status: "modified",
				additions: 1,
				deletions: 0,
				binary: false,
			},
		],
		diffText: "@@ -1 +1 @@\n+added",
	};
	return {
		source: "git",
		targetLabel: "HEAD~1..HEAD",
		titleHint: "Recap: HEAD~1..HEAD",
		fileMap: git.files.map((f) => ({ ...f })),
		diffText: git.diffText,
		commits: [],
		files: git.files,
		git,
		metadata: {
			repoRoot: git.repoRoot,
			baseRef: git.baseRef,
			headRef: git.headRef,
		},
	};
}

describe("coerceRecapDocument fallback propagation", () => {
	it("propagates project and repoRoot from fallback when raw LLM output is unparseable", () => {
		const doc = coerceRecapDocument(
			"not json at all",
			{
				title: "Fallback title",
				brief: "Fallback brief",
				target: "HEAD~1..HEAD",
				project: "pi-visual-recap",
				repoRoot: "/home/user/pi-visual-recap",
			},
			undefined,
			gitEvidence(),
		);
		expect(doc.project).toBe("pi-visual-recap");
		expect(doc.repoRoot).toBe("/home/user/pi-visual-recap");
		expect(doc.title).toBe("Fallback title");
	});

	it("propagates project and repoRoot from fallback when raw LLM output is parseable", () => {
		const doc = coerceRecapDocument(
			JSON.stringify({
				title: "Parsed title",
				brief: "Parsed brief",
				outcome: "Parsed outcome",
				keyChanges: [],
				risks: [],
				followUps: [],
				fileMap: [],
			}),
			{
				title: "Fallback title",
				brief: "Fallback brief",
				target: "HEAD~1..HEAD",
				project: "pi-visual-recap",
				repoRoot: "/home/user/pi-visual-recap",
			},
			undefined,
			gitEvidence(),
		);
		expect(doc.project).toBe("pi-visual-recap");
		expect(doc.repoRoot).toBe("/home/user/pi-visual-recap");
		expect(doc.title).toBe("Parsed title"); // LLM-supplied title wins
	});

	it("omits project and repoRoot when fallback does not supply them", () => {
		const doc = coerceRecapDocument(
			"not json",
			{ title: "t", brief: "b", target: "x" },
			undefined,
			gitEvidence(),
		);
		expect(doc.project).toBeUndefined();
		expect(doc.repoRoot).toBeUndefined();
	});
});
