// Pi visual recap command + tool.
import { type Message, complete } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	evidenceFromGit,
	evidenceFromPr,
	evidenceFromSession,
} from "./analysis/normalize.ts";
import { runAi } from "./analysis/pi-ai.ts";
import {
	buildSystemPrompt,
	buildUserPrompt,
	coerceRecapDocument,
} from "./analysis/prompts.ts";
import { collectGit } from "./collectors/git.ts";
import { collectPr } from "./collectors/github.ts";
import { collectSession } from "./collectors/pi-session.ts";
import { parseTarget } from "./collectors/target.ts";
import { type VisualRecapConfig, mergeConfig } from "./config.ts";
import { writeArtifact } from "./output/writer.ts";
import { renderHtml } from "./renderers/html.ts";
import { renderJson } from "./renderers/json.ts";
import { renderMarkdown } from "./renderers/markdown.ts";
import { renderMdx } from "./renderers/mdx.ts";
import type {
	RecapDocument,
	RecapEvidence,
	RecapTarget,
	VisualRecapOptions,
} from "./schemas.ts";
import { basenameOf, safeJoin, slugify, timestampSlug } from "./utils/paths.ts";
import { redactSecrets } from "./utils/secret-redactor.ts";

const COMMAND_NAME = "visual-recap";
const TOOL_NAME = "visual_recap";

export interface GenerateRecapResult {
	document: RecapDocument;
	artifactDir: string;
	written: string[];
}

export async function generateRecap(
	rawArgs: string,
	cliOptions: VisualRecapOptions,
	ctx: ExtensionCommandContext,
): Promise<GenerateRecapResult> {
	const fileConfig = await readProjectConfig(ctx);
	const merged = mergeConfig(fileConfig, cliOptions);

	const target = parseTarget(rawArgs, {
		defaultBranch: detectDefaultBranch(ctx),
	});

	if (ctx.hasUI) {
		ctx.ui.notify(`Collecting evidence for ${target.kind}…`, "info");
	}

	const evidence = await collectEvidence(target, ctx, merged);

	if (isEvidenceEmpty(evidence)) {
		throw new Error(
			`No changes detected for ${targetLabelFor(target)}. ` +
				`Try a different range, commit, branch, or session. ` +
				`For PRs, confirm the PR exists and that \`gh\` is authed.`,
		);
	}

	if (ctx.hasUI) {
		ctx.ui.notify("Generating visual recap…", "info");
	}

	const messages: Message[] = [
		{
			role: "user",
			content: [{ type: "text", text: buildSystemPrompt() }],
			timestamp: Date.now(),
		},
		{
			role: "user",
			content: [
				{ type: "text", text: buildUserPrompt(evidence, evidence.targetLabel) },
			],
			timestamp: Date.now(),
		},
	];

	const { text, model } = await runAi({
		ctx,
		...(merged.model ? { modelOverride: merged.model } : {}),
		messages,
		maxTokens: 4096,
		...(ctx.signal ? { signal: ctx.signal } : {}),
	});

	const document = coerceRecapDocument(
		text,
		{
			title: evidence.titleHint,
			brief: fallbackBrief(evidence),
			target: evidence.targetLabel,
			project: basenameOf(ctx.cwd),
			repoRoot: evidence.source === "git" ? evidence.git?.repoRoot : undefined,
		},
		model,
		evidence,
	);

	const slug = `${slugify(evidence.targetLabel)}-${timestampSlug()}`;
	const baseDir = safeJoin(ctx.cwd, merged.outputDir);

	const files: Record<string, string> = {};
	const format = merged.format;
	if (format === "md" || format === "all")
		files["recap.md"] = renderMarkdown(document);
	if (format === "json" || format === "all")
		files["recap.json"] = renderJson(document);
	if (format === "mdx" || format === "all")
		files["recap.mdx"] = renderMdx(document);
	if (format === "html" || format === "all")
		files["index.html"] = renderHtml(document);

	const evidenceFiles: Record<string, string> = {};
	if (merged.includeEvidence) {
		if (evidence.source === "git" || evidence.source === "github-pr") {
			evidenceFiles["diff.patch"] = redactSecrets(
				evidence.diffText || "(no diff captured)",
			);
			evidenceFiles["files.json"] = JSON.stringify(
				redactSecrets(JSON.stringify(evidence.fileMap, null, 2)),
				null,
				2,
			);
			if (evidence.commits.length > 0) {
				evidenceFiles["commits.json"] = JSON.stringify(
					redactSecrets(JSON.stringify(evidence.commits, null, 2)),
					null,
					2,
				);
			}
		}
		if (evidence.source === "github-pr" && evidence.pr) {
			evidenceFiles["pr.json"] = JSON.stringify(
				redactSecrets(JSON.stringify(evidence.pr, null, 2)),
				null,
				2,
			);
		}
		if (evidence.source === "pi-session" && evidence.session) {
			evidenceFiles["session.json"] = JSON.stringify(
				redactSecrets(JSON.stringify(evidence.session, null, 2)),
				null,
				2,
			);
		}
	}

	const writeResult = await writeArtifact({
		baseDir,
		slug,
		files,
		...(Object.keys(evidenceFiles).length > 0 ? { evidenceFiles } : {}),
	});

	return {
		document,
		artifactDir: writeResult.dir,
		written: writeResult.written,
	};
}

