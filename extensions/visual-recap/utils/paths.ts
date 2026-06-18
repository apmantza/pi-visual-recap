// Slug + path helpers.

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
	// Use forward slashes; Node will normalize on Windows.
	const cleaned = parts
		.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ""))
		.filter(Boolean);
	return [base.replace(/[\\/]+$/, ""), ...cleaned].join("/");
}
