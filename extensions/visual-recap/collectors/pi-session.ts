// Pi session evidence collector.
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detectToolKind, isToolResultError, summarizeToolArgs, summarizeToolResult } from "./tool-summary.ts";
import type {
  SessionDecision,
  SessionEvidence,
  SessionTimelineItem,
  SessionTurn,
} from "../schemas.ts";

export interface CollectSessionOptions {
  ctx: ExtensionContext;
  session: "current" | string;
}

interface AssistantLike {
  role: string;
  content: unknown;
  timestamp?: string | number | Date;
}

export async function collectSession(options: CollectSessionOptions): Promise<SessionEvidence> {
  const { ctx, session } = options;
  const sm =
    session === "current"
      ? ctx.sessionManager
      : (() => {
          try {
            return SessionManager.open(session, undefined, ctx.cwd);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to open session file ${session}: ${message}`);
          }
        })();

  const branch: SessionEntry[] = sm.getBranch();
  const sessionFile = sm.getSessionFile();
  const sessionId = sm.getSessionId();
  const sessionName = sm.getSessionName?.();

  const turns: SessionTurn[] = [];
  const decisions: SessionDecision[] = [];
  const _followUps: string[] = [];
  const followUps: string[] = [];
  void _followUps; // reserved for future use
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
      timeline.push({ index: i, role: "compaction", title: "Compaction", detail: entry.summary.slice(0, 240) });
      continue;
    }
    if (entry.type === "branch_summary") {
      timeline.push({ index: i, role: "branch", title: "Branch summary", detail: entry.summary.slice(0, 240) });
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
        turns.push({ index: i, role: "user", text, timestamp: entry.timestamp });
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
        timeline.push({ index: i, role: "assistant", title: text.slice(0, 120) });
      } else if (toolCalls.length > 0) {
        turns.push({ index: i, role: "assistant", text: "", toolCalls, timestamp: entry.timestamp });
        timeline.push({ index: i, role: "assistant", title: `Tool calls: ${toolCalls.map((c) => c.name).join(", ")}` });
      }
      for (const call of toolCalls) {
        toolCallCounts.set(call.name, (toolCallCounts.get(call.name) ?? 0) + 1);
        recordTouchedFiles(call, touchedFiles);
        recordDecisionHints(call, decisions, followUps);
      }
      continue;
    }
    if (message.role === "toolResult") {
      const toolResults = extractToolResults(message);
      turns.push({ index: i, role: "tool", text: "", toolResults, timestamp: entry.timestamp });
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

  const targetLabel =
    session === "current"
      ? "current Pi session"
      : `session ${shortSessionLabel(session, sessionId)}`;

  return {
    sourceKind: session === "current" ? "current" : "file",
    sessionFile,
    sessionId,
    sessionName: sessionName ?? undefined,
    targetLabel,
    startedAt,
    endedAt,
    branchLength: branch.length,
    totalMessages,
    userPrompts,
    assistantSummaries,
    turns,
    toolCalls: Array.from(toolCallCounts.entries()).map(([name, count]) => ({ name, count })),
    touchedFiles,
    decisions,
    followUps,
    compactionSummaries,
  };
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
      out.push({ name: block.name, args: summarizeToolArgs(block.name, block.arguments) });
    }
  }
  return out;
}

function extractToolResults(message: AssistantLike): SessionTurn["toolResults"] {
  if (!Array.isArray(message.content)) return [];
  const results: NonNullable<SessionTurn["toolResults"]> = [];
  for (const part of message.content) {
    if (!part || typeof part !== "object") continue;
    const block = part as { type?: string; toolName?: string; isError?: boolean; content?: unknown };
    if (block.type !== "toolResult") continue;
    const name = block.toolName ?? "tool";
    const preview = summarizeToolResult(name, block.content);
    results.push({ name, isError: isToolResultError(block), preview });
  }
  return results;
}

function recordTouchedFiles(call: ExtractedToolCall, touched: SessionEvidence["touchedFiles"]): void {
  const kind = detectToolKind(call.name);
  if (!kind) return;
  const path = extractPathFromArgs(call.name, call.args);
  if (!path) return;
  touched.push({ path, action: kind });
}

function extractPathFromArgs(name: string, argsSummary: string): string | undefined {
  // Best-effort: pick the first quoted string in the args summary.
  const match = argsSummary.match(/"((?:\\.|[^"\\])*)"/);
  if (match) {
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return undefined;
    }
  }
  void name;
  return undefined;
}

function recordDecisionHints(
  call: ExtractedToolCall,
  decisions: SessionDecision[],
  _followUps: string[],
): void {
  // Capture write/edit calls as decision evidence (file + first 80 chars of args).
  if (call.name !== "write" && call.name !== "edit") return;
  const path = extractPathFromArgs(call.name, call.args);
  if (!path) return;
  decisions.push({
    index: decisions.length,
    decision: `${call.name} ${path}`,
    rationale: call.args.length > 140 ? `${call.args.slice(0, 140)}…` : call.args,
  });
  void _followUps; // reserved for future follow-up extraction
}
