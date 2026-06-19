// Render a RecapDocument as Markdown.
import type {
	FileMapEntry,
	RecapDocument,
	RecapSection,
	SessionTimelineItem,
} from "../schemas.ts";

export function renderMarkdown(doc: RecapDocument): string {
	const lines: string[] = [];
	lines.push(`# ${doc.title}`);
	lines.push("");
	lines.push(`> ${doc.brief}`);
	lines.push("");
	lines.push(
		`**Target:** \`${doc.target}\`  •  **Source:** ${doc.source}  •  **Generated:** ${doc.generatedAt}` +
			(doc.model
				? `  •  **Model:** ${doc.model.provider}/${doc.model.id}`
				: ""),
	);
	lines.push("");

	for (const section of doc.sections) {
		renderSection(lines, section);
	}

	if (doc.keyChanges.length > 0) {
		lines.push("## Key changes");
		lines.push("");
		for (const change of doc.keyChanges) {
			lines.push(`### \`${change.path}\` — ${change.summary}`);
			if (change.rationale) {
				lines.push("");
				lines.push(change.rationale);
			}
			if (change.annotations && change.annotations.length > 0) {
				lines.push("");
				for (const a of change.annotations) {
					if (a.lineRange) {
						lines.push(`- _${a.lineRange}_ — ${a.note}`);
					} else {
						lines.push(`- ${a.note}`);
					}
				}
			}
			lines.push("");
		}
	}

	if (doc.followUps.length > 0) {
		lines.push("## Follow-ups");
		lines.push("");
		for (const f of doc.followUps) lines.push(`- ${f}`);
		lines.push("");
	}

	if (doc.evidence?.git) {
		const g = doc.evidence.git;
		if (g.commits.length > 0) {
			lines.push("## Commits");
			lines.push("");
			for (const c of g.commits) {
				lines.push(
					`- \`${c.shortSha}\` ${c.subject} — _${c.author}_${c.date ? ` (${c.date})` : ""}`,
				);
			}
			lines.push("");
		}
	} else if (doc.evidence?.pr) {
		const pr = doc.evidence.pr;
		lines.push("## PR details");
		lines.push("");
		lines.push(`- **Title:** ${pr.title}`);
		lines.push(`- **Author:** ${pr.author}`);
		lines.push(
			`- **Base:** ${pr.baseRef}  •  **Head:** ${pr.headRef}  •  **State:** ${pr.state}`,
		);
		if (pr.url) lines.push(`- **URL:** ${pr.url}`);
		if (pr.labels.length > 0)
			lines.push(`- **Labels:** ${pr.labels.join(", ")}`);
		if (pr.body) {
			lines.push("");
			lines.push(pr.body);
		}
		lines.push("");
	} else if (doc.evidence?.session) {
		const s = doc.evidence.session;
		lines.push("## Session details");
		lines.push("");
		lines.push(`- **Branch length:** ${s.branchLength} entries`);
		lines.push(`- **Messages:** ${s.totalMessages}`);
		if (s.startedAt) lines.push(`- **Started:** ${s.startedAt}`);
		if (s.endedAt) lines.push(`- **Ended:** ${s.endedAt}`);
		if (s.toolCalls.length > 0) {
			lines.push(
				`- **Tool calls:** ${s.toolCalls.map((t) => `${t.name} (${t.count})`).join(", ")}`,
			);
		}
		if (s.compactionSummaries.length > 0) {
			lines.push("");
			lines.push("### Compaction summaries");
			for (const c of s.compactionSummaries) {
				lines.push(`- ${c.slice(0, 240)}${c.length > 240 ? "…" : ""}`);
			}
		}

		if (s.branches && s.branches.length > 0) {
			lines.push("");
			lines.push("### Branches");
			lines.push("");
			lines.push("| Length | Current | Label | First prompt | Last prompt |");
			lines.push("| --- | --- | --- | --- | --- |");
			for (const b of s.branches) {
				lines.push(
					`| ${b.length} | ${b.leafId ? "✓" : ""} | ${b.label ?? ""} | ${escapeMd(b.firstUserPrompt ?? "")} | ${escapeMd(b.lastUserPrompt ?? "")} |`,
				);
			}
		}

		if (s.split) {
			lines.push("");
			lines.push("### Pre-resume / post-resume split");
			lines.push("");
			if (s.split.previousSessionFile) {
				lines.push(`- **Resumed from:** \`${s.split.previousSessionFile}\``);
			}
			if (s.split.resumedAt) lines.push(`- **Resumed at:** ${s.split.resumedAt}`);
			if (s.split.preResume) {
				const p = s.split.preResume;
				lines.push(
					`- **Pre-resume:** ${p.branchLength} entries, ${p.userPrompts.length} user prompt${p.userPrompts.length === 1 ? "" : "s"}, ${p.touchedFiles.length} file${p.touchedFiles.length === 1 ? "" : "s"} touched, ${p.decisions.length} decision${p.decisions.length === 1 ? "" : "s"}`,
				);
				if (p.userPrompts[0]) {
					lines.push(`  - First prompt: ${escapeMd(p.userPrompts[0])}`);
				}
				if (p.userPrompts.length > 1) {
					lines.push(
						`  - Last prompt (before resume): ${escapeMd(p.userPrompts[p.userPrompts.length - 1] ?? "")}`,
					);
				}
			}
			if (s.split.postResume) {
				const post = s.split.postResume;
				lines.push(
					`- **Post-resume:** ${post.branchLength} entries, ${post.userPrompts.length} user prompt${post.userPrompts.length === 1 ? "" : "s"}, ${post.touchedFiles.length} file${post.touchedFiles.length === 1 ? "" : "s"} touched, ${post.decisions.length} decision${post.decisions.length === 1 ? "" : "s"}`,
				);
				if (post.userPrompts[0]) {
					lines.push(`  - First prompt (after resume): ${escapeMd(post.userPrompts[0])}`);
				}
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

function escapeMd(s: string): string {
	return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderSection(lines: string[], section: RecapSection): void {
	switch (section.type) {
		case "outcome":
			lines.push("## Summary");
			lines.push("");
			lines.push(section.markdown.trim());
			lines.push("");
			return;
		case "diagram":
			lines.push(`## ${section.title}`);
			lines.push("");
			if (section.summary) {
				lines.push(section.summary);
				lines.push("");
			}
			lines.push("```mermaid");
			lines.push(section.mermaid.trim());
			lines.push("```");
			lines.push("");
			return;
		case "file-tree":
			lines.push(`## ${section.title ?? "Changed files"}`);
			lines.push("");
			lines.push(renderFileTable(section.entries));
			lines.push("");
			return;
		case "session-timeline":
			lines.push("## Timeline");
			lines.push("");
			lines.push(renderTimeline(section.items));
			lines.push("");
			return;
		case "review-notes":
			if (section.risks.length === 0) return;
			lines.push("## Review notes");
			lines.push("");
			for (const risk of section.risks) {
				lines.push(
					`- **${risk.severity.toUpperCase()} — ${risk.title}** — ${risk.description}`,
				);
			}
			lines.push("");
			return;
	}
}

function renderFileTable(entries: FileMapEntry[]): string {
	if (entries.length === 0) return "_(no changed files)_";
	const rows: string[] = [];
	rows.push("| Status | File | +/- | Note |");
	rows.push("| --- | --- | --- | --- |");
	for (const e of entries) {
		const status = badgeFor(e.status);
		const delta = `+${e.additions}/-${e.deletions}`;
		rows.push(`| ${status} | \`${e.path}\` | ${delta} | ${e.note ?? ""} |`);
	}
	return rows.join("\n");
}

function renderTimeline(items: SessionTimelineItem[]): string {
	if (items.length === 0) return "_(no timeline items)_";
	return items
		.map((it) => {
			const detail = it.detail ? ` — ${it.detail}` : "";
			return `- **[${it.role}]** ${it.title}${detail}`;
		})
		.join("\n");
}

function badgeFor(status: FileMapEntry["status"]): string {
	switch (status) {
		case "added":
			return "🟢 A";
		case "modified":
			return "🟡 M";
		case "deleted":
			return "🔴 D";
		case "renamed":
			return "🔵 R";
		case "copied":
			return "🟣 C";
		case "touched":
			return "✏️ ·";
		case "read":
			return "👁 R";
		default:
			return "⚪ ?";
	}
}
