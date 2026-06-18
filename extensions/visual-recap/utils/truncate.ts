// Diff truncation utilities.

export function truncateMiddle(
	text: string,
	maxBytes: number,
): { text: string; truncated: boolean } {
	const buf = Buffer.from(text, "utf8");
	if (buf.length <= maxBytes) return { text, truncated: false };
	const headBytes = Math.floor(maxBytes * 0.6);
	const tailBytes = maxBytes - headBytes;
	const head = buf.subarray(0, headBytes).toString("utf8");
	const tail = buf.subarray(buf.length - tailBytes).toString("utf8");
	const omitted = buf.length - headBytes - tailBytes;
	return {
		text: `${head}\n\n[... ${omitted} bytes of diff omitted for context budget ...]\n\n${tail}`,
		truncated: true,
	};
}
