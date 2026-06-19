// Pi session evidence collector.
import * as path from "node:path";
import { existsSync } from "node:fs";
import {
	generateUnifiedPatch,
	SessionManager,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	detectToolKind,
	isToolResultError,
	summarizeToolArgs,
	summarizeToolResult,
} from "./tool-summary.ts";
import { redactSecrets } from "../utils/secret-redactor.ts";
import type {
	SessionBranchSummary,
	SessionDecision,
	SessionEvidence,
	SessionTimelineItem,
	SessionTurn,
	SessionUsageSummary,
} from "../schemas.ts";

export const RESUME_MARKER_TYPE = "visual-recap:resume-from";

export type SessionTarget = "current" | "tree" | string;

export interface CollectSessionOptions {
	ctx: ExtensionContext;
	session: SessionTarget;
	forkAt?: string;
}

interface AssistantLike {
	role: string;
	content: unknown;
	timestamp?: string | number | Date;
	usage?: unknown;
}

interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
}

export async function collectSession(
	options: CollectSessionOptions,
): Promise<SessionEvidence> {
	const { ctx, session, forkAt } = options;

	const sm =
		session === "current" || session === "tree"
			? ctx.sessionManager
			: openSessionFile(session, ctx);

	const sessionFile = sm.getSessionFile();
	const sessionId = sm.getSessionId();
	const sessionName = sm.getSessionName?.();

	let branch: SessionEntry[] = sm.getBranch();
	let targetLabel: string;
	let sourceKind: SessionEvidence["sourceKind"];

	if (session === "tree") {
		targetLabel = "current Pi session (full tree)";
		sourceKind = "tree";
	} else if (session === "current") {
		targetLabel = "current Pi session";
		sourceKind = "current";
	} else {
		targetLabel = `session ${shortSessionLabel(session, sessionId)}`;
		sourceKind = "file";
	}

	if (forkAt) {
		branch = truncateBranchAt(branch, forkAt);
		if (branch.length === 0) {
			throw new Error(`No branch entries found up to entry ${forkAt}`);
		}
		targetLabel = `${targetLabel} (fork at ${forkAt.slice(0, 12)})`;
	}

	// Walk the whole branch once for the top-level evidence.
	const fullWalk = walkBranch(branch);

	// Pre-resume split: when a resume marker is present, the entries BEFORE
	// the marker are the pre-resume half; entries AFTER (and including) the
	// marker are the post-resume half. Note the marker is the first entry of
	// the new session that pi writes on session_start, so post-resume starts
	// AT the marker.
	let split: SessionEvidence["split"];
	if (session === "current" || session === "tree") {
		const marker = findResumeMarker(branch);
		if (marker) {
			const markerIdx = branch.findIndex((e) => e.id === marker.entryId);
			if (markerIdx !== -1) {
				const preResumeEntries = branch.slice(0, markerIdx);
				const postResumeEntries = branch.slice(markerIdx);
				split = {
					previousSessionFile: marker.previousSessionFile,
					resumedAt: marker.timestamp,
					preResume: walkToEvidence(
						walkBranch(preResumeEntries),
						preResumeEntries.length,
						`pre-resume (resumed from ${marker.previousSessionFile ?? "previous session"})`,
					),
					postResume: walkToEvidence(
						walkBranch(postResumeEntries),
						postResumeEntries.length,
						"post-resume (this session)",
					),
				};
			}
		}
	}

	let branches: SessionBranchSummary[] | undefined;
	if (session === "tree") {
		branches = summariseTree(sm.getTree(), sm.getLeafId());
	}

	return {
		sourceKind,
		sessionFile,
		sessionId,
		sessionName: sessionName ?? undefined,
		targetLabel,
		startedAt: fullWalk.startedAt,
		endedAt: fullWalk.endedAt,
		branchLength: branch.length,
		totalMessages: fullWalk.totalMessages,
		userPrompts: fullWalk.userPrompts,
		assistantSummaries: fullWalk.assistantSummaries,
		turns: fullWalk.turns,
		toolCalls: fullWalk.toolCalls,
		usage: fullWalk.usage,
		touchedFiles: fullWalk.touchedFiles,
		decisions: fullWalk.decisions,
		compactionSummaries: fullWalk.compactionSummaries,
		...(branches ? { branches } : {}),
		...(split ? { split } : {}),
	};
}

