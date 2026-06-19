// Pi session evidence collector.
import * as path from "node:path";
import { existsSync } from "node:fs";
import {
	SessionManager,
	type SessionEntry,
	type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	detectToolKind,
	isToolResultError,
	summarizeToolArgs,
	summarizeToolResult,
} from "./tool-summary.ts";
import type {
	SessionBranchSummary,
	SessionDecision,
	SessionEvidence,
	SessionTimelineItem,
	SessionTurn,
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
function openSessionFile(rawPath: string, ctx: ExtensionContext): SessionManager {
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
	const touchedFiles: SessionEvidence["touchedFiles"] = [];
	const userPrompts: string[] = [];
	const assistantSummaries: string[] = [];
	let startedAt: string | undefined;
	let endedAt: string | undefined;
	let totalMessages = 0;

	for (let i = 0; i < branch.length; i += 1) {
		const entry = branch[i]!;
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
			const text = extractText(message.content);
			const toolCalls = extractAssistantToolCalls(message.content);
			if (text.trim()) {
				assistantSummaries.push(text);
				turns.push({
					index: i,
					role: "assistant",
					text,
					toolCalls,
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
					toolCalls,
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
				recordTouchedFiles(call, touchedFiles);
				recordDecisionHints(call, decisions);
			}
			continue;
		}
		if (message.role === "toolResult") {
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
		touchedFiles: walk.touchedFiles,
		decisions: walk.decisions,
		compactionSummaries: walk.compactionSummaries,
		startedAt: walk.startedAt,
		endedAt: walk.endedAt,
	};
}

function truncateBranchAt(branch: SessionEntry[], entryId: string): SessionEntry[] {
	const idx = branch.findIndex((e) => e.id === entryId);
	if (idx === -1) {
		throw new Error(`Entry ${entryId} not found in current branch`);
	}
	return branch.slice(0, idx + 1);
}

function findResumeMarker(
	branch: SessionEntry[],
): { entryId: string; previousSessionFile?: string; timestamp?: string } | undefined {
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
	const label = node.entry.type === "label" ? node.entry.label ?? undefined : undefined;
	const branchSummary =
		node.entry.type === "branch_summary" ? node.entry.summary : undefined;
	const isCurrentLeaf = node.entry.id === currentLeafId;
	const firstUserPrompt = directUserPrompts[0];
	const lastUserPrompt = directUserPrompts[directUserPrompts.length - 1];
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
		const msg = (node.entry as { message: { role?: string; content?: unknown } }).message;
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
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const block = part as { type?: string; text?: string };
			if (block.type === "text" && typeof block.text === "string") return block.text;
			return "";
		})
		.join("\n")
		.trim();
}

interface ExtractedToolCall {
	name: string;
	args: string;
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
	if (!kind) return;
	const path = extractPathFromArgs(call.args);
	if (!path) return;
	touched.push({ path, action: kind });
}

/**
 * Extract a file path from a tool-call arg summary.
 * Handles JSON double-quoted, JSON single-quoted, and unquoted word forms.
 */
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
		rationale: call.args.length > 140 ? `${call.args.slice(0, 140)}…` : call.args,
	});
}