async function collectEvidence(
	target: RecapTarget,
	ctx: ExtensionCommandContext,
	merged: ReturnType<typeof mergeConfig>,
): Promise<RecapEvidence> {
	switch (target.kind) {
		case "working-tree":
		case "commit":
		case "range":
		case "branch": {
			const evidence = await collectGit(target, {
				cwd: ctx.cwd,
				signal: ctx.signal,
				maxDiffBytes: merged.maxDiffBytes,
			});
			return evidenceFromGit(evidence);
		}
		case "pr": {
			const evidence = await collectPr(target, {
				cwd: ctx.cwd,
				signal: ctx.signal,
				maxDiffBytes: merged.maxDiffBytes,
			});
			return evidenceFromPr(evidence);
		}
		case "session": {
			const evidence = await collectSession({
				ctx,
				session: target.session,
				...(target.forkAt ? { forkAt: target.forkAt } : {}),
			});
			return evidenceFromSession(evidence);
		}
	}
}

function isEvidenceEmpty(evidence: RecapEvidence): boolean {
	if (evidence.source === "pi-session") {
		const s = evidence.session!;
		return (
			s.branchLength === 0 || (s.totalMessages === 0 && s.turns.length === 0)
		);
	}
	return evidence.fileMap.length === 0 && !evidence.diffText.trim();
}

function targetLabelFor(target: RecapTarget): string {
	switch (target.kind) {
		case "working-tree":
			return `working tree${target.base ? ` vs ${target.base}` : ""}`;
		case "commit":
			return `commit ${target.ref}`;
		case "range":
			return target.range;
		case "branch":
			return `${target.base}..${target.head ?? "HEAD"}`;
		case "pr":
			return `PR ${target.idOrUrl}`;
		case "session": {
			if (target.session === "tree") return "current Pi session (full tree)";
			if (target.session === "current")
				return target.forkAt
					? `current Pi session up to entry ${target.forkAt.slice(0, 12)}`
					: "current Pi session";
			return `session ${target.session}`;
		}
	}
}

function fallbackBrief(evidence: RecapEvidence): string {
	if (evidence.source === "pi-session") {
		const s = evidence.session!;
		return `Recap of ${s.userPrompts.length} user message${s.userPrompts.length === 1 ? "" : "s"} across ${s.branchLength} entr${s.branchLength === 1 ? "y" : "ies"}.`;
	}
	const files = evidence.fileMap.length;
	const commits = evidence.commits.length;
	return `${commits} commit${commits === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"} changed (${evidence.targetLabel})`;
}

function detectDefaultBranch(ctx: ExtensionCommandContext): string {
	void ctx;
	return "main";
}

async function readProjectConfig(
	ctx: ExtensionCommandContext,
): Promise<VisualRecapConfig | undefined> {
	if (!ctx.isProjectTrusted()) return undefined;
	const { readConfigFile } = await import("./config-file.ts");
	return readConfigFile(ctx.cwd);
}

export function registerVisualRecapCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description:
			"Create a visual recap for a commit, range, branch, PR, or Pi session",
		handler: async (args, ctx) => {
			try {
				const result = await generateRecap(args, {}, ctx);
				const message = `Wrote ${result.written.length} file(s) to ${result.artifactDir}`;
				if (ctx.hasUI) ctx.ui.notify(message, "info");
				ctx.ui.setStatus("visual-recap", result.document.title);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (ctx.hasUI)
					ctx.ui.notify(`Visual recap failed: ${message}`, "error");
			}
		},
	});
}

export function registerVisualRecapTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Visual Recap",
		description:
			"Generate a visual recap for a git target, GitHub PR, or Pi session. Use when the user asks for a review-ready summary of changes.",
		promptSnippet: "Generate a visual recap for the current change",
		promptGuidelines: [
			`Use ${TOOL_NAME} when the user asks for a visual recap, a review summary of a diff, or an overview of a branch / commit / PR / Pi session.`,
			`Prefer ${TOOL_NAME} over writing inline summaries; the recap is a written artifact, not a chat response.`,
		],
		parameters: Type.Object({
			target: Type.String({
				description:
					"Target spec, e.g. HEAD~1..HEAD, abc123, main, 'pr 42', or 'session current'. Empty means working tree.",
			}),
			format: Type.Optional(
				StringEnum(["md", "json", "mdx", "html", "all"] as const, {
					description:
						"Output format. Defaults to all (md + json + mdx + html).",
				}),
			),
			outputDir: Type.Optional(
				Type.String({
					description:
						"Output directory relative to cwd. Defaults to .visual-recaps",
				}),
			),
			maxDiffBytes: Type.Optional(
				Type.Number({
					description:
						"Cap on diff text sent to the model (bytes). Defaults to 750_000.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			try {
				const result = await generateRecap(
					params.target ?? "",
					params,
					ctx as ExtensionCommandContext,
				);
				const summary = `Wrote recap to ${result.artifactDir} (${result.written.length} file${result.written.length === 1 ? "" : "s"})`;
				const details = {
					artifactDir: result.artifactDir,
					title: result.document.title,
					brief: result.document.brief,
					keyChanges: result.document.keyChanges.length,
					risks: result.document.risks.length,
				};
				if (onUpdate)
					onUpdate({ content: [{ type: "text", text: summary }], details });
				return {
					content: [
						{
							type: "text",
							text: `${summary}\n\nTitle: ${result.document.title}\nBrief: ${result.document.brief}`,
						},
					],
					details,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Visual recap failed: ${message}` }],
					details: { error: message },
					isError: true,
				};
			}
		},
	});
}

export { complete };