/**
 * Open a session file by path, with a path-traversal guard.
 *
 * The path must point to a file inside the agent's session directory
 * (resolved via the `SessionManager` defaults) or be an existing absolute
 * path to a regular file. Relative paths are resolved against `ctx.cwd`.
 * Reject parent traversal (`..`) and ensure the resolved path is real.
 */
function openSessionFile(
	rawPath: string,
	ctx: ExtensionContext,
): SessionManager {
	const resolved = resolveSessionPath(rawPath, ctx);
	if (!resolved) {
		throw new Error(
			`Session path "${rawPath}" is not allowed. Pass an absolute path inside the agent's session directory, or a relative path under the current working directory.`,
		);
	}
	try {
		return SessionManager.open(resolved, undefined, ctx.cwd);
	} catch (err) {
		// The user already supplied this path, but the rethrown error
		// might land in a log context shared with other extensions. Use
		// only the basename in the user-facing message.
		const message = err instanceof Error ? err.message : String(err);
		const baseName = resolved.replace(/^.*[\\/]/, "") || resolved;
		throw new Error(`Failed to open session file ${baseName}: ${message}`);
	}
}

function resolveSessionPath(
	rawPath: string,
	ctx: ExtensionContext,
): string | null {
	if (!rawPath || rawPath.includes("\0")) return null;
	// Reject obvious traversal segments anywhere in the path.
	const segments = rawPath.split(/[\\/]+/);
	if (segments.some((s) => s === "..")) return null;

	const absolute = path.isAbsolute(rawPath)
		? path.normalize(rawPath)
		: path.resolve(ctx.cwd, rawPath);

	// Must be a real file.
	if (!existsSync(absolute)) return null;

	// Prefer paths inside the agent's session dir, but allow absolute paths
	// that the user explicitly typed (e.g. a session they saved elsewhere).
	// The main defence is the ".."-segment rejection + must-exist check.
	return absolute;
}

interface BranchWalk {
	turns: SessionTurn[];
	decisions: SessionDecision[];
	compactionSummaries: string[];
	timeline: SessionTimelineItem[];
	toolCalls: Array<{ name: string; count: number }>;
	touchedFiles: SessionEvidence["touchedFiles"];
	userPrompts: string[];
	assistantSummaries: string[];
	usage: SessionUsageSummary;
	startedAt?: string;
	endedAt?: string;
	totalMessages: number;
}

