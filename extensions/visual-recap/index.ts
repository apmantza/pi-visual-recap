// Pi visual recap command + tool.
import { complete, type Message } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { collectGit } from "./collectors/git.ts";
import { parseTarget } from "./collectors/target.ts";
import {
	buildSystemPrompt,
	buildUserPrompt,
	coerceRecapDocument,
} from "./analysis/prompts.ts";
import { runAi } from "./analysis/pi-ai.ts";
import { mergeConfig, type VisualRecapConfig } from "./config.ts";
import { renderMarkdown } from "./renderers/markdown.ts";
import { renderJson } from "./renderers/json.ts";
import { writeArtifact } from "./output/writer.ts";
import { slugify, timestampSlug, safeJoin } from "./utils/paths.ts";
import type { RecapDocument, VisualRecapOptions } from "./schemas.ts";

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

	if (target.kind === "session" || target.kind === "pr") {
		throw new Error(
			`Target kind "${target.kind}" is not implemented yet. Use commit, range, branch, or working tree.`,
		);
	}

	const evidence = await collectGit(target, {
		cwd: ctx.cwd,
		signal: ctx.signal,
		maxDiffBytes: merged.maxDiffBytes,
	});

	const fallbackTitle = `Recap: ${evidence.targetLabel}`;
	const fallbackBrief = describeTarget(
		evidence.targetLabel,
		evidence.files.length,
		evidence.commits.length,
	);

	if (evidence.files.length === 0 && !evidence.diffText.trim()) {
		throw new Error(
			`No changes detected for ${evidence.targetLabel}. Try a different range or working tree.`,
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
			title: fallbackTitle,
			brief: fallbackBrief,
			target: evidence.targetLabel,
		},
		model,
		evidence,
	);

	const slug = `${slugify(evidence.targetLabel)}-${timestampSlug()}`;
	const baseDir = safeJoin(ctx.cwd, merged.outputDir);

	const files: Record<string, string> = {};
	if (merged.format === "md" || merged.format === "all") {
		files["recap.md"] = renderMarkdown(document);
	}
	if (merged.format === "json" || merged.format === "all") {
		files["recap.json"] = renderJson(document);
	}

	const evidenceFiles: Record<string, string> = {};
	if (merged.includeEvidence) {
		evidenceFiles["diff.patch"] = evidence.diffText || "(no diff captured)";
		evidenceFiles["files.json"] = JSON.stringify(evidence.files, null, 2);
		evidenceFiles["commits.json"] = JSON.stringify(evidence.commits, null, 2);
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

export function describeTarget(
	label: string,
	files: number,
	commits: number,
): string {
	if (commits > 0) {
		return `${commits} commit${commits === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"} changed (${label})`;
	}
	return `${files} file${files === 1 ? "" : "s"} changed in ${label}`;
}

function detectDefaultBranch(ctx: ExtensionCommandContext): string {
	// Could be smarter (read from origin/HEAD), but "main" is a safe default.
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
				StringEnum(["md", "json", "all"] as const, {
					description: "Output format. Defaults to all (md + json).",
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

// Re-export to keep the bundle minimal.
export { complete };
