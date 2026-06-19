// MDX renderer for visual recap documents. Inspired by BuilderIO/agent-native
// block model but standalone — no hosted Plan dependency.
import type { RecapDocument } from "../schemas.ts";

export function renderMdx(doc: RecapDocument): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`title: ${yamlString(doc.title)}`);
	lines.push(`brief: ${yamlString(doc.brief)}`);
	lines.push(`target: ${yamlString(doc.target)}`);
	lines.push(`generatedAt: ${doc.generatedAt}`);
	lines.push(`kind: recap`);
	lines.push(`source: ${doc.source}`);
	if (doc.model) lines.push(`model: ${doc.model.provider}/${doc.model.id}`);
	lines.push("---");
	lines.push("");
	lines.push(`# ${doc.title}`);
	lines.push("");
	lines.push(`> ${doc.brief}`);
	lines.push("");

	for (const section of doc.sections) {
		switch (section.type) {
			case "outcome":
				lines.push("## Summary");
				lines.push("");
				lines.push(section.markdown.trim());
				lines.push("");
				break;
			case "diagram":
				lines.push(`## ${section.title}`);
				lines.push("");
				if (section.summary) {
					lines.push(section.summary);
					lines.push("");
				}
				lines.push(
					"<Diagram chart={`" + escapeTemplate(section.mermaid) + "`} />",
				);
				lines.push("");
				break;
			case "session-usage":
				lines.push("## Tool and token usage");
				lines.push("");
				lines.push(`<SessionUsage usage={${jsonInline(section.usage)}} />`);
				lines.push("");
				break;
			case "file-tree":
				lines.push(`## ${section.title ?? "Changed files"}`);
				lines.push("");
				lines.push(`<FileTree entries={${jsonInline(section.entries)}} />`);
				lines.push("");
				break;
			case "session-timeline":
				lines.push("## Timeline");
				lines.push("");
				lines.push(`<SessionTimeline items={${jsonInline(section.items)}} />`);
				lines.push("");
				break;
			case "review-notes":
				if (section.risks.length === 0) break;
				lines.push("## Review notes");
				lines.push("");
				lines.push(`<ReviewNotes risks={${jsonInline(section.risks)}} />`);
				lines.push("");
				break;
			default: {
				const _exhaustive: never = section;
				throw new Error(`Unsupported recap section: ${String(_exhaustive)}`);
			}
		}
	}

	if (doc.keyChanges.length > 0) {
		lines.push("## Key changes");
		lines.push("");
		lines.push("<KeyChanges>");
		for (const change of doc.keyChanges) {
			lines.push(
				`  <DiffTab file={${jsonInline(change.path)}} summary={${jsonInline(change.summary)}}>`,
			);
			if (change.rationale) {
				lines.push(`    <Rationale>${escapeMdx(change.rationale)}</Rationale>`);
			}
			if (change.annotations && change.annotations.length > 0) {
				lines.push(
					`    <Annotations items={${jsonInline(change.annotations)}} />`,
				);
			}
			lines.push("  </DiffTab>");
		}
		lines.push("</KeyChanges>");
		lines.push("");
	}

	if (doc.followUps.length > 0) {
		lines.push("## Follow-ups");
		lines.push("");
		lines.push(`<FollowUps items={${jsonInline(doc.followUps)}} />`);
		lines.push("");
	}

	return lines.join("\n");
}

function yamlString(value: string): string {
	return `"${value.replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

function jsonInline(value: unknown): string {
	return JSON.stringify(value);
}

function escapeMdx(value: string): string {
	return value.replace(
		/[<>{}]/g,
		(ch) =>
			({ "<": "&lt;", ">": "&gt;", "{": "&#123;", "}": "&#125;" })[ch] ?? ch,
	);
}

function escapeTemplate(value: string): string {
	return value.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