function walkBranch(branch: SessionEntry[]): BranchWalk {
	const turns: SessionTurn[] = [];
	const decisions: SessionDecision[] = [];
	const compactionSummaries: string[] = [];
	const timeline: SessionTimelineItem[] = [];
	const toolCallCounts = new Map<string, number>();
	const bashCallCounts = new Map<string, number>();
	const usageTokens = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
		cost: 0,
	};
	const touchedFiles: SessionEvidence["touchedFiles"] = [];
	const userPrompts: string[] = [];
	const assistantSummaries: string[] = [];
	let startedAt: string | undefined;
	let endedAt: string | undefined;
	let totalMessages = 0;
	let assistantMessages = 0;
	let toolResultMessages = 0;

	for (const [i, entry] of branch.entries()) {
		if (!startedAt) startedAt = entry.timestamp;
		endedAt = entry.timestamp;

		if (entry.type === "compaction") {
			compactionSummaries.push(entry.summary);
			timeline.push({
				index: i,
				role: "compaction",
				title: "Compaction",
				detail: entry.summary.slice(0, 240),
			});
			continue;
		}
		if (entry.type === "branch_summary") {
			timeline.push({
				index: i,
				role: "branch",
				title: "Branch summary",
				detail: entry.summary.slice(0, 240),
			});
			continue;
		}
		if (entry.type === "label") {
			timeline.push({
				index: i,
				role: "branch",
				title: entry.label ? `Label: ${entry.label}` : "Label cleared",
			});
			continue;
		}
		if (entry.type === "session_info") {
			continue;
		}
		if (entry.type !== "message") {
			continue;
		}

		totalMessages += 1;
		const message = (entry as { message: unknown }).message as AssistantLike;
		if (message.role === "user") {
			const text = extractText(message.content);
			if (text.trim()) {
				userPrompts.push(text);
				turns.push({
					index: i,
					role: "user",
					text,
					timestamp: entry.timestamp,
				});
				timeline.push({ index: i, role: "user", title: text.slice(0, 120) });
			}
			continue;
		}
		if (message.role === "assistant") {
			assistantMessages += 1;
			addUsage(usageTokens, message.usage);
			const text = extractText(message.content);
			const toolCalls = extractAssistantToolCalls(message.content);
			if (text.trim()) {
				assistantSummaries.push(text);
				turns.push({
					index: i,
					role: "assistant",
					text,
					toolCalls: stripRawToolArgs(toolCalls),
					timestamp: entry.timestamp,
				});
				timeline.push({
					index: i,
					role: "assistant",
					title: text.slice(0, 120),
				});
			} else if (toolCalls.length > 0) {
				turns.push({
					index: i,
					role: "assistant",
					text: "",
					toolCalls: stripRawToolArgs(toolCalls),
					timestamp: entry.timestamp,
				});
				timeline.push({
					index: i,
					role: "assistant",
					title: `Tool calls: ${toolCalls.map((c) => c.name).join(", ")}`,
				});
			}
			for (const call of toolCalls) {
				toolCallCounts.set(call.name, (toolCallCounts.get(call.name) ?? 0) + 1);
				if (call.name === "bash") {
					const command = extractCommandFromRawArgs(call.rawArgs) ?? call.args;
					bashCallCounts.set(command, (bashCallCounts.get(command) ?? 0) + 1);
				}
				recordTouchedFiles(call, touchedFiles);
				recordDecisionHints(call, decisions);
			}
			continue;
		}
		if (message.role === "toolResult") {
			toolResultMessages += 1;
			const toolResults = extractToolResults(message);
			turns.push({
				index: i,
				role: "tool",
				text: "",
				toolResults,
				timestamp: entry.timestamp,
			});
			if (toolResults) {
				for (const r of toolResults) {
					timeline.push({
						index: i,
						role: "tool",
						title: `${r.name}${r.isError ? " (error)" : ""}`,
						detail: r.preview.slice(0, 200),
					});
				}
			}
		}
	}

	return {
		turns,
		decisions,
		compactionSummaries,
		timeline,
		toolCalls: Array.from(toolCallCounts.entries()).map(([name, count]) => ({
			name,
			count,
		})),
		touchedFiles,
		userPrompts,
		assistantSummaries,
		usage: {
			userPrompts: userPrompts.length,
			assistantMessages,
			toolResults: toolResultMessages,
			totalToolCalls: Array.from(toolCallCounts.values()).reduce(
				(a, b) => a + b,
				0,
			),
			tools: Array.from(toolCallCounts.entries()).map(([name, count]) => ({
				name,
				count,
			})),
			bash: Array.from(bashCallCounts.entries()).map(([command, count]) => ({
				command,
				count,
			})),
			...(usageTokens.total > 0
				? {
						tokens: {
							input: usageTokens.input,
							output: usageTokens.output,
							cacheRead: usageTokens.cacheRead,
							cacheWrite: usageTokens.cacheWrite,
							total: usageTokens.total,
							...(usageTokens.cost > 0 ? { cost: usageTokens.cost } : {}),
						},
					}
				: {}),
		},
		startedAt,
		endedAt,
		totalMessages,
	};
}

function walkToEvidence(
	walk: BranchWalk,
	branchLength: number,
	targetLabel: string,
): SessionEvidence {
	return {
		sourceKind: "file",
		targetLabel,
		branchLength,
		totalMessages: walk.totalMessages,
		userPrompts: walk.userPrompts,
		assistantSummaries: walk.assistantSummaries,
		turns: walk.turns,
		toolCalls: walk.toolCalls,
		usage: walk.usage,
		touchedFiles: walk.touchedFiles,
		decisions: walk.decisions,
		compactionSummaries: walk.compactionSummaries,
		startedAt: walk.startedAt,
		endedAt: walk.endedAt,
	};
}

function truncateBranchAt(
	branch: SessionEntry[],
	entryId: string,
): SessionEntry[] {
	const idx = branch.findIndex((e) => e.id === entryId);
	if (idx === -1) {
		throw new Error(`Entry ${entryId} not found in current branch`);
	}
	return branch.slice(0, idx + 1);
}

