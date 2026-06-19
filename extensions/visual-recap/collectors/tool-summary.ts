// Tool call summarization helpers for the session collector.

export type ToolKind = "read" | "write" | "edit" | "bash" | undefined;

const BASH_LIKE = new Set(["bash"]);
const READ_LIKE = new Set(["read", "ls", "find", "grep"]);
const WRITE_LIKE = new Set(["write"]);
const EDIT_LIKE = new Set(["edit"]);

export function detectToolKind(name: string): ToolKind {
	if (WRITE_LIKE.has(name)) return "write";
	if (EDIT_LIKE.has(name)) return "edit";
	if (BASH_LIKE.has(name)) return "bash";
	if (READ_LIKE.has(name)) return "read";
	return undefined;
}

export function summarizeToolArgs(name: string, args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const obj = args as Record<string, unknown>;
	const parts: string[] = [];
	for (const [key, value] of Object.entries(obj)) {
		parts.push(`${key}=${stringifyCompact(value)}`);
		if (parts.join(" ").length > 240) break;
	}
	void name;
	return parts.join(" ").slice(0, 240);
}

export function summarizeToolResult(name: string, content: unknown): string {
	if (typeof content === "string") return content.slice(0, 240);
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (!part || typeof part !== "object") return "";
				const block = part as { type?: string; text?: string };
				if (block.type === "text" && typeof block.text === "string")
					return block.text;
				return "";
			})
			.join("\n")
			.slice(0, 240);
	}
	if (content && typeof content === "object") {
		try {
			return JSON.stringify(content).slice(0, 240);
		} catch {
			return "";
		}
	}
	void name;
	return "";
}

export function isToolResultError(block: {
	isError?: boolean;
	content?: unknown;
}): boolean {
	if (typeof block.isError === "boolean") return block.isError;
	// Heuristic: content with "error" prefix or "Error" tagged output.
	const preview = summarizeToolResult("", block.content);
	return (
		/^\s*Error[:\s]/i.test(preview) || /^\s*<tool_use_error>/i.test(preview)
	);
}

function stringifyCompact(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") {
		const escaped = value.length > 80 ? `${value.slice(0, 80)}…` : value;
		return JSON.stringify(escaped);
	}
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	if (Array.isArray(value)) return `[${value.length}]`;
	if (typeof value === "object") {
		const keys = Object.keys(value);
		return `{${keys.slice(0, 4).join(",")}${keys.length > 4 ? ",…" : ""}}`;
	}
	return String(value);
}
