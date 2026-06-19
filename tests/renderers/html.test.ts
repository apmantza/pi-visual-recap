import { describe, expect, it } from "vitest";
import { renderHtml } from "../../extensions/visual-recap/renderers/html.ts";
import type { RecapDocument } from "../../extensions/visual-recap/schemas.ts";

function doc(overrides: Partial<RecapDocument> = {}): RecapDocument {
	return {
		version: 1,
		kind: "visual-recap",
		source: "git",
		title: "Renderer test",
		brief: "A recap used by renderer tests.",
		target: "HEAD~1..HEAD",
		generatedAt: "2026-06-19T00:00:00.000Z",
		sections: [],
		fileMap: [],
		keyChanges: [],
		risks: [],
		followUps: [],
		...overrides,
	};
}

describe("renderHtml", () => {
	it("renders security metadata and pinned Mermaid loader", () => {
		const html = renderHtml(doc());

		expect(html).toContain("Content-Security-Policy");
		expect(html).toContain("mermaid@10.9.1");
		expect(html).toContain("MERMAID_INTEGRITY");
		expect(html).toContain("script.integrity = MERMAID_INTEGRITY");
	});

	it("defaults missing document fields instead of throwing", () => {
		const html = renderHtml({} as RecapDocument);

		expect(html).toContain("Visual recap");
		expect(html).toContain("unknown target");
	});

	it("defaults optional array fields instead of throwing", () => {
		const partial = {
			version: 1,
			kind: "visual-recap",
			title: "Sparse recap",
			brief: "Sparse",
			target: "working tree",
			generatedAt: "2026-06-19T00:00:00.000Z",
			source: "git",
		} as RecapDocument;

		expect(() => renderHtml(partial)).not.toThrow();
		expect(renderHtml(partial)).toContain("Sparse recap");
	});

	it("renders no-script Mermaid source fallback and bounded delta bars", () => {
		const html = renderHtml(
			doc({
				sections: [
					{
						type: "diagram",
						title: "Flow",
						mermaid: "flowchart TD\n  A-->B",
					},
					{
						type: "file-tree",
						entries: [
							{
								path: "src/example.ts",
								status: "modified",
								additions: 10,
								deletions: 0,
							},
						],
					},
				],
			}),
		);

		expect(html).toContain("<noscript>");
		expect(html).toContain("flowchart TD");
		expect(html).toContain(
			'<h3 class="diagram-title">Interactive Mermaid diagram</h3>',
		);
		expect(html).toContain("width:100%");
		expect(html).toContain("width:0%");
	});

	it("renders tabbed file diffs with one panel per file", () => {
		const html = renderHtml(
			doc({
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/example.ts",
								status: "modified",
								additions: 1,
								deletions: 1,
								diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@\n-old\n+new",
							},
							{
								path: "src/other.ts",
								status: "added",
								additions: 10,
								deletions: 0,
								diff: "--- /dev/null\n+++ b/src/other.ts\n@@\n+new file",
							},
						],
					},
				],
			}),
		);

		expect(html).toContain("file-tabs");
		expect(html).toContain("file-tab-panels");
		expect(html).toContain("file-diff-panel");
		expect(html).toContain("src/example.ts");
		expect(html).toContain("src/other.ts");
		expect(html).toContain("+new");
	});

	it("renders files without diffs as Other files cards", () => {
		const html = renderHtml(
			doc({
				keyChanges: [
					{
						path: "src/with-diff.ts",
						summary: "Updated with diff",
					},
				],
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/with-diff.ts",
								status: "modified",
								additions: 1,
								deletions: 1,
								diff: "--- a/x\n+++ b/x\n@@\n-old\n+new",
							},
							{
								path: "src/no-diff.ts",
								status: "modified",
								additions: 2,
								deletions: 0,
							},
						],
					},
				],
			}),
		);

		expect(html).toContain("file-tabs");
		expect(html).toContain("Other files");
		expect(html).toContain("data-file-card=");
		expect(html).toContain("src/no-diff.ts");
	});

	it("emits ARIA tablist attributes on the file diffs section", () => {
		const html = renderHtml(
			doc({
				keyChanges: [
					{ path: "src/a.ts", summary: "A" },
					{ path: "src/b.ts", summary: "B" },
				],
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/a.ts",
								status: "modified",
								additions: 1,
								deletions: 0,
								diff: "--- a/x\n+++ b/x\n@@\n+new",
							},
							{
								path: "src/b.ts",
								status: "added",
								additions: 5,
								deletions: 0,
								diff: "--- a/x\n+++ b/x\n@@\n+more",
							},
						],
					},
				],
			}),
		);

		expect(html).toContain('role="tablist"');
		expect(html).toContain('aria-selected="true"');
		expect(html).toContain('aria-selected="false"');
		expect(html).toContain('aria-controls="');
		expect(html).toContain('aria-labelledby="');
	});

	it("escapes diff content in the file disclosure", () => {
		const html = renderHtml(
			doc({
				keyChanges: [{ path: "src/example.ts", summary: "x" }],
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/example.ts",
								status: "modified",
								additions: 1,
								deletions: 1,
								diff: 'const greeting = "<script>alert(1)</script>";\n-api_key=sklive_1234567890abcdef',
							},
						],
					},
				],
			}),
		);

		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	it("shows project and repo pills in the hero", () => {
		const html = renderHtml(
			doc({
				project: "pi-visual-recap",
				repoRoot: "/home/user/pi-visual-recap",
			}),
		);
		expect(html).toContain("pi-visual-recap");
		expect(html).toContain("/home/user/pi-visual-recap");
		expect(html).toContain("pill-project");
		expect(html).toContain("pill-repo");
	});

	it("hides the repo pill when repoRoot equals project", () => {
		const html = renderHtml(
			doc({ project: "pi-visual-recap", repoRoot: "pi-visual-recap" }),
		);
		expect(html).toContain("pill-project");
		expect(html).not.toContain("pill-repo");
	});

	it("falls back to all files-with-diffs when keyChanges is empty", () => {
		const html = renderHtml(
			doc({
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/a.ts",
								status: "modified",
								additions: 1,
								deletions: 0,
								diff: "@@ -1 +1 @@\n+added",
							},
							{
								path: "src/b.ts",
								status: "modified",
								additions: 2,
								deletions: 1,
								diff: "@@ -1 +1 @@\n-removed\n+added",
							},
						],
					},
				],
			}),
		);
		// No key changes supplied — fall back to the previous "show every
		// diffed file" behavior so we never silently hide changes.
		expect(html).toMatch(/file-tab-path[^>]*>\s*src\/a\.ts/);
		expect(html).toMatch(/file-tab-path[^>]*>\s*src\/b\.ts/);
		expect(html).not.toContain("Other files");
	});

	it("shows the empty-key-changes note when no file matched the key changes", () => {
		const html = renderHtml(
			doc({
				keyChanges: [{ path: "src/never-matches.ts", summary: "x" }],
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/other.ts",
								status: "modified",
								additions: 1,
								deletions: 0,
								diff: "@@ -1 +1 @@\n+x",
							},
						],
					},
				],
			}),
		);
		expect(html).toContain("No key changes were called out");
		expect(html).toContain("Other files");
	});

	it("highlights diff lines: green for added, red for removed, neutral for context and metadata", () => {
		const html = renderHtml(
			doc({
				keyChanges: [{ path: "src/x.ts", summary: "x" }],
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/x.ts",
								status: "modified",
								additions: 1,
								deletions: 1,
								diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n context\n-removed\n+added",
							},
						],
					},
				],
			}),
		);
		expect(html).toMatch(/<span class="diff-line diff-add">\+added<\/span>/);
		expect(html).toMatch(/<span class="diff-line diff-del">-removed<\/span>/);
		expect(html).toMatch(/<span class="diff-line"> context<\/span>/);
		expect(html).toMatch(/<span class="diff-line diff-meta">--- a\/x<\/span>/);
		expect(html).toMatch(
			/<span class="diff-line diff-meta">\+\+\+ b\/x<\/span>/,
		);
		expect(html).toMatch(
			/<span class="diff-line diff-meta">@@ -1 \+1 @@<\/span>/,
		);
	});

	it("only renders diffs for files listed in keyChanges", () => {
		const html = renderHtml(
			doc({
				keyChanges: [{ path: "src/key.ts", summary: "key change" }],
				sections: [
					{
						type: "file-tree",
						entries: [
							{
								path: "src/key.ts",
								status: "modified",
								additions: 1,
								deletions: 0,
								diff: "@@ -1 +1 @@\n+key line",
							},
							{
								path: "src/other.ts",
								status: "modified",
								additions: 2,
								deletions: 0,
								diff: "@@ -1 +1 @@\n+other line",
							},
						],
					},
				],
			}),
		);
		// src/key.ts gets a diff tab
		expect(html).toMatch(/file-tab-path[^>]*>\s*src\/key\.ts/);
		expect(html).toContain("diff-add");
		// src/other.ts goes to Other files, no tab, no diff body in panel
		expect(html).not.toMatch(/file-tab-path[^>]*>\s*src\/other\.ts/);
		expect(html).toContain("Other files");
	});

	it("highlights diff lines: green for added, red for removed", () => {
		// Covered by "highlights diff lines: green for added, red for removed,
		// neutral for context and metadata" above.
	});

	it("shows dashes for session usage without token metadata", () => {
		const html = renderHtml(
			doc({
				source: "pi-session",
				sections: [
					{
						type: "session-usage",
						usage: {
							userPrompts: 0,
							assistantMessages: 0,
							toolResults: 0,
							totalToolCalls: 0,
							tools: [],
							bash: [],
						},
					},
				],
			}),
		);

		expect(html).toContain("Token usage was not present");
		expect(html).toContain("—</strong><span>Estimated cost");
	});

	it("renders session usage and readable Mermaid overrides", () => {
		const html = renderHtml(
			doc({
				source: "pi-session",
				sections: [
					{
						type: "session-usage",
						usage: {
							userPrompts: 3,
							assistantMessages: 4,
							toolResults: 5,
							totalToolCalls: 6,
							tools: [{ name: "bash", count: 2 }],
							bash: [{ command: "npm test", count: 1 }],
							tokens: {
								input: 10,
								output: 20,
								cacheRead: 30,
								cacheWrite: 40,
								total: 100,
							},
						},
					},
				],
			}),
		);

		expect(html).toContain("Tool and token usage");
		expect(html).toContain("npm test");
		expect(html).toContain("Total tokens");
		expect(html).toContain(".mermaid-canvas svg text");
		expect(html).toContain("fill: var(--fg) !important");
	});

	it("keeps dangerous SVG elements in the client sanitizer blocklist", () => {
		const html = renderHtml(doc());

		expect(html).toContain("iframe, object, embed, link, style");
		expect(html).toContain("animate, animateMotion, animateTransform, set");
		expect(html).toContain("value.includes('javascript:')");
		expect(html).toContain("name.startsWith('on')");
		expect(html).toContain("name === 'style'");
	});
});
