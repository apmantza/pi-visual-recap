// Parse a visual-recap target from raw command arguments.
import type { RecapTarget } from "../schemas.ts";

export interface ParseOptions {
	defaultBranch?: string;
}

export function parseTarget(
	args: string,
	options: ParseOptions = {},
): RecapTarget {
	const trimmed = args.trim();
	if (!trimmed) {
		return { kind: "working-tree", base: options.defaultBranch };
	}

	const lower = trimmed.toLowerCase();

	if (lower.startsWith("session ")) {
		const value = trimmed.slice("session ".length).trim() || "current";
		return { kind: "session", session: value };
	}
	if (lower === "session") {
		return { kind: "session", session: "current" };
	}

	if (lower.startsWith("pr ")) {
		return { kind: "pr", idOrUrl: trimmed.slice(3).trim() };
	}
	if (lower.startsWith("commit ")) {
		return { kind: "commit", ref: trimmed.slice("commit ".length).trim() };
	}
	if (lower.startsWith("range ")) {
		return { kind: "range", range: trimmed.slice("range ".length).trim() };
	}

	// PR URL detection
	if (/^https?:\/\//i.test(trimmed) && /\/pull\/\d+/.test(trimmed)) {
		return { kind: "pr", idOrUrl: trimmed };
	}

	// Bare "42" → PR
	if (/^\d+$/.test(trimmed)) {
		return { kind: "pr", idOrUrl: trimmed };
	}

	// Range like HEAD~1..HEAD
	if (/\.\..+/.test(trimmed)) {
		return { kind: "range", range: trimmed };
	}

	// Single ref
	if (/^[0-9a-f]{4,}$/i.test(trimmed)) {
		return { kind: "commit", ref: trimmed };
	}

	// Branch-like (contains a slash or looks like branch)
	if (/[a-zA-Z]/.test(trimmed) && !trimmed.includes(" ")) {
		return {
			kind: "branch",
			base: options.defaultBranch ?? "main",
			head: trimmed,
		};
	}

	// Fallback: treat as working-tree diff against the literal ref
	return { kind: "range", range: trimmed };
}