function findResumeMarker(
	branch: SessionEntry[],
):
	| { entryId: string; previousSessionFile?: string; timestamp?: string }
	| undefined {
	for (const entry of branch) {
		if (entry.type === "custom" && entry.customType === RESUME_MARKER_TYPE) {
			const data = entry.data as { previousSessionFile?: string } | undefined;
			return {
				entryId: entry.id,
				previousSessionFile: data?.previousSessionFile,
				timestamp: entry.timestamp,
			};
		}
	}
	return undefined;
}

function summariseTree(
	tree: SessionTreeNode[],
	currentLeafId: string | null,
): SessionBranchSummary[] {
	const summaries: SessionBranchSummary[] = [];
	for (const node of tree) {
		visitTree(node, currentLeafId, summaries);
	}
	return summaries;
}

function visitTree(
	node: SessionTreeNode,
	currentLeafId: string | null,
	out: SessionBranchSummary[],
): void {
	const directUserPrompts: string[] = collectUserPromptsFromNode(node);
	const subtreeSize = countSubtree(node);
	const label =
		node.entry.type === "label" ? (node.entry.label ?? undefined) : undefined;
	const branchSummary =
		node.entry.type === "branch_summary" ? node.entry.summary : undefined;
	const isCurrentLeaf = node.entry.id === currentLeafId;
	const firstUserPrompt = directUserPrompts[0];
	const lastUserPrompt = directUserPrompts.at(-1);
	out.push({
		leafId: isCurrentLeaf ? currentLeafId : null,
		...(label ? { label } : {}),
		...(branchSummary ? { branchSummary } : {}),
		length: subtreeSize,
		...(firstUserPrompt ? { firstUserPrompt } : {}),
		...(lastUserPrompt && lastUserPrompt !== firstUserPrompt
			? { lastUserPrompt }
			: {}),
	});
	for (const child of node.children) {
		visitTree(child, currentLeafId, out);
	}
}

function collectUserPromptsFromNode(node: SessionTreeNode): string[] {
	const out: string[] = [];
	if (node.entry.type === "message") {
		const msg = (
			node.entry as { message: { role?: string; content?: unknown } }
		).message;
		if (msg?.role === "user") {
			const text = extractText(msg.content);
			if (text.trim()) out.push(text);
		}
	}
	for (const child of node.children) {
		out.push(...collectUserPromptsFromNode(child));
	}
	return out;
}

function countSubtree(node: SessionTreeNode): number {
	let count = 1;
	for (const child of node.children) count += countSubtree(child);
	return count;
}

function shortSessionLabel(session: string, id: string | null): string {
	const idShort = id ? id.slice(0, 8) : "";
	return idShort || session;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (!part || typeof part !== "object") return [];
			const block = part as { type?: string; text?: string };
			if (block.type === "text" && typeof block.text === "string") {
				return [block.text];
			}
			return [];
		})
		.join("\n")
		.trim();
}

interface ExtractedToolCall {
	name: string;
	args: string;
	rawArgs?: unknown;
}

