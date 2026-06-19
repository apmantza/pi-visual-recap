// Pi session evidence collector.
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

	// Open the target session manager.
	const sm =
		session === "current" || session === "tree"
			? ctx.sessionManager
			: openSessionFile(session, ctx);

	const sessionFile = sm.getSessionFile();
	const sessionId = sm.getSessionId();
	const sessionName = sm.getSessionName?.();

	// 1) Resolve the branch to walk.
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

	// 2) If `forkAt` is provided, truncate the branch at that entry.
	if (forkAt) {
		branch = truncateBranchAt(branch, forkAt);
		if (branch.length === 0) {
			throw new Error(`No branch entries found up to entry ${forkAt}`);
		}
		targetLabel = `${targetLabel} (fork at ${forkAt.slice(0, 12)})`;
	}

	// 3) Walk the branch and build the base evidence.
	const base = walkBranch(branch);

	// 4) For the current session, look for a pre-resume split marker.
	let split: SessionEvidence["split"];
	if (session === "current" || session === "tree") {
		const marker = findResumeMarker(branch);
		if (marker) {
			const preResumeEntries = truncateBranchAt(branch, marker.entryId);
			const preResume = synthesizeFromExisting(
				base,
				walkBranch(preResumeEntries),
				`pre-resume (resumed from ${marker.previousSessionFile ?? "previous session"})`,
			);
			const postResume = synthesizeFromExisting(
				base,
				walkBranch(branch),
				"post-resume (this session)",
			);
			split = {
				previousSessionFile: marker.previousSessionFile,
				resumedAt: marker.timestamp,
				preResume,
				postResume,
			};
		}
	}

	// 5) For tree mode, summarise every other branch too.
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
		startedAt: base.startedAt,
		endedAt: base.endedAt,
		branchLength: branch.length,
		totalMessages: base.totalMessages,
		userPrompts: base.userPrompts,
		assistantSummaries: base.assistantSummaries,
		turns: base.turns,
		toolCalls: base.toolCalls,
		touchedFiles: base.touchedFiles,
		decisions: base.decisions,
		followUps: base.followUps,
		compactionSummaries: base.compactionSummaries,
		...(branches ? { branches } : {}),
		...(split ? { split } : {}),
	};
}

function openSessionFile(path: string, ctx: ExtensionContext): SessionManager {
	try {
		return SessionManager.open(path, undefined, ctx.cwd);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to open session file ${path}: ${message}`);
	}
}

interface BranchWalk {
	turns: SessionTurn[];
	decisions: SessionDecision[];
	followUps: string[];
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
	const followUps: string[] = [];
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
		followUps,
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

function synthesizeFromExisting(
	_: BranchWalk,
	walk: BranchWalk,
	label: string,
): SessionEvidence {
	void _;
	return {
		sourceKind: "file",
		targetLabel: label,
		branchLength: walk.turns.length,
		totalMessages: walk.totalMessages,
		userPrompts: walk.userPrompts,
		assistantSummaries: walk.assistantSummaries,
		turns: walk.turns,
		toolCalls: walk.toolCalls,
		touchedFiles: walk.touchedFiles,
		decisions: walk.decisions,
		followUps: walk.followUps,
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
	// Walk the branch in chronological order; the first `visual-recap:resume-from`
	// custom entry marks the resume boundary.
	for (const entry of branch) {
		if (entry.type === "custom" && entry.customType === "visual-recap:resume-from") {
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
	visitTree(tree, currentLeafId, [], summaries);
	return summaries;
}

function visitTree(
	nodes: SessionTreeNode[],
	currentLeafId: string | null,
	ancestorUserPrompts: string[],
	out: SessionBranchSummary[],
): void {
	for (const node of nodes) {
		const userPrompts = [...ancestorUserPrompts];
		let firstUserPrompt: string | undefined;
		let lastUserPrompt: string | undefined;
		let length = 0;
		let label: string | undefined;
		let branchSummary: string | undefined;
		const directUserPrompts: string[] = [];
		if (node.entry.type === "message") {
			const msg = (node.entry as { message: { role?: string; content?: unknown } }).message;
			if (msg?.role === "user") {
				const text = extractText(msg.content);
				if (text.trim()) {
					directUserPrompts.push(text);
				}
			}
		}
		if (node.entry.type === "label") {
			label = node.entry.label ?? undefined;
		}
		if (node.entry.type === "branch_summary") {
			branchSummary = node.entry.summary;
		}
		// Walk children, accumulate stats.
		for (const child of node.children) {
			length += 1;
			collectUserPromptsFromNode(child, directUserPrompts);
		}
		if (directUserPrompts.length > 0) {
			firstUserPrompt = directUserPrompts[0];
			lastUserPrompt = directUserPrompts[directUserPrompts.length - 1];
		}
		out.push({
			leafId: node.entry.id === currentLeafId ? currentLeafId : null,
			...(label ? { label } : {}),
			...(branchSummary ? { branchSummary } : {}),
			length,
			...(firstUserPrompt ? { firstUserPrompt } : {}),
			...(lastUserPrompt ? { lastUserPrompt } : {}),
		});
		for (const child of node.children) {
			visitTree([child], currentLeafId, [...userPrompts, ...directUserPrompts], out);
		}
	}
}

function collectUserPromptsFromNode(node: SessionTreeNode, out: string[]): void {
	if (node.entry.type === "message") {
		const msg = (node.entry as { message: { role?: string; content?: unknown } }).message;
		if (msg?.role === "user") {
			const text = extractText(msg.content);
			if (text.trim()) out.push(text);
		}
	}
	for (const child of node.children) {
		collectUserPromptsFromNode(child, out);
	}
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

function extractPathFromArgs(argsSummary: string): string | undefined {
	const match = argsSummary.match(/"((?:\\.|[^"\\])*)"/);
	if (match) {
		try {
			return JSON.parse(`"${match[1]}"`) as string;
		} catch {
			return undefined;
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