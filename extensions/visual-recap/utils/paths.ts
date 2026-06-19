// Slug + path helpers.
import * as nodePath from "node:path";

export function slugify(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "recap"
	);
}

export function timestampSlug(date: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		date.getFullYear().toString() +
		pad(date.getMonth() + 1) +
		pad(date.getDate()) +
		"-" +
		pad(date.getHours()) +
		pad(date.getMinutes()) +
		pad(date.getSeconds())
	);
}

export function safeJoin(base: string, ...parts: string[]): string {
	// Resolve against `base` and verify the result is contained inside it.
	// Throws on any traversal attempt (`..`, absolute path in `parts`, or
	// encoded separators) so callers can rely on a safe joinable path.
	const normalizedBase = nodePath.resolve(base);
	const joined = nodePath.resolve(normalizedBase, ...parts);
	const relative = nodePath.relative(normalizedBase, joined);
	if (
		relative === "" ||
		(!relative.startsWith("..") && !nodePath.isAbsolute(relative))
	) {
		return joined;
	}
	throw new Error(`Path escapes base directory: ${parts.join("/")}`);
}

export function basenameOf(p: string): string {
	return nodePath.basename(p);
}