function addUsage(
	totals: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
		cost: number;
	},
	usage: unknown,
): void {
	if (!usage || typeof usage !== "object") return;
	const u = usage as {
		input?: unknown;
		output?: unknown;
		cacheRead?: unknown;
		cacheWrite?: unknown;
		totalTokens?: unknown;
		cost?: unknown;
	};
	const input = numberValue(u.input);
	const output = numberValue(u.output);
	const cacheRead = numberValue(u.cacheRead);
	const cacheWrite = numberValue(u.cacheWrite);
	totals.input += input;
	totals.output += output;
	totals.cacheRead += cacheRead;
	totals.cacheWrite += cacheWrite;
	totals.total +=
		numberValue(u.totalTokens) || input + output + cacheRead + cacheWrite;
	if (u.cost && typeof u.cost === "object") {
		totals.cost += numberValue((u.cost as { total?: unknown }).total);
	}
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stripRawToolArgs(
	toolCalls: ExtractedToolCall[],
): Array<{ name: string; args: string }> {
	return toolCalls.map(({ name, args }) => ({ name, args }));
}

function extractAssistantToolCalls(content: unknown): ExtractedToolCall[] {
	if (!Array.isArray(content)) return [];
	const out: ExtractedToolCall[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as { type?: string; name?: string; arguments?: unknown };
		if (block.type === "toolCall" && typeof block.name === "string") {
			out.push({
				name: block.name,
				args: summarizeToolArgs(block.name, block.arguments),
				rawArgs: block.arguments,
			});
		}
	}
	return out;
}

function extractToolResults(
	message: AssistantLike,
): SessionTurn["toolResults"] {
	if (!Array.isArray(message.content)) return [];
	const results: NonNullable<SessionTurn["toolResults"]> = [];
	for (const part of message.content) {
		if (!part || typeof part !== "object") continue;
		const block = part as {
			type?: string;
			toolName?: string;
			isError?: boolean;
			content?: unknown;
		};
		if (block.type !== "toolResult") continue;
		const name = block.toolName ?? "tool";
		const preview = summarizeToolResult(name, block.content);
		results.push({ name, isError: isToolResultError(block), preview });
	}
	return results;
}

function recordTouchedFiles(
	call: ExtractedToolCall,
	touched: SessionEvidence["touchedFiles"],
): void {
	const kind = detectToolKind(call.name);
	if (kind !== "write" && kind !== "edit") return;
	const path =
		extractPathFromRawArgs(call.rawArgs) ?? extractPathFromArgs(call.args);
	if (!path) return;
	const diff = buildEditStyleDiff(path, call);
	touched.push({ path, action: kind, ...(diff ? { diff } : {}) });
}

/**
 * Extract a file path from a tool-call arg summary.
 * Handles JSON double-quoted, JSON single-quoted, and unquoted word forms.
 */
function extractCommandFromRawArgs(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const raw = (args as { command?: unknown }).command;
	return typeof raw === "string" && raw.trim() ? raw.slice(0, 240) : undefined;
}

function extractPathFromRawArgs(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const rawPath =
		(args as { path?: unknown; filePath?: unknown }).path ??
		(args as { path?: unknown; filePath?: unknown }).filePath;
	return typeof rawPath === "string" && rawPath.trim() ? rawPath : undefined;
}

const MAX_TOOL_DIFF_CHARS = 30_000;

function buildEditStyleDiff(
	path: string,
	call: ExtractedToolCall,
): string | undefined {
	if (!call.rawArgs || typeof call.rawArgs !== "object") return undefined;
	const args = call.rawArgs as { content?: unknown; edits?: unknown };
	let diff: string | undefined;
	try {
		if (call.name === "write" && typeof args.content === "string") {
			diff = generateUnifiedPatch(path, "", args.content);
		}
		if (call.name === "edit" && Array.isArray(args.edits)) {
			diff = args.edits
				.map((edit, index) => {
					if (!edit || typeof edit !== "object") return "";
					const e = edit as { oldText?: unknown; newText?: unknown };
					if (typeof e.oldText !== "string" || typeof e.newText !== "string")
						return "";
					return generateUnifiedPatch(
						`${path}#edit-${index + 1}`,
						e.oldText,
						e.newText,
					);
				})
				.filter(Boolean)
				.join("\n");
		}
	} catch (err) {
		console.warn(`Failed to build edit diff for ${path}`, err);
		return undefined;
	}
	if (!diff) return undefined;
	const redacted = redactSecrets(diff);
	if (redacted.length > MAX_TOOL_DIFF_CHARS) {
		console.warn(`Truncated visual recap edit diff for ${path}`);
		return `${redacted.slice(0, MAX_TOOL_DIFF_CHARS)}\n…diff truncated…`;
	}
	return redacted;
}

function extractPathFromArgs(argsSummary: string): string | undefined {
	const candidates = [
		/"((?:\\.|[^"\\])*)"/,
		/'((?:\\.|[^'\\])*)'/,
		/\b([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b/,
	];
	for (const re of candidates) {
		const match = argsSummary.match(re);
		if (!match) continue;
		const raw = match[1] ?? "";
		try {
			if (re === candidates[2]) return raw; // unquoted: return as-is
			return JSON.parse(`"${raw}"`) as string;
		} catch {
			return raw || undefined;
		}
	}
	return undefined;
}

function recordDecisionHints(
	call: ExtractedToolCall,
	decisions: SessionDecision[],
): void {
	if (call.name !== "write" && call.name !== "edit") return;
	const path = extractPathFromArgs(call.args);
	if (!path) return;
	decisions.push({
		index: decisions.length,
		decision: `${call.name} ${path}`,
		rationale:
			call.args.length > 140 ? `${call.args.slice(0, 140)}…` : call.args,
	});
}
