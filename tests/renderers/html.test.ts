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
		expect(html).toContain('<h3 class="diagram-title">Interactive Mermaid diagram</h3>');
		expect(html).toContain("width:100%");
		expect(html).toContain("width:0%");
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
